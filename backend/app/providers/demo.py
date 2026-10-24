"""Synthetic fixture inference; latency and token counts are NOT measurements."""
import asyncio
import json

from ..schemas import EnergyProfile, Policy, Role, SampleTasks, Task
from ..settings import ROOT
from .base import InferenceResult


class DemoProvider:
    def __init__(self):
        self.samples = SampleTasks.model_validate_json((ROOT / 'demo/tasks.json').read_text())
        self.profile = EnergyProfile.model_validate_json((ROOT / 'demo/estimation-profile.json').read_text())
        fixture = json.loads((ROOT / 'demo/results.json').read_text())
        self._delay = fixture['execution_delay_ms_per_attempt'] / 1000
        self._results = {(row['task_id'], row['policy']): row for row in fixture['results']}

    def accepts(self, tasks: list[Task]) -> bool:
        known = {task.id: task for task in self.samples.tasks}
        return all(task == known.get(task.id) for task in tasks)

    async def execute(self, task: Task, policy: Policy, role: Role) -> InferenceResult:
        await asyncio.sleep(self._delay)
        row = self._results[(task.id, policy)]
        if row['model_role'] != role:
            raise ValueError('Fixture does not match routing policy')
        return InferenceResult(row['output_text'], row['latency_ms'], row['input_tokens'], row['output_tokens'])
