import asyncio
import logging
import math
from uuid import uuid4

from ..errors import APIError
from ..pricing import PRICES, cost
from ..providers.base import InferenceResult, ProviderError
from ..providers.live import LiveProvider
from ..schemas import ErrorInfo
from ..timestamps import now
from .catalog import dataset, evaluate, expected_text
from .schemas import (BenchmarkRecord, BenchmarkRun, BenchmarkProgress, BenchmarkDataset,
                      BenchmarkCase, BenchmarkCaseSide, BenchmarkMetricSet, StartBenchmarkResponse)


class BenchmarkService:
    def __init__(self, store, settings):
        self.store = store
        self.settings = settings
        self.data = {key: dataset(key) for key in ('starter-v1', 'starter-v2')}
        self.worker = None
        self.live = LiveProvider(settings, store)

    def catalog(self):
        models = list(dict.fromkeys((self.settings.small_model_id, self.settings.large_model_id, *self.settings.benchmark_extra_model_ids)))
        models = [model for model in models if model in PRICES]
        max_cases = min(self.settings.benchmark_max_cases, self.settings.max_requests_per_run // 2)
        return [BenchmarkDataset(dataset_id=data['dataset_id'], name='EcoAgent Starter',
                                 version=data['version'], provenance=data['provenance'],
                                 description='Synthetic deterministic checks; live inference is explicit and preview model access may vary by account.',
                                 case_count=len(data['cases']), categories=list(dict.fromkeys(c['category'] for c in data['cases'])),
                                 supported_models=models,
                                 preview_models=[model for model in self.settings.benchmark_extra_model_ids if model in models],
                                 max_cases_per_run=min(max_cases, len(data['cases'])))
                for data in self.data.values()]

    def model_ids(self):
        return self.catalog()[0].supported_models

    def submit(self, request):
        data = self.data.get(request.dataset_id)
        if data is None:
            raise APIError(404, 'DATASET_NOT_FOUND', 'The benchmark dataset was not found.')
        effective_limit = min(len(data['cases']), self.settings.benchmark_max_cases, self.settings.max_requests_per_run // 2)
        if request.max_cases > effective_limit:
            raise APIError(422, 'VALIDATION_ERROR', 'The case cap exceeds the dataset or server limit.')
        models = self.model_ids()
        if request.baseline.model_id not in models or request.candidate.model_id not in models + ['eco-auto']:
            raise APIError(422, 'UNSUPPORTED_MODEL', 'Choose a supported model or the eco-auto candidate policy.')
        if request.baseline.optimization_enabled or request.candidate.optimization_enabled != (request.candidate.model_id == 'eco-auto'):
            raise APIError(422, 'VALIDATION_ERROR', 'Optimization is supported only by the eco-auto candidate.')
        effective_limit = min(effective_limit, self.effective_case_budget(request))
        if request.max_cases > effective_limit:
            raise APIError(422, 'VALIDATION_ERROR', 'The selected models and current server budgets allow fewer cases per run.',
                           {'max_cases_per_run': effective_limit})
        if self.settings.benchmark_mode == 'groq' and self.settings.live_disabled_reason:
            raise APIError(503, 'PROVIDER_UNAVAILABLE', self.settings.live_disabled_reason)
        run = BenchmarkRun(run_id=str(uuid4()), status='queued', dataset_id=request.dataset_id,
                           progress=BenchmarkProgress(total=request.max_cases), baseline=request.baseline,
                           candidate=request.candidate, max_cases=request.max_cases,
                           measurement_source='simulated' if self.settings.benchmark_mode == 'simulated' else 'observed', created_at=now())
        record = BenchmarkRecord(run=run, dataset_snapshot=data)
        self.store.create_benchmark(record, self.settings.benchmark_runs_per_minute)
        self.worker = asyncio.create_task(self.execute(record))
        return StartBenchmarkResponse(run_id=run.run_id)

    def effective_case_budget(self, request):
        limit = min(self.settings.benchmark_max_cases, self.settings.max_requests_per_run // 2)
        if self.settings.benchmark_mode != 'groq':
            return limit
        baseline_ceiling = cost(request.baseline.model_id, 131072, 256)
        candidate_models = ((self.settings.small_model_id, self.settings.large_model_id)
                            if request.candidate.model_id == 'eco-auto' else (request.candidate.model_id,))
        candidate_ceiling = max(cost(model, 131072, 256) for model in candidate_models)
        pair_ceiling = baseline_ceiling + candidate_ceiling
        if pair_ceiling <= 0:
            return 0
        remaining = min(self.settings.max_run_cost_usd, self.store.remaining_daily_cost(self.settings))
        return min(limit, math.floor((remaining + 1e-12) / pair_ceiling))

    def route(self, case, config, side):
        if config.model_id != 'eco-auto':
            return config.model_id, 'fixed_baseline' if side == 'baseline' else 'fixed_candidate'
        simple = case['category'] in ('classification', 'extraction', 'arithmetic')
        return (self.settings.small_model_id, 'simple_task_small') if simple else (self.settings.large_model_id, 'complex_task_large')

    async def infer(self, case, model, run_id):
        if self.settings.benchmark_mode == 'groq':
            return await self.live.infer(case['input'], model, run_id, allowed_models=self.model_ids())
        # These are deliberately synthetic counts and latencies; not a model-quality experiment.
        await asyncio.sleep(0.15)
        return InferenceResult(expected_text(case), 500 if model == self.settings.small_model_id else 1200, 60, 20, None, False)

    def metrics(self, record, side):
        rows = [(getattr(case, side), result.get(side)) for case, result in zip(record.cases, record.outcomes)
                if getattr(case, side) is not None]
        if not rows:
            return None
        count = len(rows)
        passed = sum(value is True for _, value in rows)
        failed = sum(value is False for _, value in rows)
        incomplete = sum(value is None and row.error is None for row, value in rows)
        evaluated = passed + failed
        errors = sum(row.error is not None for row, _ in rows)
        def total(field):
            values = [getattr(row, field) for row, _ in rows]
            return sum(values) if all(v is not None for v in values) else None
        latency = total('latency_ms')
        return BenchmarkMetricSet(total_cases=count, evaluated_cases=evaluated, passed_cases=passed, failed_cases=failed,
                                  incomplete_cases=incomplete, pass_rate=passed/evaluated if evaluated else None, total_cost_usd=total('cost_usd'),
                                  mean_latency_ms=latency/count if latency is not None else None,
                                  input_tokens=total('input_tokens'), output_tokens=total('output_tokens'),
                                  total_requests=sum(row.error is None or row.error.details.get('request_dispatched', True)
                                                     for row, _ in rows), error_count=errors)

    async def execute(self, record):
        run = record.run
        try:
            run.status = 'running'; run.started_at = now()
            self.store.save_benchmark(record)
            data = record.dataset_snapshot
            for case in data['cases'][:run.max_cases]:
                result = BenchmarkCase(case_id=case['case_id'], category=case['category'], status='skipped',
                                       evaluation_method=case['evaluation']['method'], expected=expected_text(case),
                                       evaluation_details='Pending paired attempts.')
                record.cases.append(result); record.outcomes.append({})
                for side in ('baseline', 'candidate'):
                    model, reason = self.route(case, getattr(run, side), side)
                    try:
                        try:
                            async with asyncio.timeout(30):
                                output = await self.infer(case, model, run.run_id)
                        except TimeoutError:
                            raise ProviderError('PROVIDER_TIMEOUT') from None
                        truncated = output.output_truncated is not False
                        value = BenchmarkCaseSide(model_id=model, routing_reason=reason, output=output.output_text,
                                                  provider_id='groq' if self.settings.benchmark_mode == 'groq' else 'synthetic_fixture',
                                                  finish_reason=output.finish_reason, output_truncated=output.output_truncated,
                                                  latency_ms=output.latency_ms, input_tokens=output.input_tokens,
                                                  output_tokens=output.output_tokens,
                                                  cost_usd=cost(model, output.input_tokens, output.output_tokens), error=None)
                        record.outcomes[-1][side] = None if truncated else evaluate(case, output.output_text)
                    except ProviderError as exc:
                        value = BenchmarkCaseSide(model_id=model, routing_reason=reason, output=None,
                                                  provider_id='groq' if self.settings.benchmark_mode == 'groq' else 'synthetic_fixture',
                                                  finish_reason=None, output_truncated=None, latency_ms=None,
                                                  input_tokens=None, output_tokens=None, cost_usd=None, error=exc.error)
                        record.outcomes[-1][side] = None
                    setattr(result, side, value)
                    run.baseline_metrics = self.metrics(record, 'baseline')
                    run.candidate_metrics = self.metrics(record, 'candidate')
                    if side == 'candidate':
                        outcomes = list(record.outcomes[-1].values())
                        result.status = ('error' if result.baseline.error or result.candidate.error else
                                         'incomplete' if any(value is None for value in outcomes) else
                                         'passed' if all(outcomes) else 'failed')
                        result.evaluation_details = ('At least one output was truncated or its completion status is unavailable; no correctness check was counted.' if result.status == 'incomplete' else
                                                     'Deterministic lexical/JSON checks only; not semantic quality equivalence.')
                        run.progress.completed += 1
                    self.store.save_benchmark(record)
            run.status = 'partial' if any(c.status == 'error' for c in record.cases) else 'completed'
            run.finished_at = now(); self.store.save_benchmark(record)
        except asyncio.CancelledError:
            self.fail(record, 'RUN_INTERRUPTED'); raise
        except Exception:
            self.fail(record, 'INTERNAL_ERROR')

    def fail(self, record, code):
        record.run.status = 'failed'; record.run.finished_at = now()
        record.run.error = ErrorInfo(code=code, message='The benchmark could not finish.')
        try:
            self.store.save_benchmark(record)
        except Exception:
            logging.getLogger(__name__).error('Unable to persist benchmark failure; recovery is required.')

    async def close(self):
        if self.worker:
            self.worker.cancel()
            try:
                await self.worker
            except asyncio.CancelledError:
                pass
