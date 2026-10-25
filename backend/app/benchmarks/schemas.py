from typing import Literal
from pydantic import Field
from ..schemas import Model, ErrorInfo, Nonnegative, Count


class BenchmarkConfig(Model):
    model_id: str = Field(min_length=1, max_length=200)
    optimization_enabled: bool


class StartBenchmarkRequest(Model):
    dataset_id: str = Field(min_length=1, max_length=64)
    baseline: BenchmarkConfig
    candidate: BenchmarkConfig
    max_cases: int = Field(ge=1, le=100)


class StartBenchmarkResponse(Model):
    run_id: str = Field(json_schema_extra={'format': 'uuid'})
    status: Literal['queued'] = 'queued'


class BenchmarkDataset(Model):
    dataset_id: str
    name: str
    version: str
    description: str
    case_count: Count
    categories: list[str]
    supported_models: list[str]
    preview_models: list[str] = Field(default_factory=list)
    max_cases_per_run: Count = 20
    provenance: Literal['synthetic', 'curated']


class BenchmarkCaseDefinition(Model):
    case_id: str
    category: str
    input: str
    expected: str | dict | int | float | None
    evaluation: dict


class BenchmarkDatasetDefinition(Model):
    dataset_id: str
    version: str
    provenance: Literal['synthetic', 'curated']
    cases: list[BenchmarkCaseDefinition]


class BenchmarkDatasetsResponse(Model):
    datasets: list[BenchmarkDataset]


class BenchmarkMetricSet(Model):
    total_cases: Count | None
    evaluated_cases: Count | None = None
    passed_cases: Count | None
    pass_rate: float | None = Field(ge=0, le=1)
    failed_cases: Count | None
    incomplete_cases: Count | None = None
    total_cost_usd: Nonnegative | None
    mean_latency_ms: Nonnegative | None
    input_tokens: Count | None
    output_tokens: Count | None
    total_requests: Count | None
    error_count: Count | None


class BenchmarkProgress(Model):
    completed: Count = 0
    total: Count


class BenchmarkRun(Model):
    run_id: str = Field(json_schema_extra={'format': 'uuid'})
    status: Literal['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']
    dataset_id: str
    progress: BenchmarkProgress
    baseline: BenchmarkConfig
    candidate: BenchmarkConfig
    max_cases: Count
    measurement_source: Literal['simulated', 'observed']
    evaluation_method: str = 'exact_match_or_deterministic_check'
    baseline_metrics: BenchmarkMetricSet | None = None
    candidate_metrics: BenchmarkMetricSet | None = None
    created_at: str = Field(json_schema_extra={'format': 'date-time'})
    started_at: str | None = Field(default=None, json_schema_extra={'format': 'date-time'})
    finished_at: str | None = Field(default=None, json_schema_extra={'format': 'date-time'})
    error: ErrorInfo | None = None


class BenchmarkCaseSide(Model):
    model_id: str
    routing_reason: str | None
    output: str | None
    provider_id: str = 'groq'
    finish_reason: str | None = None
    output_truncated: bool | None = None
    latency_ms: Nonnegative | None
    input_tokens: Count | None
    output_tokens: Count | None
    cost_usd: Nonnegative | None
    request_count: Count = 1
    router_model_id: str | None = None
    router_latency_ms: Nonnegative | None = None
    router_input_tokens: Count | None = None
    router_output_tokens: Count | None = None
    router_cost_usd: Nonnegative | None = None
    router_finish_reason: str | None = None
    error: ErrorInfo | None


class BenchmarkCase(Model):
    case_id: str
    category: str
    status: Literal['passed', 'failed', 'skipped', 'error', 'incomplete']
    evaluation_method: str
    expected: str | None
    baseline: BenchmarkCaseSide | None = None
    candidate: BenchmarkCaseSide | None = None
    evaluation_details: str | None = None


class BenchmarkRunsResponse(Model):
    items: list[BenchmarkRun]
    next_cursor: str | None = None


class BenchmarkCasesResponse(Model):
    items: list[BenchmarkCase]
    next_cursor: str | None = None


class BenchmarkRecord(Model):
    """Private persisted snapshot, never directly returned by the API."""
    run: BenchmarkRun
    cases: list[BenchmarkCase] = Field(default_factory=list)
    outcomes: list[dict[str, bool | None]] = Field(default_factory=list)
    dataset_snapshot: dict = Field(default_factory=dict)


class BenchmarkExport(Model):
    export_version: Literal['benchmark-analysis-v1'] = 'benchmark-analysis-v1'
    exported_at: str
    data_completeness: Literal['complete', 'partial']
    completeness_note: str | None
    dataset: BenchmarkDatasetDefinition
    run: BenchmarkRun
    pricing_snapshot: dict
    cases: list[dict]
