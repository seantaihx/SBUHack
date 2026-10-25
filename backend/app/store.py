"""Transactional snapshots shared by comparison and benchmark jobs."""
from contextlib import closing
from pathlib import Path
import sqlite3
import threading
from datetime import datetime, timezone, timedelta
from .errors import APIError
from .providers.base import ProviderError

from .schemas import ErrorInfo, Run, SourceSnapshot
from .timestamps import now


class RunActive(Exception):
    def __init__(self, run_id: str, kind: str = 'comparison'):
        self.run_id = run_id
        self.kind = kind


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS runs '
                       '(id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, snapshot TEXT NOT NULL)')
            if 'kind' not in {row[1] for row in db.execute('PRAGMA table_info(runs)')}:
                db.execute("ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'comparison'")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs ((1)) "
                       "WHERE status IN ('queued', 'running')")
            db.execute('CREATE INDEX IF NOT EXISTS runs_history ON runs (kind, created_at DESC, id DESC)')
            db.execute('CREATE TABLE IF NOT EXISTS inference_reservations '
                       '(id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, created_at TEXT NOT NULL, cost_usd REAL NOT NULL, task_id TEXT)')
            if 'task_id' not in {row[1] for row in db.execute('PRAGMA table_info(inference_reservations)')}:
                db.execute('ALTER TABLE inference_reservations ADD COLUMN task_id TEXT')
            db.execute('CREATE TABLE IF NOT EXISTS sources '
                       '(source_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT, bound_run_id TEXT, snapshot TEXT NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS sources_expiry ON sources (expires_at) WHERE bound_run_id IS NULL')

    def _connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def _create(self, run_id, status, created_at, snapshot, kind, rate_limit=None, source_id=None):
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM sources WHERE bound_run_id IS NULL AND expires_at <= ?', (now(),))
            active = db.execute("SELECT id, kind FROM runs WHERE status IN ('queued', 'running')").fetchone()
            if active:
                raise RunActive(*active)
            if rate_limit is not None:
                minute_ago = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')
                count = db.execute('SELECT COUNT(*) FROM runs WHERE kind = ? AND created_at >= ?', (kind, minute_ago)).fetchone()[0]
                if count >= rate_limit:
                    raise APIError(429, 'RATE_LIMITED', 'The server benchmark submission limit was reached.')
            if source_id is not None:
                source_row = db.execute('SELECT expires_at, bound_run_id, snapshot FROM sources WHERE source_id = ?', (source_id,)).fetchone()
                if not source_row or (source_row[0] and source_row[0] <= now()):
                    raise APIError(404, 'SOURCE_NOT_FOUND', 'This source preview expired or was not found.')
                if source_row[1] is not None:
                    raise APIError(409, 'SOURCE_ALREADY_BOUND', 'This source is already attached to a run. Create a new preview to reuse its content.')
                source = SourceSnapshot.model_validate_json(source_row[2])
                source.expires_at = None
                db.execute('UPDATE sources SET bound_run_id = ?, expires_at = NULL, snapshot = ? WHERE source_id = ?',
                           (run_id, source.model_dump_json(), source_id))
            db.execute('INSERT INTO runs (id,status,created_at,snapshot,kind) VALUES (?, ?, ?, ?, ?)',
                       (run_id, status, created_at, snapshot, kind))

    def create_source(self, source: SourceSnapshot):
        timestamp = now()
        source_id = str(source.source_id)
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM sources WHERE bound_run_id IS NULL AND expires_at <= ?', (timestamp,))
            db.execute('INSERT INTO sources (source_id,created_at,expires_at,bound_run_id,snapshot) VALUES (?,?,?,?,?)',
                       (source_id, timestamp, source.expires_at, None, source.model_dump_json()))

    def get_source(self, source_id: str) -> SourceSnapshot | None:
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT expires_at,bound_run_id,snapshot FROM sources WHERE source_id = ?', (source_id,)).fetchone()
            if not row:
                return None
            if row[0] and row[0] <= now() and row[1] is None:
                db.execute('DELETE FROM sources WHERE source_id = ?', (source_id,))
                return None
            return SourceSnapshot.model_validate_json(row[2])

    def delete_source(self, source_id: str) -> bool:
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT bound_run_id FROM sources WHERE source_id = ?', (source_id,)).fetchone()
            if not row:
                return False
            if row[0] is not None:
                raise APIError(409, 'SOURCE_IN_USE', 'A source attached to a run is retained with that run.')
            db.execute('DELETE FROM sources WHERE source_id = ?', (source_id,))
            return True

    def _get(self, run_id, kind):
        with self._lock, closing(self._connect()) as db:
            row = db.execute('SELECT snapshot FROM runs WHERE id = ? AND kind = ?', (run_id, kind)).fetchone()
        return row[0] if row else None

    def active_run(self):
        """Return the single reserved active slot with its stored run kind."""
        with self._lock, closing(self._connect()) as db:
            row = db.execute("SELECT id, kind, status FROM runs WHERE status IN ('queued', 'running') LIMIT 1").fetchone()
        return {'id': row[0], 'kind': row[1], 'status': row[2]} if row else None

    def _save(self, run_id, status, snapshot):
        with self._lock, closing(self._connect()) as db, db:
            db.execute("UPDATE runs SET status = ?, snapshot = ? WHERE id = ? "
                       "AND status IN ('queued', 'running')", (status, snapshot, run_id))

    def create(self, run: Run, source_id: str | None = None):
        self._create(str(run.id), run.status, run.created_at, run.model_dump_json(), 'comparison', source_id=source_id)

    def get(self, run_id: str) -> Run | None:
        snapshot = self._get(run_id, 'comparison')
        return Run.model_validate_json(snapshot) if snapshot else None

    def save(self, run: Run):
        self._save(str(run.id), run.status, run.model_dump_json())

    def create_benchmark(self, record, rate_limit=None):
        self._create(record.run.run_id, record.run.status, record.run.created_at, record.model_dump_json(), 'benchmark', rate_limit)

    def create_agent(self, run):
        run.checkpoint_sequence = max(1, run.checkpoint_sequence)
        run.checkpoint_at = now()
        self._create(str(run.run_id), run.status, run.created_at, run.model_dump_json(), 'agent')

    def get_agent(self, run_id):
        from .agent_schemas import AgentRun
        snapshot = self._get(run_id, 'agent')
        if not snapshot:
            return None
        run = AgentRun.model_validate_json(snapshot)
        if not run.checkpoint_at:  # Backward-compatible restore of pre-checkpoint snapshots.
            run.checkpoint_at = run.created_at
        if run.completion_checks and run.verification_status == 'not_requested':
            run.verification_status = 'pending'
        return run

    def save_agent(self, run):
        run.checkpoint_sequence += 1
        run.checkpoint_at = now()
        self._save(str(run.run_id), run.status, run.model_dump_json())

    def get_benchmark(self, run_id):
        from .benchmarks.schemas import BenchmarkRecord
        snapshot = self._get(run_id, 'benchmark')
        return BenchmarkRecord.model_validate_json(snapshot) if snapshot else None

    def save_benchmark(self, record):
        self._save(record.run.run_id, record.run.status, record.model_dump_json())

    def list_benchmarks(self, limit, key=None):
        from .benchmarks.schemas import BenchmarkRecord
        sql = "SELECT snapshot FROM runs WHERE kind = 'benchmark'"
        params = []
        if key is not None:
            sql += ' AND (created_at, id) < (?, ?)'
            params.extend(key)
        sql += ' ORDER BY created_at DESC, id DESC LIMIT ?'
        params.append(limit)
        with self._lock, closing(self._connect()) as db:
            rows = db.execute(sql, params).fetchall()
        return [BenchmarkRecord.model_validate_json(row[0]).run for row in rows]

    def recover(self):
        from .benchmarks.schemas import BenchmarkRecord
        recovered_agents = []
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            rows = db.execute("SELECT id, kind, snapshot FROM runs WHERE status IN ('queued', 'running')").fetchall()
            for run_id, kind, snapshot in rows:
                if kind == 'agent':
                    from .agent_schemas import AgentEvent, AgentRun
                    agent = AgentRun.model_validate_json(snapshot)
                    agent.status = 'running'
                    agent.phase = ('awaiting_plan_approval'
                                   if agent.run_mode == 'team' and agent.workflow_stage == 'plan_review'
                                   else 'paused')
                    # A proposal from the interrupted process must not block
                    # explicit continuation or remain usable as an approval.
                    agent.pending_action = None
                    agent.stop_reason = 'APPLICATION_RESTARTED_REVIEW_REQUIRED'
                    agent.checkpoint_sequence += 1
                    agent.checkpoint_at = now()
                    agent.events.append(AgentEvent(sequence=len(agent.events) + 1, occurred_at=now(), actor='policy',
                                                   operation='pause', target=None, decision='stopped',
                                                   summary='Application restarted; no action resumed automatically.'))
                    db.execute('UPDATE runs SET status = ?, snapshot = ? WHERE id = ?',
                               ('running', agent.model_dump_json(), run_id))
                    recovered_agents.append(run_id)
                    continue
                record = BenchmarkRecord.model_validate_json(snapshot) if kind == 'benchmark' else Run.model_validate_json(snapshot)
                run = record.run if kind == 'benchmark' else record
                run.status = 'failed'
                run.finished_at = now()
                error = ErrorInfo(code='RUN_INTERRUPTED', message='The application stopped before this run finished.')
                if kind == 'benchmark':
                    run.error = error
                else:
                    run.run_error = error
                db.execute('UPDATE runs SET status = ?, snapshot = ? WHERE id = ?',
                           (run.status, record.model_dump_json(), run_id))
        return recovered_agents

    def reserve_inference(self, run_id, ceiling, settings, task_id=None):
        timestamp = now()
        minute_ago = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            requests, run_cost = db.execute('SELECT COUNT(*), COALESCE(SUM(cost_usd),0) FROM inference_reservations WHERE run_id = ?', (run_id,)).fetchone()
            recent = db.execute('SELECT COUNT(*) FROM inference_reservations WHERE created_at >= ?', (minute_ago,)).fetchone()[0]
            daily = db.execute('SELECT COALESCE(SUM(cost_usd),0) FROM inference_reservations WHERE created_at >= ?', (timestamp[:10],)).fetchone()[0]
            if (ceiling is None or requests >= settings.max_requests_per_run or recent >= settings.max_requests_per_minute
                    or run_cost + ceiling > settings.max_run_cost_usd or daily + ceiling > settings.max_daily_cost_usd):
                error = ProviderError('PROVIDER_RATE_LIMITED')
                error.error.details = {'source': 'server_limits', 'request_dispatched': False}
                raise error
            if task_id is not None:
                task_requests, task_cost = db.execute(
                    'SELECT COUNT(*), COALESCE(SUM(cost_usd),0) FROM inference_reservations WHERE run_id = ? AND task_id = ?',
                    (run_id, task_id)).fetchone()
                if task_requests >= settings.max_requests_per_run or task_cost + ceiling > min(settings.max_agent_task_cost_usd, settings.max_run_cost_usd):
                    error = ProviderError('PROVIDER_RATE_LIMITED')
                    error.error.details = {'source': 'server_task_limits', 'request_dispatched': False}
                    raise error
            return db.execute('INSERT INTO inference_reservations(run_id,created_at,cost_usd,task_id) VALUES (?,?,?,?)',
                              (run_id, timestamp, ceiling, task_id)).lastrowid

    def settle_inference(self, reservation_id, actual_cost):
        with self._lock, closing(self._connect()) as db, db:
            db.execute('UPDATE inference_reservations SET cost_usd = ? WHERE id = ?', (actual_cost, reservation_id))

    def remaining_daily_cost(self, settings):
        start = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
        with self._lock, closing(self._connect()) as db:
            reserved = db.execute('SELECT COALESCE(SUM(cost_usd),0) FROM inference_reservations WHERE created_at >= ?', (start,)).fetchone()[0]
        return max(0.0, settings.max_daily_cost_usd - reserved)
