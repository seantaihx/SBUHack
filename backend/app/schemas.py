"""Explicit API v1 models; nullable fields are always serialized."""
from typing import Annotated, Literal
from uuid import UUID
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

Mode = Literal['demo', 'live']
Role = Literal['small', 'large']
Policy = Literal['baseline', 'optimized']
Reason = Literal['baseline_large', 'simple_task_small', 'summary_large']
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Count = Annotated[int, Field(ge=0)]
Intensity = Annotated[float, Field(ge=0, le=2000, allow_inf_nan=False)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False,
                              json_schema_serialization_defaults_required=True)


class Task(Model):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,64}$')
    type: Literal['classify', 'extract', 'summarize']
    prompt: str = Field(min_length=1, max_length=2000)

    @field_validator('id')
    @classmethod
    def valid_id(cls, value: str) -> str:
        if re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value) is None:
            raise ValueError('Invalid task ID')
        return value

    @field_validator('prompt', mode='before')
    @classmethod
    def trim_prompt(cls, value):
        return value.strip() if isinstance(value, str) else value


class CreateRun(Model):
    mode: Mode
    tasks: list[Task] = Field(min_length=1, max_length=10)
    carbon_intensity_g_per_kwh: Intensity = 400


class ErrorInfo(Model):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class ErrorEnvelope(Model):
    error: ErrorInfo


class Health(Model):
    status: Literal['ok'] = 'ok'
    api_version: Literal['1.0.0'] = '1.0.0'


class SampleTasks(Model):
    version: Literal['sample-v1']
    tasks: list[Task]


class ModelInfo(Model):
    role: Role
    live_model_id: str | None = None


class Coefficient(Model):
    input_wh_per_token: Nonnegative
    output_wh_per_token: Nonnegative


class EnergyModels(Model):
    small: Coefficient
    large: Coefficient


class EnergyProfile(Model):
    id: Literal['illustrative-v1']
    basis: Literal['hypothetical_demo_coefficients_not_measurements']
    default_carbon_intensity_g_per_kwh: Literal[400]
    models: EnergyModels


class Capabilities(Model):
    api_version: Literal['1.0.0'] = '1.0.0'
    demo_enabled: Literal[True] = True
    live_enabled: bool
    live_disabled_reason: str | None
    max_tasks: Literal[10] = 10
    max_prompt_chars: Literal[2000] = 2000
    policy_version: Literal['task-routing-v1'] = 'task-routing-v1'
    models: list[ModelInfo] = Field(min_length=2, max_length=2)
    energy_profile: EnergyProfile


class Result(Model):
    task_id: str
    policy: Policy
    model_role: Role
    model_id: str
    routing_reason: Reason
    status: Literal['succeeded', 'failed']
    output_text: str | None
    latency_ms: Nonnegative | None
    input_tokens: Count | None
    output_tokens: Count | None
    estimated_energy_wh: Nonnegative | None
    estimated_carbon_g: Nonnegative | None
    error: ErrorInfo | None


class ComparisonMetric(Model):
    baseline: Nonnegative | None = None
    optimized: Nonnegative | None = None
    saved: float | None = None
    savings_pct: float | None = None


class Comparison(Model):
    successful_pairs: Count = 0
    energy_pairs: Count = 0
    latency_pairs: Count = 0
    energy_wh: ComparisonMetric = Field(default_factory=ComparisonMetric)
    carbon_g: ComparisonMetric = Field(default_factory=ComparisonMetric)
    latency_ms: ComparisonMetric = Field(default_factory=ComparisonMetric)


class Run(Model):
    id: UUID
    status: Literal['queued', 'running', 'completed', 'partial', 'failed']
    mode: Mode
    measurement_source: Literal['simulated', 'provider_usage_and_client_timing']
    policy_version: Literal['task-routing-v1'] = 'task-routing-v1'
    energy_estimation_profile: Literal['illustrative-v1'] = 'illustrative-v1'
    carbon_intensity_g_per_kwh: Intensity
    tasks: list[Task] = Field(min_length=1, max_length=10)
    created_at: str = Field(json_schema_extra={'format': 'date-time'})
    started_at: str | None = Field(default=None, json_schema_extra={'format': 'date-time'})
    finished_at: str | None = Field(default=None, json_schema_extra={'format': 'date-time'})
    total_attempts: Count
    completed_attempts: Count = 0
    results: list[Result] = Field(default_factory=list)
    comparison: Comparison = Field(default_factory=Comparison)
    run_error: ErrorInfo | None = None
