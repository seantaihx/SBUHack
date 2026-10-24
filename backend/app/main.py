from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .providers.demo import DemoProvider
from .runner import Runner
from .schemas import Capabilities, CreateRun, ErrorEnvelope, ErrorInfo, Health, ModelInfo, Run, SampleTasks
from .settings import Settings
from .store import RunActive, Store

LIVE_DISABLED = 'Live inference is not available in this demo milestone. Use Demo mode.'


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status = status
        self.error = ErrorInfo(code=code, message=message, details=details or {})


def error_response(status: int, error: ErrorInfo) -> JSONResponse:
    return JSONResponse(status_code=status, content=ErrorEnvelope(error=error).model_dump(mode='json'))


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    demo = DemoProvider()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.database_path)
        app.state.runner = Runner(app.state.store, demo)
        yield
        await app.state.runner.close()

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

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        return error_response(500, ErrorInfo(code='INTERNAL_ERROR', message='The request could not be completed.'))

    @app.get('/api/v1/health', response_model=Health)
    async def health():
        return Health()

    @app.get('/api/v1/capabilities', response_model=Capabilities)
    async def capabilities():
        return Capabilities(live_enabled=False, live_disabled_reason=LIVE_DISABLED,
                            models=[ModelInfo(role='small'), ModelInfo(role='large')], energy_profile=demo.profile)

    @app.get('/api/v1/sample-tasks', response_model=SampleTasks)
    async def samples():
        return demo.samples

    @app.post('/api/v1/runs', status_code=202, response_model=Run,
              responses={code: {'model': ErrorEnvelope} for code in (409, 422, 503, 500)})
    async def create_run(body: CreateRun, request: Request, response: Response):
        if len({task.id for task in body.tasks}) != len(body.tasks):
            raise APIError(422, 'DUPLICATE_TASK_ID', 'Task IDs must be unique.')
        if body.mode == 'live':
            raise APIError(503, 'LIVE_UNAVAILABLE', LIVE_DISABLED)
        if not demo.accepts(body.tasks):
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

    return app


app = create_app()
