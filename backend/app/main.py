from contextlib import asynccontextmanager
import asyncio
from uuid import UUID

from fastapi import FastAPI, File, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from starlette.exceptions import HTTPException

from .providers.demo import DemoProvider
from .runner import Runner
from .schemas import Capabilities, CreateRun, ErrorEnvelope, ErrorInfo, Health, ModelInfo, Run, SampleTasks
from .settings import Settings
from .store import RunActive, Store
from .errors import APIError
from .benchmarks.service import BenchmarkService
from .benchmarks.routes import router as benchmark_router
from .sources import SourceFailure, parse_csv, parse_pdf, parse_text, parse_webpage
from .schemas import CreateTextSource, CreateWebpageSource, SourceResponse, SourceSnapshot

def error_response(status: int, error: ErrorInfo) -> JSONResponse:
    return JSONResponse(status_code=status, content=ErrorEnvelope(error=error).model_dump(mode='json'))


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    demo = DemoProvider()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.database_path)
        app.state.store.recover()
        app.state.runner = Runner(app.state.store, demo, settings)
        app.state.benchmarks = BenchmarkService(app.state.store, settings)
        try:
            yield
        finally:
            await app.state.runner.close()
            await app.state.benchmarks.close()

    app = FastAPI(title='EcoAgent API', version='1.0.0', lifespan=lifespan,
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

    @app.get('/api/v1/capabilities', response_model=Capabilities)
    async def capabilities():
        return Capabilities(live_enabled=settings.live_disabled_reason is None, live_disabled_reason=settings.live_disabled_reason,
                            models=[ModelInfo(role='small', live_model_id=settings.small_model_id),
                                    ModelInfo(role='large', live_model_id=settings.large_model_id)], energy_profile=demo.profile)

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
        if body.mode == 'live' and settings.live_disabled_reason:
            raise APIError(503, 'LIVE_UNAVAILABLE', settings.live_disabled_reason)
        if len(body.tasks) * 2 > settings.max_requests_per_run:
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
