"""Actual HTTP benchmark + abrupt process restart. Forces simulated mode."""
import json
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
from time import monotonic, sleep

from smoke_http import start, stop, request
from conftest import ROOT, validate


def main():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    payload = json.loads((ROOT / 'contracts/examples/benchmark-start.json').read_text())
    with TemporaryDirectory(prefix='ecoagent-benchmark-smoke-') as folder:
        db = Path(folder) / 'runs.sqlite3'
        with (Path(folder) / 'server.log').open('w') as log:
            process = start(db, port, log)
            try:
                _, _, catalog = request(base, '/api/v1/benchmarks/datasets')
                validate(catalog, 'BenchmarkDatasetsResponse')
                status, _, accepted = request(base, '/api/v1/benchmarks/runs', payload)
                assert status == 202; validate(accepted, 'StartBenchmarkResponse')
                path = '/api/v1/benchmarks/runs/' + accepted['run_id']
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    _, _, run = request(base, path)
                    if run['progress']['completed'] >= 1: break
                    sleep(.01)
                assert run['status'] == 'running'
                _, _, before_cases = request(base, path + '/cases')
                assert before_cases['items']
                process.kill(); process.wait(timeout=5)
            finally:
                if process.poll() is None: stop(process)
            process = start(db, port, log)
            try:
                _, _, recovered = request(base, path)
                validate(recovered, 'BenchmarkRun')
                assert recovered['status'] == 'failed'
                assert recovered['error']['code'] == 'RUN_INTERRUPTED'
                _, _, cases = request(base, path + '/cases')
                validate(cases, 'BenchmarkCasesResponse')
                assert cases['items'][0] == before_cases['items'][0]
                _, _, accepted = request(base, '/api/v1/benchmarks/runs', {**payload,'max_cases':1})
                deadline=monotonic()+5
                while monotonic()<deadline:
                    _, _, run=request(base,'/api/v1/benchmarks/runs/'+accepted['run_id'])
                    if run['status']=='completed': break
                    sleep(.02)
                assert run['status']=='completed' and run['measurement_source']=='simulated'
                _,_,history=request(base,'/api/v1/benchmarks/runs?limit=1')
                validate(history,'BenchmarkRunsResponse')
                assert history['items'][0]['run_id']==accepted['run_id'] and history['next_cursor']
            finally:
                stop(process)
    print('PASS: real HTTP benchmark catalog/submission/progress/cases/history and abrupt-restart recovery; simulated only.')


if __name__ == '__main__':
    main()
