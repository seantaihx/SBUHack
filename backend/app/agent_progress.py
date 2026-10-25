"""Deterministic progress evidence; activity is never proof of semantic correctness."""
from datetime import datetime, timezone

from .agent_schemas import AgentCheckpoint
from .timestamps import now


def elapsed_seconds(run):
    return max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(run.created_at.replace('Z', '+00:00'))).total_seconds())


def checkpoint(run, *, force=False):
    previous = run.checkpoints[-1] if run.checkpoints else None
    last_call = previous.model_calls if previous else 0
    if run.model_calls <= last_call or (not force and run.model_calls - last_call < run.review_interval):
        return None
    old = run.observations[:previous.observation_cursor] if previous else []
    recent = run.observations[len(old):]
    seen_reads = {(o.path, o.after_sha256) for o in old if o.operation == 'read_file'}
    reads = writes = 0
    for observation in recent:
        version = (observation.path, observation.after_sha256)
        if observation.operation == 'read_file':
            if version not in seen_reads:
                reads += 1
            seen_reads.add(version)
        elif observation.before_sha256 != observation.after_sha256:
            writes += 1
    events = run.events[previous.event_cursor:] if previous else run.events
    failures = sum(e.decision in ('failed', 'denied', 'denied_duplicate', 'denied_out_of_scope') for e in events)
    assessment = 'observed_progress' if reads or writes else 'stalled' if failures else 'uncertain'
    summary = (f'{run.model_calls - last_call} model calls: {reads} new file-version reads, '
               f'{writes} changed writes, {failures} failed or denied actions. '
               'Activity is evidence, not a correctness verdict.')
    item = AgentCheckpoint(sequence=len(run.checkpoints)+1, created_at=now(), model_calls=run.model_calls,
                           event_cursor=len(run.events), observation_cursor=len(run.observations),
                           new_reads=reads, changed_writes=writes, failures=failures,
                           assessment=assessment, summary=summary)
    run.checkpoints.append(item)
    if assessment != 'observed_progress':
        run.review_required = True
    return item
