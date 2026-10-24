import json
import pytest
from conftest import ROOT, validate


@pytest.mark.parametrize(('name','schema'), [
    ('benchmark-start', 'StartBenchmarkRequest'), ('benchmark-started', 'StartBenchmarkResponse'),
    ('benchmark-datasets', 'BenchmarkDatasetsResponse'), ('benchmark-run-completed','BenchmarkRun'),
    ('benchmark-run-partial','BenchmarkRun'), ('benchmark-cases','BenchmarkCasesResponse'),
    ('benchmark-cases-partial','BenchmarkCasesResponse'), ('benchmark-runs','BenchmarkRunsResponse'),
    ('benchmark-error-validation','ErrorEnvelope'), ('benchmark-error-rate-limited','ErrorEnvelope'),
    ('benchmark-error-unavailable','ErrorEnvelope'),
    ('health','Health'), ('capabilities','Capabilities'), ('create-run','CreateRun'),
    ('error-active','ErrorEnvelope'), ('run-queued','Run'), ('run-completed','Run'), ('run-partial','Run'),
])
def test_contract_examples(name,schema):
    validate(json.loads((ROOT / 'contracts/examples' / (name+'.json')).read_text()),schema)
