from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Query, Request, Response
from ..errors import APIError
from ..schemas import ErrorEnvelope
from ..store import RunActive
from . import pagination
from .schemas import (BenchmarkDatasetsResponse, BenchmarkRunsResponse, StartBenchmarkRequest,
                      StartBenchmarkResponse, BenchmarkRun, BenchmarkCasesResponse)

router = APIRouter(prefix='/api/v1/benchmarks')


def get_record(request, run_id):
    record = request.app.state.store.get_benchmark(str(run_id))
    if record is None:
        raise APIError(404, 'RUN_NOT_FOUND', 'The benchmark run was not found.')
    return record


@router.get('/datasets', response_model=BenchmarkDatasetsResponse, responses={500: {'model': ErrorEnvelope}})
async def datasets(request: Request):
    return BenchmarkDatasetsResponse(datasets=[request.app.state.benchmarks.catalog()])


@router.post('/runs', status_code=202, response_model=StartBenchmarkResponse, responses={code: {'model': ErrorEnvelope} for code in (404, 409, 422, 429, 503, 500)})
async def start(body: StartBenchmarkRequest, request: Request, response: Response):
    try:
        result = request.app.state.benchmarks.submit(body)
    except RunActive as exc:
        raise APIError(409, 'RUN_ALREADY_ACTIVE', 'Another comparison or benchmark is already running.',
                       {'active_run_id': exc.run_id, 'active_run_kind': exc.kind}) from None
    response.headers['Location'] = '/api/v1/benchmarks/runs/' + result.run_id
    return result


@router.get('/runs', response_model=BenchmarkRunsResponse, responses={code: {'model': ErrorEnvelope} for code in (422, 500)})
async def history(request: Request, limit: int = Query(20, ge=1, le=100), cursor: str | None = None):
    key = pagination.decode(cursor, 'runs')
    if key is not None:
        try:
            if len(key) != 2 or not all(isinstance(v, str) for v in key) or not key[0].endswith('Z'):
                raise ValueError()
            datetime.fromisoformat(key[0])
            UUID(key[1])
        except ValueError:
            raise APIError(422, 'VALIDATION_ERROR', 'The history cursor is invalid.') from None
    runs = request.app.state.store.list_benchmarks(limit + 1, key)
    next_cursor = pagination.encode('runs', [runs[limit-1].created_at, runs[limit-1].run_id]) if len(runs) > limit else None
    return BenchmarkRunsResponse(items=runs[:limit], next_cursor=next_cursor)


@router.get('/runs/{run_id}', response_model=BenchmarkRun, responses={code: {'model': ErrorEnvelope} for code in (404, 422, 500)})
async def snapshot(run_id: UUID, request: Request):
    return get_record(request, run_id).run


@router.get('/runs/{run_id}/cases', response_model=BenchmarkCasesResponse, responses={code: {'model': ErrorEnvelope} for code in (404, 422, 500)})
async def cases(run_id: UUID, request: Request, limit: int = Query(50, ge=1, le=100), cursor: str | None = None):
    record = get_record(request, run_id)
    key = pagination.decode(cursor, 'cases:' + str(run_id))
    if key is not None and (len(key) != 1 or type(key[0]) is not int or key[0] < 0 or key[0] > len(record.cases)):
        raise APIError(422, 'VALIDATION_ERROR', 'The case cursor is invalid.')
    offset = key[0] if key else 0
    end = offset + limit
    return BenchmarkCasesResponse(items=record.cases[offset:end], next_cursor=(
        pagination.encode('cases:' + str(run_id), [end]) if end < len(record.cases) else None))
