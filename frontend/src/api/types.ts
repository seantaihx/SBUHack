// Mirrors contracts/openapi.json v1.1.0. The backend remains authoritative.
export type TaskType = 'classify' | 'extract' | 'summarize' | 'write' | 'code';
export type Mode = 'demo' | 'live';
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type ActiveRunInfo = { id: string; kind: 'comparison' | 'benchmark' | 'agent'; status: string };
export type TaskConstraints = { allowed_labels?: string[] | null; required_json_fields?: string[] | null };
export type Task = { id: string; type: TaskType; prompt: string; constraints?: TaskConstraints | null };
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
  api_version: '1.1.0'; demo_enabled: boolean; live_enabled: boolean; live_disabled_reason: string | null;
  max_tasks: number; max_prompt_chars: number; policy_version: string;
  task_profile_version: string; supported_task_types: TaskType[];
  models: { role: 'small' | 'large'; live_model_id: string | null }[]; supported_models: string[]; energy_profile: EnergyProfile;
};
export type LocalProviderSettings = {
  local_setup_available: boolean; provider_key_configured: boolean; provider_key_saved_in_env: boolean;
  restart_required: boolean; environment_override: boolean;
  providers: Record<string, { configured: boolean; saved_in_env: boolean; restart_required: boolean; environment_override: boolean; local_only?: boolean }>;
};
export type AgentRoleModelAssignments = { manager: string; writer: string; coder: string; reviewer: string };
export type ProviderModelOption = { id: string; provider: string; provider_label: string; label: string; local: boolean };
export type AgentRoleModelSettings = {
  available_models: string[]; model_options: ProviderModelOption[]; active_models: AgentRoleModelAssignments; saved_models: AgentRoleModelAssignments;
  restart_required: boolean; environment_override: boolean;
};
export type SampleTasks = { version: 'sample-v1'; tasks: Task[] };
export type ApiErrorInfo = { code: string; message: string; details: Record<string, unknown> };
export type ApiErrorEnvelope = { error: ApiErrorInfo };
export type Result = {
  task_id: string; policy: 'baseline' | 'optimized'; model_role: 'small' | 'large'; model_id: string;
  routing_reason: 'baseline_large' | 'simple_task_small' | 'summary_large' | 'writing_large' | 'coding_large' | 'validation_fallback_large'; status: 'succeeded' | 'failed';
  output_text: string | null; latency_ms: number | null; input_tokens: number | null; output_tokens: number | null;
  estimated_energy_wh: number | null; estimated_carbon_g: number | null; error: ApiErrorInfo | null;
  measured_gpu_energy_wh: number | null; gpu_energy_measurement: 'nvidia_smi_power_draw' | null;
  gpu_device_index: number | null; gpu_device_name: string | null; gpu_utilization_pct: number | null;
  gpu_average_power_w: number | null; gpu_sample_count: number | null;
  gpu_idle_baseline_power_w: number | null; gpu_idle_baseline_utilization_pct: number | null;
  gpu_idle_baseline_sample_count: number | null; gpu_idle_baseline_duration_ms: number | null; gpu_power_delta_w: number | null;
  output_tokens_per_second: number | null; output_speed_source: 'ollama_eval_duration' | null;
  provider_finish_reason: string | null; output_truncated: boolean | null;
  output_validation: 'passed' | 'failed' | 'not_configured'; validation_notes: string[];
  fallback_used: boolean; fallback_reason: string | null; fallback_model_id: string | null;
  initial_attempt: FallbackAttempt | null; fallback_attempt: FallbackAttempt | null; attempt_count: number; cost_usd: number | null;
};
export type FallbackAttempt = {
  model_role: 'small' | 'large'; model_id: string; output_text: string | null; latency_ms: number | null;
  input_tokens: number | null; output_tokens: number | null; cost_usd: number | null;
  estimated_energy_wh: number | null; estimated_carbon_g: number | null; error: ApiErrorInfo | null;
  measured_gpu_energy_wh: number | null; gpu_energy_measurement: 'nvidia_smi_power_draw' | null;
  gpu_device_index: number | null; gpu_device_name: string | null; gpu_utilization_pct: number | null;
  gpu_average_power_w: number | null; gpu_sample_count: number | null;
  gpu_idle_baseline_power_w: number | null; gpu_idle_baseline_utilization_pct: number | null;
  gpu_idle_baseline_sample_count: number | null; gpu_idle_baseline_duration_ms: number | null; gpu_power_delta_w: number | null;
  output_tokens_per_second: number | null; output_speed_source: 'ollama_eval_duration' | null;
  provider_finish_reason: string | null; output_truncated: boolean | null;
  output_validation: 'passed' | 'failed' | 'not_configured'; validation_notes: string[];
};
export type ComparisonMetric = { baseline: number | null; optimized: number | null; saved: number | null; savings_pct: number | null };
export type Comparison = {
  successful_pairs: number; energy_pairs: number; measured_gpu_energy_pairs: number; latency_pairs: number;
  energy_wh: ComparisonMetric; measured_gpu_energy_wh: ComparisonMetric; carbon_g: ComparisonMetric; latency_ms: ComparisonMetric;
};
export type Run = {
  id: string; status: RunStatus; mode: Mode; measurement_source: 'simulated' | 'provider_usage_and_client_timing';
  policy_version: string; task_profile_version: string; quality_fallback: boolean;
  small_model_id: string | null; large_model_id: string | null;
  energy_estimation_profile: string; carbon_intensity_g_per_kwh: number; tasks: Task[];
  created_at: string; started_at: string | null; finished_at: string | null; total_attempts: number;
  completed_attempts: number; results: Result[]; comparison: Comparison; run_error: ApiErrorInfo | null;
  source_snapshot: SourceMetadata | null; source_submission_confirmed: boolean;
};
export type CreateRun = { mode: Mode; tasks: Task[]; carbon_intensity_g_per_kwh: number; quality_fallback?: boolean; small_model_id?: string; large_model_id?: string; source_snapshot_id?: string; confirm_source_submission?: true };

