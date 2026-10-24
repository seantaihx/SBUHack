// Mirrors contracts/openapi.json v1.0.0. The backend remains authoritative.
export type TaskType = 'classify' | 'extract' | 'summarize';
export type Mode = 'demo' | 'live';
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type Task = { id: string; type: TaskType; prompt: string };
export type SourceReference = {
  kind: 'pdf_page' | 'csv_cell' | 'webpage_text'; page_number: number | null; row_number: number | null;
  column_name: string | null; column_index: number | null; url: string | null; start_char: number; end_char: number; excerpt: string;
};
export type SourceMetadata = {
  source_id: string; kind: 'text' | 'pdf' | 'csv' | 'webpage'; name: string; media_type: string;
  original_url: string | null; final_url: string | null; retrieved_at: string | null; content_sha256: string;
  character_count: number; unit_count: number | null; parse_duration_ms: number; expires_at: string | null;
  references: SourceReference[]; references_complete: boolean;
};
export type SourceSnapshot = SourceMetadata & { extracted_text: string };
export type Coefficient = { input_wh_per_token: number; output_wh_per_token: number };
export type EnergyProfile = {
  id: 'illustrative-v1'; basis: 'hypothetical_demo_coefficients_not_measurements';
  default_carbon_intensity_g_per_kwh: number; models: { small: Coefficient; large: Coefficient };
};
export type Capabilities = {
  api_version: '1.0.0'; demo_enabled: boolean; live_enabled: boolean; live_disabled_reason: string | null;
  max_tasks: number; max_prompt_chars: number; policy_version: string;
  models: { role: 'small' | 'large'; live_model_id: string | null }[]; energy_profile: EnergyProfile;
};
export type SampleTasks = { version: 'sample-v1'; tasks: Task[] };
export type ApiErrorInfo = { code: string; message: string; details: Record<string, unknown> };
export type ApiErrorEnvelope = { error: ApiErrorInfo };
export type Result = {
  task_id: string; policy: 'baseline' | 'optimized'; model_role: 'small' | 'large'; model_id: string;
  routing_reason: 'baseline_large' | 'simple_task_small' | 'summary_large'; status: 'succeeded' | 'failed';
  output_text: string | null; latency_ms: number | null; input_tokens: number | null; output_tokens: number | null;
  estimated_energy_wh: number | null; estimated_carbon_g: number | null; error: ApiErrorInfo | null;
  provider_finish_reason: string | null; output_truncated: boolean | null;
};
export type ComparisonMetric = { baseline: number | null; optimized: number | null; saved: number | null; savings_pct: number | null };
export type Comparison = {
  successful_pairs: number; energy_pairs: number; latency_pairs: number;
  energy_wh: ComparisonMetric; carbon_g: ComparisonMetric; latency_ms: ComparisonMetric;
};
export type Run = {
  id: string; status: RunStatus; mode: Mode; measurement_source: 'simulated' | 'provider_usage_and_client_timing';
  policy_version: string; energy_estimation_profile: string; carbon_intensity_g_per_kwh: number; tasks: Task[];
  created_at: string; started_at: string | null; finished_at: string | null; total_attempts: number;
  completed_attempts: number; results: Result[]; comparison: Comparison; run_error: ApiErrorInfo | null;
  source_snapshot: SourceMetadata | null; source_submission_confirmed: boolean;
};
export type CreateRun = { mode: Mode; tasks: Task[]; carbon_intensity_g_per_kwh: number; source_snapshot_id?: string; confirm_source_submission?: true };

// Proposed benchmark API types. Keep these marked as proposals until Sean confirms the contract.
export type BenchmarkStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type BenchmarkConfig = { model_id: string; optimization_enabled: boolean };
export type BenchmarkDataset = {
  dataset_id: string; name: string; version: string; description: string; case_count: number;
  categories: string[]; supported_models: string[]; preview_models: string[]; max_cases_per_run: number; provenance: 'curated' | 'synthetic';
};
export type BenchmarkDatasetsResponse = { datasets: BenchmarkDataset[] };
export type BenchmarkMetricSet = {
  total_cases: number | null; evaluated_cases: number | null; passed_cases: number | null; pass_rate: number | null;
  failed_cases: number | null; incomplete_cases: number | null; total_cost_usd: number | null; mean_latency_ms: number | null;
  input_tokens: number | null; output_tokens: number | null; total_requests: number | null; error_count: number | null;
};
export type BenchmarkProgress = { completed: number; total: number };
export type BenchmarkRun = {
  run_id: string; status: BenchmarkStatus; dataset_id: string; progress: BenchmarkProgress;
  baseline: BenchmarkConfig; candidate: BenchmarkConfig; max_cases: number;
  measurement_source: 'simulated' | 'observed'; evaluation_method: string;
  baseline_metrics: BenchmarkMetricSet | null; candidate_metrics: BenchmarkMetricSet | null;
  created_at: string; started_at: string | null; finished_at: string | null;
  error: ApiErrorInfo | null;
};
export type StartBenchmarkRequest = {
  dataset_id: string; baseline: BenchmarkConfig; candidate: BenchmarkConfig; max_cases: number;
};
export type StartBenchmarkResponse = { run_id: string; status: 'queued' };
export type BenchmarkRunsResponse = { items: BenchmarkRun[]; next_cursor: string | null };
export type BenchmarkCaseSide = {
  model_id: string; provider_id: string; finish_reason: string | null; output_truncated: boolean | null;
  routing_reason: string | null; output: string | null; latency_ms: number | null;
  input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; error: ApiErrorInfo | null;
};
export type BenchmarkCase = {
  case_id: string; category: string; status: 'passed' | 'failed' | 'skipped' | 'error' | 'incomplete';
  evaluation_method: string; expected: string | null; baseline: BenchmarkCaseSide | null; candidate: BenchmarkCaseSide | null;
  evaluation_details: string | null;
};
export type BenchmarkCasesResponse = { items: BenchmarkCase[]; next_cursor: string | null };
export type BenchmarkExport = {
  export_version: 'benchmark-analysis-v1'; exported_at: string; data_completeness: 'complete' | 'partial';
  completeness_note: string | null; dataset: { dataset_id: string; version: string; provenance: 'curated' | 'synthetic'; cases: unknown[] };
  run: BenchmarkRun; pricing_snapshot: { provider_id: string; currency: string; basis: string; as_of: string; models: Record<string, { input_usd_per_million: number; output_usd_per_million: number }> };
  cases: { definition: unknown; outcome: Record<string, boolean | null>; result: BenchmarkCase }[];
};
