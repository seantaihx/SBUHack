"""Transactional SQLite snapshots; connections and locks never span inference."""
from contextlib import closing
from pathlib import Path
import sqlite3
import threading

from .schemas import Run


class RunActive(Exception):
    def __init__(self, run_id: str):
        self.run_id = run_id


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS runs '
                       '(id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, snapshot TEXT NOT NULL)')
            # A second connection cannot reserve another active run, even during simultaneous submissions.
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs ((1)) "
                       "WHERE status IN ('queued', 'running')")

    def _connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def create(self, run: Run):
        with self._lock, closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            active = db.execute("SELECT id FROM runs WHERE status IN ('queued', 'running')").fetchone()
            if active:
                raise RunActive(active[0])
            db.execute('INSERT INTO runs VALUES (?, ?, ?, ?)',
                       (str(run.id), run.status, run.created_at, run.model_dump_json()))

    def get(self, run_id: str) -> Run | None:
        with self._lock, closing(self._connect()) as db:
            row = db.execute('SELECT snapshot FROM runs WHERE id = ?', (run_id,)).fetchone()
        return Run.model_validate_json(row[0]) if row else None

    def save(self, run: Run):
        with self._lock, closing(self._connect()) as db, db:
            db.execute("UPDATE runs SET status = ?, snapshot = ? WHERE id = ? "
                       "AND status IN ('queued', 'running')",
                       (run.status, run.model_dump_json(), str(run.id)))
