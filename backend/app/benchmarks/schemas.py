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
    provenance: Literal['synthetic', 'curated']


class BenchmarkDatasetsResponse(Model):
    datasets: list[BenchmarkDataset]


class BenchmarkMetricSet(Model):
    total_cases: Count | None
    passed_cases: Count | None
    pass_rate: float | None = Field(ge=0, le=1)
    failed_cases: Count | None
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
    latency_ms: Nonnegative | None
    input_tokens: Count | None
    output_tokens: Count | None
    cost_usd: Nonnegative | None
    error: ErrorInfo | None


class BenchmarkCase(Model):
    case_id: str
    category: str
    status: Literal['passed', 'failed', 'skipped', 'error']
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
