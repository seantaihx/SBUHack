"""Bounded, approval-gated workspace agent API models."""
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .schemas import Model, ErrorInfo, Nonnegative


class AgentCapabilities(Model):
    enabled: bool
    disabled_reason: str | None
    workspace_name: str | None
    task_types: list[Literal['write', 'code']] = ['write', 'code']
    operations: list[Literal['read_file', 'write_file']] = ['read_file', 'write_file']
    approval_required_for_each_operation: Literal[True] = True
    shell_execution_enabled: Literal[False] = False
    network_tools_enabled: Literal[False] = False
    max_steps: int = 100
    default_steps: int = 12
    default_review_interval: int = 5
    max_file_chars: int = 50000


class AgentStartRequest(Model):
    task_type: Literal['write', 'code']
    instruction: str = Field(min_length=1, max_length=5000)
    confirm_provider_submission: Literal[True]
    read_paths: list[str] = Field(default_factory=list, max_length=20)
    write_paths: list[str] = Field(default_factory=list, max_length=20)
    max_steps: int = Field(default=12, ge=1, le=1000)
    review_interval: int = Field(default=5, ge=1, le=20)
    max_elapsed_seconds: int = Field(default=3600, ge=60, le=86400)
    checklist: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("checklist")
    @classmethod
    def bounded_checklist(cls, value):
        if any(not item.strip() or len(item) > 300 for item in value):
            raise ValueError("Checklist items must be nonempty and at most 300 characters.")
        return [item.strip() for item in value]

    @field_validator('instruction', mode='before')
    @classmethod
    def trim_instruction(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('read_paths', 'write_paths')
    @classmethod
    def unique_paths(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Paths must be unique.')
        return value

    @model_validator(mode='after')
    def at_least_one_scope(self):
        if not self.read_paths and not self.write_paths:
            raise ValueError('Provide at least one exact path in the allowed read/write scope.')
        return self


class AgentPendingAction(Model):
    action_id: UUID
    action_hash: str
    operation: Literal['read_file', 'write_file']
    path: str
    summary: str = Field(max_length=240)
    content: str | None = None
    before_text: str | None = None
    base_sha256: str | None = None
    diff: str | None = None


class AgentEvent(Model):
    sequence: int = Field(ge=1)
    occurred_at: str
    actor: Literal['agent', 'operator', 'policy', 'tool']
    operation: str = Field(max_length=80)
    target: str | None = Field(default=None, max_length=500)
    decision: Literal['proposed', 'approved', 'denied', 'denied_out_of_scope', 'denied_duplicate', 'completed', 'failed', 'stopped']
    summary: str = Field(max_length=300)
    action_hash: str | None = None
    details: str | None = Field(default=None, max_length=50000)


class AgentObservation(Model):
    model_call: int
    operation: Literal['read_file', 'write_file']
    path: str
    before_sha256: str | None = None
    after_sha256: str


class AgentCheckpoint(Model):
    sequence: int
    created_at: str
    model_calls: int
    event_cursor: int
    observation_cursor: int
    new_reads: int
    changed_writes: int
    failures: int
    assessment: Literal['observed_progress', 'stalled', 'uncertain']
    summary: str


class AgentRevision(Model):
    path: str
    created_at: str
    before_text: str | None
    after_text: str


class AgentRun(Model):
    run_id: UUID
    status: Literal['queued', 'running', 'completed', 'failed', 'cancelled']
    phase: Literal['planning', 'awaiting_approval', 'paused', 'completed', 'failed']
    task_type: Literal['write', 'code']
    workspace_name: str
    instruction: str
    read_paths: list[str]
    write_paths: list[str]
    max_steps: int
    review_interval: int = 5
    max_elapsed_seconds: int = 3600
    checkpoints: list[AgentCheckpoint] = Field(default_factory=list)
    observations: list[AgentObservation] = Field(default_factory=list)
    revisions: list[AgentRevision] = Field(default_factory=list)
    review_required: bool = False
    checklist: list[str] = Field(default_factory=list)
    completed_items: list[int] = Field(default_factory=list)
    completion_reviewed: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: Nonnegative | None = None
    provider_latency_ms: Nonnegative | None = None
    model_calls: int = 0
    steps_completed: int = 0
    pending_action: AgentPendingAction | None = None
    events: list[AgentEvent] = Field(default_factory=list)
    final_text: str | None = None
    stop_reason: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None


class AgentApprovalRequest(Model):
    action_id: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')
    action_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    approved: bool


class AgentEventsResponse(Model):
    events: list[AgentEvent]
    next_cursor: str | None = None


class AgentOperationResult(Model):
    run_id: UUID
    status: Literal['running', 'completed', 'failed', 'cancelled']
    phase: Literal['planning', 'awaiting_approval', 'paused', 'completed', 'failed']


class AgentErrorEnvelope(Model):
    error: ErrorInfo


class AgentContinueRequest(Model):
    guidance: str = Field(default='', max_length=2000)


class AgentExtendRequest(Model):
    additional_steps: int = Field(ge=1, le=1000)
    reason: str = Field(min_length=1, max_length=500)


class AgentReviewRequest(Model):
    completed_items: list[int] = Field(default_factory=list, max_length=30)
    accept_completion: bool = False
    note: str = Field(min_length=1, max_length=1000)
