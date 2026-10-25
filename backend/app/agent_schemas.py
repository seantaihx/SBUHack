"""Bounded, approval-gated workspace agent API models."""
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .schemas import Model, ErrorInfo


class AgentCapabilities(Model):
    enabled: bool
    disabled_reason: str | None
    workspace_name: str | None
    task_types: list[Literal['write', 'code']] = ['write', 'code']
    operations: list[Literal['read_file', 'write_file']] = ['read_file', 'write_file']
    approval_required_for_each_operation: Literal[True] = True
    shell_execution_enabled: Literal[False] = False
    network_tools_enabled: Literal[False] = False
    max_steps: int = 20
    max_file_chars: int = 50000


class AgentCompletionCheck(Model):
    check_id: str = Field(pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$')
    kind: Literal['file_exists', 'file_changed', 'contains_text', 'valid_json']
    path: str = Field(min_length=1, max_length=500)
    expected_text: str | None = Field(default=None, min_length=1, max_length=500)

class AgentCompletionCheckResult(Model):
    check_id: str
    kind: Literal['file_exists', 'file_changed', 'contains_text', 'valid_json']
    path: str
    status: Literal['passed', 'failed', 'not_verifiable']
    message: str = Field(max_length=240)


class AgentStartRequest(Model):
    task_type: Literal['write', 'code']
    instruction: str = Field(min_length=1, max_length=5000)
    confirm_provider_submission: Literal[True]
    read_paths: list[str] = Field(default_factory=list, max_length=20)
    write_paths: list[str] = Field(default_factory=list, max_length=20)
    max_steps: int = Field(default=8, ge=1, le=20)
    completion_checks: list[AgentCompletionCheck] = Field(default_factory=list, max_length=10)

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
        if len({check.check_id for check in self.completion_checks}) != len(self.completion_checks):
            raise ValueError('Completion check IDs must be unique.')
        if any(check.path not in self.write_paths for check in self.completion_checks):
            raise ValueError('Completion checks must target an exact permitted write path.')
        if any((check.kind == 'contains_text') != (check.expected_text is not None)
               for check in self.completion_checks):
            raise ValueError('expected_text is required only for contains_text checks.')
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
    checkpoint_sequence: int = Field(default=1, ge=1)
    checkpoint_at: str = ''
    model_calls: int = 0
    repeated_failure_count: int = 0
    last_failure_fingerprint: str | None = None
    steps_completed: int = 0
    pending_action: AgentPendingAction | None = None
    events: list[AgentEvent] = Field(default_factory=list)
    completion_checks: list[AgentCompletionCheck] = Field(default_factory=list)
    completion_check_baselines: dict[str, str | None] = Field(default_factory=dict)
    completion_check_results: list[AgentCompletionCheckResult] = Field(default_factory=list)
    verification_status: Literal['not_requested', 'pending', 'verified', 'failed'] = 'not_requested'
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
