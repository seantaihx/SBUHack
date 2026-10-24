"""Optional real Uvicorn/HTTP/SQLite smoke: python backend/tests/smoke_http.py."""
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from urllib.error import URLError
from urllib.request import Request, urlopen

from conftest import ROOT, SAMPLES, validate


def request(base, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(base + path, data=data, headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=3) as response:
        return response.status, dict(response.headers), json.load(response)


def start(database, port, log):
    env = {**os.environ, 'DATABASE_PATH': str(database)}
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app.main:app',
                                '--app-dir', str(ROOT), '--host', '127.0.0.1',
                                '--port', str(port), '--workers', '1'],
                               cwd='/tmp', env=env, stdout=log, stderr=log)
    deadline = monotonic() + 10
    while monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Uvicorn failed to start')
        try:
            status, _, body = request(f'http://127.0.0.1:{port}', '/api/v1/health')
            assert status == 200
            validate(body, 'Health')
            return process
        except (URLError, TimeoutError):
            sleep(0.05)
    process.terminate()
    process.wait(timeout=5)
    raise RuntimeError('Uvicorn readiness timeout')


def stop(process):
    process.terminate()
    process.wait(timeout=5)
    # Uvicorn re-raises SIGTERM after graceful application shutdown.
    assert process.returncode in (0, -signal.SIGTERM), process.returncode


def main():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with TemporaryDirectory(prefix='ecoagent-smoke-') as directory:
        database = Path(directory) / 'runs.sqlite3'
        with (Path(directory) / 'server.log').open('w') as log:
            process = start(database, port, log)
            try:
                for path, schema in [('capabilities', 'Capabilities'), ('sample-tasks', 'SampleTasks')]:
                    status, _, body = request(base, '/api/v1/' + path)
                    assert status == 200
                    validate(body, schema)
                status, headers, run = request(base, '/api/v1/runs',
                                               {'mode': 'demo', 'tasks': SAMPLES['tasks'][:1]})
                assert status == 202
                validate(run, 'Run')
                location = next(v for k, v in headers.items() if k.lower() == 'location')
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    _, _, run = request(base, location)
                    validate(run, 'Run')
                    if run['status'] in ('completed', 'partial', 'failed'):
                        break
                    sleep(0.02)
                assert run['status'] == 'completed'
                assert [result['output_text'] for result in run['results']] == ['billing', 'billing']
            finally:
                stop(process)
            process = start(database, port, log)
            try:
                _, _, reloaded = request(base, location)
                assert reloaded == run
                status, headers, interrupted = request(base, '/api/v1/runs',
                                                       {'mode': 'demo', 'tasks': SAMPLES['tasks']})
                assert status == 202
                interrupted_location = next(v for k, v in headers.items() if k.lower() == 'location')
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    _, _, interrupted = request(base, interrupted_location)
                    if interrupted['completed_attempts'] >= 1:
                        break
                    sleep(0.005)
                assert interrupted['status'] == 'running'
                assert interrupted['completed_attempts'] >= 1
                process.kill()  # Only the temporary child server created by this smoke.
                process.wait(timeout=5)
                assert process.returncode == -signal.SIGKILL
            finally:
                if process.poll() is None:
                    stop(process)
            process = start(database, port, log)
            try:
                _, _, recovered = request(base, interrupted_location)
                validate(recovered, 'Run')
                assert recovered['status'] == 'failed'
                assert recovered['run_error']['code'] == 'RUN_INTERRUPTED'
                assert recovered['results'][:len(interrupted['results'])] == interrupted['results']
                _, _, completed = request(base, location)
                assert completed == run
                status, headers, _ = request(base, '/api/v1/runs',
                                             {'mode': 'demo', 'tasks': SAMPLES['tasks'][:1]})
                assert status == 202
                new_location = next(v for k, v in headers.items() if k.lower() == 'location')
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    _, _, new_run = request(base, new_location)
                    if new_run['status'] == 'completed':
                        break
                    sleep(0.02)
                assert new_run['status'] == 'completed'
            finally:
                stop(process)
        assert (Path(directory) / 'server.log').read_text().count('Application shutdown complete.') == 2
    print('PASS: real Uvicorn HTTP metadata + 202/GET completed (2 billing outputs) + SQLite persistence + abrupt-process restart recovery + new run after recovery; cwd=/tmp.')
    print('Demo fixture inference only; no external provider integration tested.')


if __name__ == '__main__':
    main()
