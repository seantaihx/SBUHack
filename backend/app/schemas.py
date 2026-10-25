"""Explicit API v1 models; nullable fields are always serialized."""
from typing import Annotated, Literal
from uuid import UUID
import re

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

Mode = Literal['demo', 'live']
Role = Literal['small', 'large']
Policy = Literal['baseline', 'optimized']
SourceKind = Literal['text', 'pdf', 'csv', 'webpage']
TaskType = Literal['classify', 'extract', 'summarize', 'write', 'code']
Reason = Literal['baseline_large', 'simple_task_small', 'summary_large', 'writing_large', 'coding_large', 'validation_fallback_large']
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Count = Annotated[int, Field(ge=0)]
Intensity = Annotated[float, Field(ge=0, le=2000, allow_inf_nan=False)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False,
                              json_schema_serialization_defaults_required=True)


class TaskConstraints(Model):
    allowed_labels: list[str] | None = Field(default=None, min_length=1, max_length=30)
    required_json_fields: list[str] | None = Field(default=None, min_length=1, max_length=30)

    @field_validator('allowed_labels', 'required_json_fields')
    @classmethod
    def unique_nonempty_items(cls, value):
        if value is None:
            return value
        if any(not item.strip() or len(item) > 100 for item in value):
            raise ValueError('Constraint values must be nonempty and bounded.')
        if len({item.casefold() for item in value}) != len(value):
            raise ValueError('Constraint values must be unique.')
        return [item.strip() for item in value]


class Task(Model):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,64}$')
    type: TaskType
    prompt: str = Field(min_length=1, max_length=2000)
    constraints: TaskConstraints | None = None

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

    @model_validator(mode='after')
    def constraints_match_type(self):
        if self.constraints:
            if self.constraints.allowed_labels and self.type != 'classify':
                raise ValueError('Allowed labels apply only to classification tasks.')
            if self.constraints.required_json_fields and self.type != 'extract':
                raise ValueError('Required JSON fields apply only to extraction tasks.')
        return self


class SourceReference(Model):
    kind: Literal['pdf_page', 'csv_cell', 'webpage_text']
    page_number: Count | None = None
    row_number: Count | None = None
    column_name: str | None = None
    column_index: Count | None = None
    url: str | None = None
    start_char: Count
    end_char: Count
    excerpt: str


class SourceMetadata(Model):
    source_id: UUID
    kind: SourceKind
    name: str
    media_type: str
    original_url: str | None = None
    final_url: str | None = None
    retrieved_at: str | None = None
    content_sha256: str
    character_count: Count
    unit_count: Count | None = None
    parse_duration_ms: Nonnegative
    expires_at: str | None = None
    references: list[SourceReference] = Field(default_factory=list)
    references_complete: bool = True


class SourceSnapshot(SourceMetadata):
    extracted_text: str


class SourceResponse(Model):
    source: SourceSnapshot


class CreateTextSource(Model):
    name: str = Field(default='Pasted text', max_length=200)
    text: str = Field(min_length=1, max_length=100000)


class CreateWebpageSource(Model):
    url: str = Field(min_length=1, max_length=2048)


class CreateRun(Model):
    mode: Mode
    tasks: list[Task] = Field(min_length=1, max_length=10)
    carbon_intensity_g_per_kwh: Intensity = 400
    source_snapshot_id: UUID | None = None
    confirm_source_submission: bool | None = None
    quality_fallback: bool = False
    small_model_id: str | None = Field(default=None, min_length=1, max_length=200)
    large_model_id: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator('source_snapshot_id', mode='before')
    @classmethod
    def parse_source_id(cls, value):
        if value is None or isinstance(value, UUID):
            return value
        try:
            return UUID(value) if isinstance(value, str) else value
        except ValueError:
            return value

    @model_validator(mode='after')
    def source_requires_confirmation(self):
        if self.source_snapshot_id is not None and self.confirm_source_submission is not True:
            raise ValueError('A source requires explicit submission confirmation.')
        if self.source_snapshot_id is None and self.confirm_source_submission is True:
            raise ValueError('Confirmation requires a source snapshot.')
        return self


class ErrorInfo(Model):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class ErrorEnvelope(Model):
    error: ErrorInfo


class Health(Model):
    status: Literal['ok'] = 'ok'
    api_version: Literal['1.1.0'] = '1.1.0'


class ActiveRunInfo(Model):
    id: str
    kind: Literal['comparison', 'benchmark', 'agent']
    status: str


