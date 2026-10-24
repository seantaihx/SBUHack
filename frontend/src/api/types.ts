// Mirrors contracts/openapi.json v1.0.0. The backend remains authoritative.
export type TaskType = 'classify' | 'extract' | 'summarize';
export type Mode = 'demo' | 'live';
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type Task = { id: string; type: TaskType; prompt: string };
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
};
export type CreateRun = { mode: Mode; tasks: Task[]; carbon_intensity_g_per_kwh: number };
