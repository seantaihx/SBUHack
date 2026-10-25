from contextlib import asynccontextmanager
import asyncio
from uuid import UUID

from fastapi import FastAPI, File, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from starlette.exceptions import HTTPException

from .providers.demo import DemoProvider
from .runner import Runner
from .schemas import (ActiveRunInfo, Capabilities, CreateRun, ErrorEnvelope, ErrorInfo, Health, ModelInfo,
                      Run, SampleTasks, StopActiveRunRequest)
from .settings import Settings
from .store import RunActive, Store
from .errors import APIError
from .benchmarks.service import BenchmarkService
from .benchmarks.routes import router as benchmark_router
from .sources import SourceFailure, parse_csv, parse_pdf, parse_text, parse_webpage
from .schemas import CreateTextSource, CreateWebpageSource, SourceResponse, SourceSnapshot
from .agent_schemas import (AgentApprovalRequest, AgentCapabilities, AgentEventsResponse, AgentPlanApprovalRequest,
                            AgentRun, AgentStartRequest, AgentWorkflowStartRequest)
from .agents import AgentService, local_agent_request
from .schemas import (AgentRoleModelAssignments, AgentRoleModelSettings, LocalProviderSettings,
                      ProviderKeyInput)
from .local_settings import (agent_model_settings, local_same_origin_request, provider_settings,
                             save_agent_role_models, save_provider_key, save_provider_api_key)