export type AgentCapabilities = {
  enabled: boolean; disabled_reason: string | null; workspace_name: string | null;
  task_types: ('write' | 'code')[]; operations: ('read_file' | 'write_file')[];
  approval_required_for_each_operation: true; shell_execution_enabled: false; network_tools_enabled: false;
  max_steps: number; max_file_chars: number;
  team_workflows_enabled: true; team_roles: ('manager' | 'writer' | 'coder' | 'reviewer')[];
  max_workflow_tasks: number; parallel_workers: 1; max_task_calls: number; max_runtime_seconds: number;
  max_tokens_per_run: number; max_tokens_per_task: number;
};
export type AgentCompletionCheck = {
  check_id: string; kind: 'file_exists' | 'file_changed' | 'contains_text' | 'valid_json';
  path: string; expected_text: string | null;
};
export type AgentCompletionCheckResult = {
  check_id: string; kind: AgentCompletionCheck['kind']; path: string;
  status: 'passed' | 'failed' | 'not_verifiable'; message: string;
};
export type AgentPendingAction = {
  action_id: string; action_hash: string; operation: 'read_file' | 'write_file'; path: string;
  summary: string; content: string | null; before_text: string | null; base_sha256: string | null;
  task_id: string | null; agent_name: string | null; agent_role: 'writer' | 'coder' | 'reviewer' | null;
};
export type AgentEvent = {
  sequence: number; occurred_at: string; actor: 'manager' | 'agent' | 'operator' | 'policy' | 'tool';
  task_id: string | null; agent_name: string | null; agent_role: 'manager' | 'writer' | 'coder' | 'reviewer' | null;
  model_id?: string | null;
  operation: string; target: string | null;
  decision: 'proposed' | 'approved' | 'denied' | 'denied_out_of_scope' | 'denied_duplicate' | 'completed' | 'failed' | 'stopped';
  summary: string; action_hash: string | null; details: string | null;
};
export type AgentWorkflowTask = {
  task_id: string; agent_name: string; role: 'writer' | 'coder' | 'reviewer'; title: string; instruction: string;
  model_id?: string | null;
  read_paths: string[]; write_paths: string[]; depends_on: string[]; success_criteria: string[];
  status: 'planned' | 'queued' | 'running' | 'awaiting_approval' | 'paused' | 'completed' | 'blocked' | 'failed' | 'cancelled';
  model_calls: number; max_model_calls: number; steps_completed: number; input_tokens: number | null; output_tokens: number | null;
  usage_reported_calls: number; estimated_cost_usd: number | null; max_tokens: number; reserved_output_tokens: number; retry_count: number; result_summary: string | null;
  final_text: string | null; stop_reason: string | null;
};
export type AgentHandoffTask = {
  task_id: string; agent_name: string; role: 'writer' | 'coder' | 'reviewer'; title: string;
  instruction_summary?: string; status: AgentWorkflowTask['status']; model_id: string | null;
  read_paths?: string[]; write_paths?: string[]; depends_on: string[]; success_criteria: string[];
  result_summary: string | null; model_calls: number; max_model_calls: number;
  input_tokens: number | null; output_tokens: number | null; usage_reported_calls: number;
  estimated_cost_usd: number | null; retry_count: number; stop_reason: string | null;
};
export type AgentHandoff = {
  updated_at: string; original_task_summary: string; summary: string; completed_task_ids: string[]; remaining_task_ids: string[];
  blocked_task_ids: string[]; files_read: string[]; files_changed: string[]; action_counts: Record<string, number>;
  actions: { sequence: number; actor: AgentEvent['actor']; agent_name: string | null; agent_role: AgentEvent['agent_role']; model_id?: string | null; operation: string; target: string | null; decision: AgentEvent['decision']; summary: string }[];
  tasks?: AgentHandoffTask[]; manager_retry_count?: number;
  role_model_ids?: Partial<AgentRoleModelAssignments>;
  completion_check_results: AgentCompletionCheckResult[]; model_id: string | null; model_calls_used: number;
  model_calls_remaining: number; deadline_at: string | null; max_run_cost_usd: number | null; max_task_cost_usd: number | null;
  max_tokens_per_run: number; max_tokens_per_task: number; reported_tokens_remaining: number; reserved_output_tokens: number;
  input_tokens: number | null; output_tokens: number | null; usage_reported_calls: number;
  estimated_cost_usd: number | null; estimated_carbon_g: number | null; retry_count: number;
  stop_reason: string | null; next_steps: string[];
};
export type AgentRun = {
  run_id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: 'planning' | 'awaiting_plan_approval' | 'awaiting_approval' | 'paused' | 'completed' | 'failed';
  task_type: 'write' | 'code'; workspace_name: string; instruction: string;
  read_paths: string[]; write_paths: string[]; max_steps: number; checkpoint_sequence: number; checkpoint_at: string;
  model_calls: number; repeated_failure_count: number; retry_count: number; last_failure_fingerprint: string | null; steps_completed: number;
  pending_action: AgentPendingAction | null; events: AgentEvent[];
  completion_checks: AgentCompletionCheck[]; completion_check_baselines: Record<string, string | null>;
  completion_check_results: AgentCompletionCheckResult[]; verification_status: 'not_requested' | 'pending' | 'verified' | 'failed';
  final_text: string | null;
  stop_reason: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  run_mode: 'single' | 'team';
  workflow_stage: 'planning' | 'plan_review' | 'executing' | 'reviewing' | 'completed' | 'failed' | null;
  max_tasks: number; max_task_calls: number; max_runtime_seconds: number | null; workflow_deadline_at: string | null;
  max_run_cost_usd: number | null; max_task_cost_usd: number | null;
  max_tokens_per_run: number; max_tokens_per_task: number; reserved_output_tokens: number; manager_reserved_output_tokens: number;
  workflow_tasks: AgentWorkflowTask[]; active_task_id: string | null;
  role_model_ids?: Partial<AgentRoleModelAssignments>;
  plan_hash: string | null; plan_approved: boolean; manager_summary: string | null; manager_open_items: string[];
  manager_model_calls: number; manager_input_tokens: number | null; manager_output_tokens: number | null;
  manager_usage_reported_calls: number; manager_estimated_cost_usd: number | null;
  manager_retry_count: number;
  agent_model_id: string | null; input_tokens: number | null; output_tokens: number | null;
  usage_reported_calls: number; estimated_cost_usd: number | null; handoff: AgentHandoff | null;
};
export type AgentStartRequest = {
  task_type: 'write' | 'code'; instruction: string; confirm_provider_submission: true;
  read_paths: string[]; write_paths: string[]; max_steps: number; completion_checks: AgentCompletionCheck[];
};
export type AgentWorkflowStartRequest = {
  instruction: string; confirm_provider_submission: true; read_paths: string[]; write_paths: string[];
  max_steps: number; max_tasks: number; max_task_calls: number; max_runtime_seconds: number;
  completion_checks: AgentCompletionCheck[];
};
export type AgentEventsResponse = { events: AgentEvent[]; next_cursor: string | null };

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
  input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; request_count: number;
  router_model_id: string | null; router_latency_ms: number | null; router_input_tokens: number | null;
  router_output_tokens: number | null; router_cost_usd: number | null; router_finish_reason: string | null;
  error: ApiErrorInfo | null;
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
