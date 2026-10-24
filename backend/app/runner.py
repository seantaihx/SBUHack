"""One serial background worker; queued snapshot is persisted before returning."""
import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from .metrics import compare, estimate
from .policy import route
from .providers.demo import DemoProvider
from .schemas import CreateRun, ErrorInfo, Result, Run
from .store import Store


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class Runner:
    def __init__(self, store: Store, provider: DemoProvider):
        self.store = store
        self.provider = provider
        self._worker: asyncio.Task | None = None

    def submit(self, request: CreateRun) -> Run:
        run = Run(id=uuid4(), status='queued', mode=request.mode, measurement_source='simulated',
                  carbon_intensity_g_per_kwh=request.carbon_intensity_g_per_kwh,
                  tasks=request.tasks, created_at=now(), total_attempts=2 * len(request.tasks))
        self.store.create(run)
        self._worker = asyncio.create_task(self._execute(str(run.id)))
        return run

    async def _execute(self, run_id: str):
        run = self.store.get(run_id)
        try:
            run.status = 'running'
            run.started_at = now()
            self.store.save(run)
            for task in run.tasks:
                for policy in ('baseline', 'optimized'):
                    role, reason = route(task, policy)
                    output = await self.provider.execute(task, policy, role)
                    energy, carbon = estimate(self.provider.profile, role, output.input_tokens,
                                              output.output_tokens, run.carbon_intensity_g_per_kwh)
                    run.results.append(Result(task_id=task.id, policy=policy, model_role=role,
                                              model_id=f'demo-{role}', routing_reason=reason,
                                              status='succeeded', output_text=output.output_text,
                                              latency_ms=output.latency_ms, input_tokens=output.input_tokens,
                                              output_tokens=output.output_tokens, estimated_energy_wh=energy,
                                              estimated_carbon_g=carbon, error=None))
                    run.completed_attempts = len(run.results)
                    run.comparison = compare(run.results)
                    self.store.save(run)
            run.status = 'completed'
            run.finished_at = now()
            self.store.save(run)
        except asyncio.CancelledError:
            # Startup recovery is added in the full execution milestone.
            raise
        except Exception:
            run.status = 'failed'
            run.finished_at = now()
            run.run_error = ErrorInfo(code='INTERNAL_ERROR', message='The comparison could not finish.')
            self.store.save(run)

    async def close(self):
        if self._worker is not None:
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