def error_response(status: int, error: ErrorInfo) -> JSONResponse:
    return JSONResponse(status_code=status, content=ErrorEnvelope(error=error).model_dump(mode='json'))


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    demo = DemoProvider()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.database_path)
        recovered_agent_ids = app.state.store.recover()
        app.state.runner = Runner(app.state.store, demo, settings)
        app.state.benchmarks = BenchmarkService(app.state.store, settings)
        app.state.agents = AgentService(app.state.store, settings)
        for run_id in recovered_agent_ids:
            app.state.agents.refresh_recovered_handoff(run_id)
        try:
            yield
        finally:
            await app.state.agents.close()
            await app.state.runner.close()
            await app.state.benchmarks.close()

    app = FastAPI(title='EcoAgent API', version='1.1.0', lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(APIError)
    async def api_error(request, exc):
        return error_response(exc.status, exc.error)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Never echo input, exception text, provider URLs or credentials.
        return error_response(422, ErrorInfo(code='VALIDATION_ERROR', message='The request is invalid.'))

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        code = 'NOT_FOUND' if exc.status_code == 404 else 'HTTP_ERROR'
        return error_response(exc.status_code, ErrorInfo(code=code, message='The requested route is unavailable.'))

    @app.middleware('http')
    async def sanitize_internal_errors(request, call_next):
        # Catch inside ServerErrorMiddleware: its default handler re-raises exceptions
        # after sending a response, allowing raw exception text into Uvicorn logs.
        try:
            return await call_next(request)
        except Exception:
            return error_response(500, ErrorInfo(code='INTERNAL_ERROR', message='The request could not be completed.'))

    @app.get('/api/v1/health', response_model=Health)
    async def health():
        return Health()

    @app.get('/api/v1/active-run', response_model=ActiveRunInfo | None,
             responses={code: {'model': ErrorEnvelope} for code in (403, 500)})
    async def active_run(request: Request):
        active = request.app.state.store.active_run()
        if active and active['kind'] == 'agent':
            require_local_agent(request)
        return ActiveRunInfo(**active) if active else None

    @app.post('/api/v1/active-run/stop', response_model=ActiveRunInfo,
              responses={code: {'model': ErrorEnvelope} for code in (403, 404, 409, 500)})
    async def stop_active_run(body: StopActiveRunRequest, request: Request):
        active = request.app.state.store.active_run()
        if active is None:
            raise APIError(404, 'NO_ACTIVE_RUN', 'There is no active EcoAgent run to stop.')
        if body.run_id is not None and active['id'] != str(body.run_id):
            raise APIError(409, 'ACTIVE_RUN_CHANGED', 'The active run changed. Refresh before stopping it.')
        if active['kind'] == 'agent':
            require_local_agent(request)
            stopped = request.app.state.agents.stop(active['id'])
            return ActiveRunInfo(id=str(stopped.run_id), kind='agent', status=stopped.status)
        if active['kind'] == 'comparison':
            stopped = await request.app.state.runner.stop(active['id'])
            return ActiveRunInfo(id=str(stopped.id), kind='comparison', status=stopped.status)
        stopped = await request.app.state.benchmarks.stop(active['id'])
        return ActiveRunInfo(id=stopped.run_id, kind='benchmark', status=stopped.status)

    @app.get('/api/v1/capabilities', response_model=Capabilities)
    async def capabilities():
        return Capabilities(live_enabled=settings.live_enabled, live_disabled_reason=settings.live_enabled_reason,
                            models=[ModelInfo(role='small', live_model_id=settings.small_model_id),
                                    ModelInfo(role='large', live_model_id=settings.large_model_id)],
                            supported_models=settings.available_agent_models, energy_profile=demo.profile)

    @app.get('/api/v1/local-settings/provider', response_model=LocalProviderSettings,
             responses={code: {'model': ErrorEnvelope} for code in (403, 500)})
    async def local_provider_settings(request: Request, response: Response):
        if not local_same_origin_request(request, allow_missing_origin_for_read=True):
            raise APIError(403, 'LOCAL_SETUP_ONLY', 'Provider setup is available only from this app on the same computer.')
        response.headers['Cache-Control'] = 'no-store'
        return provider_settings(settings)

    @app.put('/api/v1/local-settings/provider-key', response_model=LocalProviderSettings,
             responses={code: {'model': ErrorEnvelope} for code in (403, 409, 422, 500)})
    async def configure_local_provider_key(body: ProviderKeyInput, request: Request, response: Response):
        if not local_same_origin_request(request):
            raise APIError(403, 'LOCAL_SETUP_ONLY', 'Provider setup is available only from this app on the same computer.')
        response.headers['Cache-Control'] = 'no-store'
        try:
            save_provider_key(body.api_key.get_secret_value())
        except ValueError:
            raise APIError(422, 'INVALID_PROVIDER_KEY', 'The key format or backend .env path is not valid for local setup.') from None
        except RuntimeError:
            raise APIError(409, 'ENVIRONMENT_KEY_OVERRIDE', 'GROQ_API_KEY is set in the backend process environment, which takes precedence over .env.') from None
        except (OSError, UnicodeError):
            raise APIError(500, 'LOCAL_SETUP_WRITE_FAILED', 'The backend could not safely update its ignored .env file.') from None
        return provider_settings(settings)

    @app.put('/api/v1/local-settings/provider-keys/{provider}', response_model=LocalProviderSettings,
             responses={code: {'model': ErrorEnvelope} for code in (403, 409, 422, 500)})
    async def configure_local_provider_key_for(provider: str, body: ProviderKeyInput,
                                               request: Request, response: Response):
        if not local_same_origin_request(request):
            raise APIError(403, 'LOCAL_SETUP_ONLY', 'Provider setup is available only from this app on the same computer.')
        if provider not in {'groq', 'openai', 'gemini', 'anthropic'}:
            raise APIError(422, 'UNSUPPORTED_PROVIDER', 'Choose a hosted provider supported by local setup.')
        response.headers['Cache-Control'] = 'no-store'
        try:
            save_provider_api_key(provider, body.api_key.get_secret_value())
        except ValueError:
            raise APIError(422, 'INVALID_PROVIDER_KEY', 'The key format or backend .env path is not valid for local setup.') from None
        except RuntimeError:
            raise APIError(409, 'ENVIRONMENT_KEY_OVERRIDE', 'This provider key is set in the backend process environment, which takes precedence over .env.') from None
        except (OSError, UnicodeError):
            raise APIError(500, 'LOCAL_SETUP_WRITE_FAILED', 'The backend could not safely update its ignored .env file.') from None
        return provider_settings(settings)

    @app.get('/api/v1/local-settings/agent-models', response_model=AgentRoleModelSettings,
             responses={code: {'model': ErrorEnvelope} for code in (403, 500)})
    async def local_agent_model_settings(request: Request, response: Response):
        if not local_same_origin_request(request, allow_missing_origin_for_read=True):
            raise APIError(403, 'LOCAL_SETUP_ONLY', 'Agent model setup is available only from this app on the same computer.')
        response.headers['Cache-Control'] = 'no-store'
        return agent_model_settings(settings)

    @app.put('/api/v1/local-settings/agent-models', response_model=AgentRoleModelSettings,
             responses={code: {'model': ErrorEnvelope} for code in (403, 409, 422, 500)})
    async def configure_local_agent_models(body: AgentRoleModelAssignments, request: Request, response: Response):
        if not local_same_origin_request(request):
            raise APIError(403, 'LOCAL_SETUP_ONLY', 'Agent model setup is available only from this app on the same computer.')
        response.headers['Cache-Control'] = 'no-store'
        try:
            save_agent_role_models(body.model_dump(), settings)
        except ValueError:
            raise APIError(422, 'UNSUPPORTED_AGENT_MODEL', 'Choose models from the backend-supported model list.') from None
        except RuntimeError:
            raise APIError(409, 'AGENT_MODEL_ENVIRONMENT_OVERRIDE', 'Agent model settings are set in the backend process environment, which takes precedence over .env.') from None
        except (OSError, UnicodeError):
            raise APIError(500, 'LOCAL_SETUP_WRITE_FAILED', 'The backend could not safely update its ignored .env file.') from None
        return agent_model_settings(settings)

    @app.get('/api/v1/agent/capabilities', response_model=AgentCapabilities)
    async def agent_capabilities(request: Request):
        service = request.app.state.agents
        local = local_agent_request(request)
        reason = service.disabled_reason if local else 'Workspace agent requests are restricted to a loopback browser/API connection.'
        root = settings.agent_workspace_root if local and service.disabled_reason is None else None
        return AgentCapabilities(enabled=reason is None, disabled_reason=reason,
                                 workspace_name=root.resolve().name if root else None,
                                 max_steps=min(20, settings.max_requests_per_run),
                                 max_tokens_per_run=settings.max_agent_tokens_per_run,
                                 max_tokens_per_task=settings.max_agent_tokens_per_task)

    def require_local_agent(request: Request):
        if not local_agent_request(request):
            raise APIError(403, 'AGENT_LOCAL_ONLY', 'Workspace agent actions are available only through a loopback connection.')

    @app.post('/api/v1/agent-runs', status_code=202, response_model=AgentRun,
              responses={code: {'model': ErrorEnvelope} for code in (403, 409, 422, 503, 500)})
    async def create_agent_run(body: AgentStartRequest, request: Request, response: Response):
        require_local_agent(request)
        run = request.app.state.agents.start(body)
        response.headers['Location'] = f'/api/v1/agent-runs/{run.run_id}'
        return run

    @app.post('/api/v1/agent-workflows', status_code=202, response_model=AgentRun,
              responses={code: {'model': ErrorEnvelope} for code in (403, 409, 422, 503, 500)})
    async def create_agent_workflow(body: AgentWorkflowStartRequest, request: Request, response: Response):
        require_local_agent(request)
        run = request.app.state.agents.start_workflow(body)
        response.headers['Location'] = f'/api/v1/agent-runs/{run.run_id}'
        return run

    @app.post('/api/v1/agent-runs/{run_id}/plan-approvals', response_model=AgentRun,
              responses={code: {'model': ErrorEnvelope} for code in (403, 404, 409, 422, 500)})
    async def approve_agent_plan(run_id: UUID, body: AgentPlanApprovalRequest, request: Request):
        require_local_agent(request)
        return request.app.state.agents.approve_workflow_plan(str(run_id), body.plan_hash, body.approved)

    @app.get('/api/v1/agent-runs/{run_id}', response_model=AgentRun,
             responses={code: {'model': ErrorEnvelope} for code in (403, 404, 422, 500)})
    async def get_agent_run(run_id: UUID, request: Request):
        require_local_agent(request)
        run = request.app.state.agents.get(str(run_id))
        if run is None:
            raise APIError(404, 'AGENT_RUN_NOT_FOUND', 'This workspace run was not found.')
        return run

    @app.get('/api/v1/agent-runs/{run_id}/events', response_model=AgentEventsResponse,
             responses={code: {'model': ErrorEnvelope} for code in (403, 404, 422, 500)})
    async def get_agent_events(run_id: UUID, request: Request, cursor: int = 0, limit: int = 50):
        require_local_agent(request)
        if cursor < 0 or not 1 <= limit <= 50:
            raise APIError(422, 'VALIDATION_ERROR', 'The event cursor or page size is invalid.')
        run = request.app.state.agents.get(str(run_id))
        if run is None:
            raise APIError(404, 'AGENT_RUN_NOT_FOUND', 'This workspace run was not found.')
        events = [event for event in run.events if event.sequence > cursor]
        page = events[:limit]
        next_cursor = str(page[-1].sequence) if len(events) > len(page) and page else None
        return AgentEventsResponse(events=page, next_cursor=next_cursor)

    @app.post('/api/v1/agent-runs/{run_id}/approvals', response_model=AgentRun,
              responses={code: {'model': ErrorEnvelope} for code in (403, 404, 409, 422, 500)})
    async def approve_agent_action(run_id: UUID, body: AgentApprovalRequest, request: Request):
        require_local_agent(request)
        try:
            action_id = UUID(body.action_id)
        except ValueError:
            raise APIError(422, 'VALIDATION_ERROR', 'The approval action ID is invalid.') from None
        return request.app.state.agents.approve(str(run_id), action_id, body.action_hash, body.approved)

    @app.post('/api/v1/agent-runs/{run_id}/continue', response_model=AgentRun,
              responses={code: {'model': ErrorEnvelope} for code in (403, 404, 409, 422, 500)})
    async def continue_agent_run(run_id: UUID, request: Request):
        require_local_agent(request)
        return request.app.state.agents.continue_run(str(run_id))

    @app.post('/api/v1/agent-runs/{run_id}/stop', response_model=AgentRun,
              responses={code: {'model': ErrorEnvelope} for code in (403, 404, 409, 422, 500)})
    async def stop_agent_run(run_id: UUID, request: Request):
        require_local_agent(request)
        return request.app.state.agents.stop(str(run_id))

    @app.get('/api/v1/sample-tasks', response_model=SampleTasks)
    async def samples():
        return demo.samples

    def persist_source(request: Request, source: SourceSnapshot):
        request.app.state.store.create_source(source)
        return {'source': source}

    def source_error(exc: SourceFailure):
        raise APIError(exc.status, exc.code, exc.message) from None

    @app.post('/api/v1/sources/text', status_code=201, response_model=SourceResponse, responses={code: {'model': ErrorEnvelope} for code in (400, 413, 422, 500)})
    async def create_text_source(body: CreateTextSource, request: Request):
        try:
            source = await asyncio.to_thread(parse_text, body.text, body.name)
            return persist_source(request, source)
        except SourceFailure as exc:
            source_error(exc)

    @app.post('/api/v1/sources/files', status_code=201, response_model=SourceResponse, responses={code: {'model': ErrorEnvelope} for code in (413, 415, 422, 500)})
    async def create_file_source(request: Request, file: UploadFile = File(...)):
        name = file.filename or ''
        suffix = name.lower().rsplit('.', 1)[-1] if '.' in name else ''
        if suffix not in {'pdf', 'csv'}:
            raise APIError(415, 'SOURCE_TYPE_UNSUPPORTED', 'Upload one PDF or CSV file.')
        from .sources import MAX_FILE_BYTES
        data = await file.read(MAX_FILE_BYTES + 1)
        await file.close()
        if len(data) > MAX_FILE_BYTES:
            raise APIError(413, 'SOURCE_TOO_LARGE', 'The file exceeds the 10 MiB limit.')
        try:
            source = await asyncio.to_thread(parse_pdf if suffix == 'pdf' else parse_csv, data, name)
            return persist_source(request, source)
        except SourceFailure as exc:
            source_error(exc)

    @app.post('/api/v1/sources/webpage', status_code=201, response_model=SourceResponse, responses={code: {'model': ErrorEnvelope} for code in (400, 413, 415, 422, 502, 504, 500)})
    async def create_webpage_source(body: CreateWebpageSource, request: Request):
        try:
            source = await asyncio.to_thread(parse_webpage, body.url)
            return persist_source(request, source)
        except SourceFailure as exc:
            source_error(exc)

    @app.get('/api/v1/sources/{source_id}', response_model=SourceResponse, responses={code: {'model': ErrorEnvelope} for code in (404, 422, 500)})
    async def get_source(source_id: UUID, request: Request):
        source = request.app.state.store.get_source(str(source_id))
        if source is None:
            raise APIError(404, 'SOURCE_NOT_FOUND', 'This source preview expired or was not found.')
        return {'source': source}

    @app.delete('/api/v1/sources/{source_id}', status_code=204, responses={code: {'model': ErrorEnvelope} for code in (404, 409, 422, 500)})
    async def delete_source(source_id: UUID, request: Request):
        if not request.app.state.store.delete_source(str(source_id)):
            raise APIError(404, 'SOURCE_NOT_FOUND', 'This source preview expired or was not found.')
        return Response(status_code=204)

    @app.post('/api/v1/runs', status_code=202, response_model=Run,
              responses={code: {'model': ErrorEnvelope} for code in (409, 422, 503, 500)})
    async def create_run(body: CreateRun, request: Request, response: Response):
        if len({task.id for task in body.tasks}) != len(body.tasks):
            raise APIError(422, 'DUPLICATE_TASK_ID', 'Task IDs must be unique.')
        if body.mode == 'demo' and (body.small_model_id is not None or body.large_model_id is not None):
            raise APIError(422, 'VALIDATION_ERROR', 'Provider model overrides are available only for Live comparisons.')
        if body.mode == 'live':
            selected_models = (body.small_model_id or settings.small_model_id,
                               body.large_model_id or settings.large_model_id)
            from .model_catalog import normalize_model_key
            if normalize_model_key(selected_models[0]) == normalize_model_key(selected_models[1]):
                raise APIError(422, 'VALIDATION_ERROR', 'Choose distinct models for small and large routing roles.')
            for model_id in selected_models:
                unavailable = settings.model_unavailable_reason(model_id)
                if unavailable:
                    raise APIError(503, 'LIVE_UNAVAILABLE', unavailable)
        if body.quality_fallback and body.mode != 'live':
            raise APIError(422, 'VALIDATION_ERROR', 'Quality fallback is available only for Live comparisons.')
        if len(body.tasks) * (2 + int(body.quality_fallback)) > settings.max_requests_per_run:
            raise APIError(422, 'VALIDATION_ERROR', 'The comparison exceeds the configured request cap.')
        if body.mode == 'demo' and not demo.accepts(body.tasks):
            raise APIError(422, 'INVALID_DEMO_TASK', 'Demo tasks must match the sample workload.')
        try:
            run = request.app.state.runner.submit(body)
        except RunActive as exc:
            raise APIError(409, 'RUN_ALREADY_ACTIVE', 'A comparison is already running.',
                           {'active_run_id': exc.run_id, 'active_run_kind': exc.kind}) from None
        response.headers['Location'] = f'/api/v1/runs/{run.id}'
        return run

    @app.get('/api/v1/runs/{run_id}', response_model=Run,
             responses={code: {'model': ErrorEnvelope} for code in (404, 422, 500)})
    async def get_run(run_id: UUID, request: Request):
        run = request.app.state.store.get(str(run_id))
        if run is None:
            raise APIError(404, 'RUN_NOT_FOUND', 'This comparison was not found.')
        return run

    app.include_router(benchmark_router)

    @app.get('/{path:path}', include_in_schema=False)
    async def frontend(path: str):
        if path == 'api' or path.startswith('api/'):
            raise APIError(404, 'NOT_FOUND', 'The requested API route was not found.')
        dist = settings.frontend_dist.resolve()
        target = (dist / path).resolve()
        if not target.is_relative_to(dist):
            raise APIError(404, 'NOT_FOUND', 'The requested file was not found.')
        if target.is_file():
            return FileResponse(target)
        index = dist / 'index.html'
        if not target.suffix and index.is_file():
            return FileResponse(index)
        raise APIError(404, 'NOT_FOUND', 'The frontend build or requested file was not found.')

    return app


app = create_app()
