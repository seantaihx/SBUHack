"""Transactional snapshots shared by comparison and benchmark jobs."""
from contextlib import closing
from pathlib import Path
import sqlite3
import threading
from datetime import datetime, timezone, timedelta
from .errors import APIError
from .providers.base import ProviderError

from .schemas import ErrorInfo, Run
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
                       '(id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, created_at TEXT NOT NULL, cost_usd REAL NOT NULL)')

    def _connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def _create(self, run_id, status, created_at, snapshot, kind, rate_limit=None):
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            active = db.execute("SELECT id, kind FROM runs WHERE status IN ('queued', 'running')").fetchone()
            if active:
                raise RunActive(*active)
            if rate_limit is not None:
                minute_ago = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')
                count = db.execute('SELECT COUNT(*) FROM runs WHERE kind = ? AND created_at >= ?', (kind, minute_ago)).fetchone()[0]
                if count >= rate_limit:
                    raise APIError(429, 'RATE_LIMITED', 'The server benchmark submission limit was reached.')
            db.execute('INSERT INTO runs (id,status,created_at,snapshot,kind) VALUES (?, ?, ?, ?, ?)',
                       (run_id, status, created_at, snapshot, kind))

    def _get(self, run_id, kind):
        with self._lock, closing(self._connect()) as db:
            row = db.execute('SELECT snapshot FROM runs WHERE id = ? AND kind = ?', (run_id, kind)).fetchone()
        return row[0] if row else None

    def _save(self, run_id, status, snapshot):
        with self._lock, closing(self._connect()) as db, db:
            db.execute("UPDATE runs SET status = ?, snapshot = ? WHERE id = ? "
                       "AND status IN ('queued', 'running')", (status, snapshot, run_id))

    def create(self, run: Run):
        self._create(str(run.id), run.status, run.created_at, run.model_dump_json(), 'comparison')

    def get(self, run_id: str) -> Run | None:
        snapshot = self._get(run_id, 'comparison')
        return Run.model_validate_json(snapshot) if snapshot else None

    def save(self, run: Run):
        self._save(str(run.id), run.status, run.model_dump_json())

    def create_benchmark(self, record, rate_limit=None):
        self._create(record.run.run_id, record.run.status, record.run.created_at, record.model_dump_json(), 'benchmark', rate_limit)

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
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            rows = db.execute("SELECT id, kind, snapshot FROM runs WHERE status IN ('queued', 'running')").fetchall()
            for run_id, kind, snapshot in rows:
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

    def reserve_inference(self, run_id, ceiling, settings):
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
            return db.execute('INSERT INTO inference_reservations(run_id,created_at,cost_usd) VALUES (?,?,?)',
                              (run_id, timestamp, ceiling)).lastrowid

    def settle_inference(self, reservation_id, actual_cost):
        with self._lock, closing(self._connect()) as db, db:
            db.execute('UPDATE inference_reservations SET cost_usd = ? WHERE id = ?', (actual_cost, reservation_id))
