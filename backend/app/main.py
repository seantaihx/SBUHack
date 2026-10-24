from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, Request, Response
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
                           {'active_run_id': exc.run_id}) from None
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