class StopActiveRunRequest(Model):
    run_id: str | None = Field(default=None, pattern=r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


class SampleTasks(Model):
    version: Literal['sample-v1']
    tasks: list[Task]


class ModelInfo(Model):
    role: Role
    live_model_id: str | None = None


class FallbackAttempt(Model):
    model_role: Role
    model_id: str
    output_text: str | None
    latency_ms: Nonnegative | None
    input_tokens: Count | None
    output_tokens: Count | None
    cost_usd: Nonnegative | None
    estimated_energy_wh: Nonnegative | None
    estimated_carbon_g: Nonnegative | None
    measured_gpu_energy_wh: Nonnegative | None = None
    gpu_energy_measurement: Literal['nvidia_smi_power_draw'] | None = None
    gpu_device_index: Count | None = None
    gpu_device_name: str | None = Field(default=None, max_length=200)
    gpu_utilization_pct: Annotated[float, Field(ge=0, le=100)] | None = None
    gpu_average_power_w: Nonnegative | None = None
    gpu_sample_count: Count | None = None
    output_tokens_per_second: Nonnegative | None = None
    output_speed_source: Literal['ollama_eval_duration'] | None = None
    error: ErrorInfo | None
    provider_finish_reason: str | None = Field(default=None, max_length=64)
    output_truncated: bool | None = None
    output_validation: Literal['passed', 'failed', 'not_configured']
    validation_notes: list[str] = Field(default_factory=list)


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
    api_version: Literal['1.1.0'] = '1.1.0'
    demo_enabled: Literal[True] = True
    live_enabled: bool
    live_disabled_reason: str | None
    max_tasks: Literal[10] = 10
    max_prompt_chars: Literal[2000] = 2000
    policy_version: str = 'task-routing-v1'
    task_profile_version: str = 'task-instructions-v1'
    supported_task_types: list[TaskType] = Field(default_factory=lambda: ['classify', 'extract', 'summarize', 'write', 'code'])
    models: list[ModelInfo] = Field(min_length=2, max_length=2)
    supported_models: list[str] = Field(default_factory=list)
    energy_profile: EnergyProfile


class ProviderKeyInput(Model):
    api_key: SecretStr = Field(min_length=1, max_length=512)


class LocalProviderSettings(Model):
    local_setup_available: bool
    provider_key_configured: bool
    provider_key_saved_in_env: bool
    restart_required: bool
    environment_override: bool
    providers: dict[str, dict[str, bool]] = Field(default_factory=dict)


class ProviderModelOption(Model):
    id: str
    provider: str
    provider_label: str
    label: str
    local: bool


class AgentRoleModelAssignments(Model):
    manager: str = Field(min_length=1, max_length=200, pattern=r'^(?:[a-z]+::)?[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')
    writer: str = Field(min_length=1, max_length=200, pattern=r'^(?:[a-z]+::)?[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')
    coder: str = Field(min_length=1, max_length=200, pattern=r'^(?:[a-z]+::)?[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')
    reviewer: str = Field(min_length=1, max_length=200, pattern=r'^(?:[a-z]+::)?[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$')


class AgentRoleModelSettings(Model):
    available_models: list[str]
    model_options: list[ProviderModelOption] = Field(default_factory=list)
    active_models: AgentRoleModelAssignments
    saved_models: AgentRoleModelAssignments
    restart_required: bool
    environment_override: bool


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
    measured_gpu_energy_wh: Nonnegative | None = None
    gpu_energy_measurement: Literal['nvidia_smi_power_draw'] | None = None
    gpu_device_index: Count | None = None
    gpu_device_name: str | None = Field(default=None, max_length=200)
    gpu_utilization_pct: Annotated[float, Field(ge=0, le=100)] | None = None
    gpu_average_power_w: Nonnegative | None = None
    gpu_sample_count: Count | None = None
    output_tokens_per_second: Nonnegative | None = None
    output_speed_source: Literal['ollama_eval_duration'] | None = None
    error: ErrorInfo | None
    provider_finish_reason: str | None = Field(default=None, max_length=64)
    output_truncated: bool | None = None
    output_validation: Literal['passed', 'failed', 'not_configured'] = 'not_configured'
    validation_notes: list[str] = Field(default_factory=list)
    fallback_used: bool = False
    fallback_reason: str | None = None
    fallback_model_id: str | None = None
    initial_attempt: FallbackAttempt | None = None
    fallback_attempt: FallbackAttempt | None = None
    attempt_count: Count = 1
    cost_usd: Nonnegative | None = None


class ComparisonMetric(Model):
    baseline: Nonnegative | None = None
    optimized: Nonnegative | None = None
    saved: float | None = None
    savings_pct: float | None = None


class Comparison(Model):
    successful_pairs: Count = 0
    energy_pairs: Count = 0
    measured_gpu_energy_pairs: Count = 0
    latency_pairs: Count = 0
    energy_wh: ComparisonMetric = Field(default_factory=ComparisonMetric)
    measured_gpu_energy_wh: ComparisonMetric = Field(default_factory=ComparisonMetric)
    carbon_g: ComparisonMetric = Field(default_factory=ComparisonMetric)
    latency_ms: ComparisonMetric = Field(default_factory=ComparisonMetric)


class Run(Model):
    id: UUID
    status: Literal['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']
    mode: Mode
    measurement_source: Literal['simulated', 'provider_usage_and_client_timing']
    policy_version: str = 'task-routing-v1'
    task_profile_version: str = 'task-instructions-v1'
    quality_fallback: bool = False
    small_model_id: str | None = None
    large_model_id: str | None = None
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
    source_snapshot: SourceMetadata | None = None
    source_submission_confirmed: bool = False
