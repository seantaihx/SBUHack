import json
from pathlib import Path
from time import monotonic, sleep

import pytest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / 'contracts/openapi.json').read_text())
SAMPLES = json.loads((ROOT / 'demo/tasks.json').read_text())


def validate(payload, name):
    schema = {'$ref': f'#/components/schemas/{name}', 'components': CONTRACT['components']}
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(payload)


def wait_run(client, location):
    deadline = monotonic() + 5
    while monotonic() < deadline:
        response = client.get(location)
        assert response.status_code == 200
        run = response.json()
        validate(run, 'Run')
        if run['status'] in ('completed', 'partial', 'failed'):
            return run
        sleep(0.01)
    pytest.fail('Run did not finish within 5 seconds')


@pytest.fixture
def client(tmp_path):
    from fastapi.testclient import TestClient
    from backend.app.main import create_app
    from backend.app.settings import Settings
    with TestClient(create_app(Settings(database_path=tmp_path / 'runs.sqlite3'))) as value:
        yield value
