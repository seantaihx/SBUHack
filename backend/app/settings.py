"""Server configuration; paths are relative to the repository, never the shell."""
from dataclasses import dataclass
from pathlib import Path
import os

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_path: Path = ROOT / 'backend/data/ecoagent.sqlite3'

    def __post_init__(self):
        path = Path(self.database_path).expanduser()
        object.__setattr__(self, 'database_path', path if path.is_absolute() else ROOT / path)

    @classmethod
    def from_env(cls):
        # Do not mutate the process environment or log .env contents.
        values = dotenv_values(ROOT / '.env')
        path = os.environ.get('DATABASE_PATH', values.get('DATABASE_PATH'))
        return cls(database_path=Path(path)) if path else cls()
