"""No real inference: HTTPX MockTransport exercises the actual wire adapter."""
import asyncio
import json
from dataclasses import replace
import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import SAMPLES, wait_run


def setup_provider(tmp_path, handler, **overrides):
    from backend.app.settings import Settings
    from backend.app.store import Store
    from backend.app.providers.live import LiveProvider
    settings = Settings(database_path=tmp_path / 'live.sqlite3', live_enabled=True, api_key='test-only-key', **overrides)
    store = Store(settings.database_path)
    return LiveProvider(settings, store, transport=httpx.MockTransport(handler)), store, settings


def success(usage=None):
    return {'choices': [{'message': {'content': 'billing'}}],
            'usage': usage if usage is not None else {'prompt_tokens': 100, 'completion_tokens': 20}}


def test_groq_wire_and_cost(tmp_path):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=success())
    provider, _, _ = setup_provider(tmp_path, handler)
    output = asyncio.run(provider.infer('synthetic prompt', 'openai/gpt-oss-20b', 'test-run'))
    assert output.output_text == 'billing'
    assert output.input_tokens == 100 and output.output_tokens == 20
    assert output.latency_ms >= 0
    assert len(calls) == 1
    req = calls[0]
    assert str(req.url) == 'https://api.groq.com/openai/v1/chat/completions'
    assert req.headers['authorization'] == 'Bearer test-only-key'
    assert json.loads(req.content) == {
        'model': 'openai/gpt-oss-20b', 'messages': [
            {'role': 'system', 'content': "Follow the user's task. Be concise. Return only the requested answer."},
            {'role': 'user', 'content': 'synthetic prompt'}], 'temperature': 0,
        'max_completion_tokens': 16384, 'stream': False}
    from backend.app.pricing import cost
    assert cost('openai/gpt-oss-20b', 100, 20) == pytest.approx(0.0000135)
    assert cost('openai/gpt-oss-120b', 100, 20) == pytest.approx(0.000027)
    assert cost('openai/gpt-oss-20b', None, 20) is None


@pytest.mark.parametrize(('status', 'code'), [(401, 'PROVIDER_AUTH_ERROR'), (403, 'PROVIDER_AUTH_ERROR'),
    (429, 'PROVIDER_RATE_LIMITED'), (500, 'PROVIDER_UNAVAILABLE'), (400, 'PROVIDER_BAD_RESPONSE'),
    (302, 'PROVIDER_BAD_RESPONSE')])
def test_provider_http_errors_are_sanitized_without_retry(tmp_path, status, code):
    from backend.app.providers.base import ProviderError
    count = 0
    def handler(request):
        nonlocal count
        count += 1
        return httpx.Response(status, text='test-only-key secret-provider-body', headers={'Location': 'https://other.invalid'})
    provider, _, _ = setup_provider(tmp_path, handler)
    with pytest.raises(ProviderError) as error:
        asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'test-run'))
    assert error.value.error.code == code
    assert 'secret' not in error.value.error.model_dump_json()
    assert 'test-only-key' not in str(error.value)
    assert count == 1


@pytest.mark.parametrize('body', [{}, {'choices': []}, {'choices': [{'message': {'content': None}}]},
                                   {'choices': [{'message': {'content': ['bad']}}]}, []])
def test_bad_response_content(tmp_path, body):
    from backend.app.providers.base import ProviderError
    provider, _, _ = setup_provider(tmp_path, lambda request: httpx.Response(200, json=body))
    with pytest.raises(ProviderError, match='PROVIDER_BAD_RESPONSE'):
        asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'test-run'))


@pytest.mark.parametrize(('usage', 'expected'), [({}, (None, None)), ({'prompt_tokens': -1, 'completion_tokens': True}, (None, None)),
    ({'prompt_tokens': '12', 'completion_tokens': 3}, (None, 3)), ({'prompt_tokens': 0, 'completion_tokens': 0}, (0, 0)),
    ([], (None, None))])
def test_optional_usage_is_not_fabricated(tmp_path, usage, expected):
    provider, _, _ = setup_provider(tmp_path, lambda request: httpx.Response(200, json=success(usage)))
    result = asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'test-run'))
    assert (result.input_tokens, result.output_tokens) == expected
    assert result.output_text == 'billing'


def test_hard_deadline(tmp_path):
    from backend.app.providers.base import ProviderError
    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json=success())
    provider, _, _ = setup_provider(tmp_path, handler, request_timeout_seconds=0.02)
    with pytest.raises(ProviderError, match='PROVIDER_TIMEOUT'):
        asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'test-run'))


def test_request_limit_and_daily_budget_survive_restart(tmp_path):
    from backend.app.providers.base import ProviderError
    from backend.app.providers.live import LiveProvider
    from backend.app.store import Store
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=success({}))
    provider, store, settings = setup_provider(tmp_path, handler, max_requests_per_minute=1)
    asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'run1'))
    restarted = LiveProvider(settings, Store(store.path), transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError, match='PROVIDER_RATE_LIMITED'):
        asyncio.run(restarted.infer('test', 'openai/gpt-oss-20b', 'run2'))
    assert len(calls) == 1
    budget_limited = LiveProvider(replace(settings, max_requests_per_minute=100, max_daily_cost_usd=0.01),
                                 Store(store.path), transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError, match='PROVIDER_RATE_LIMITED'):
        asyncio.run(budget_limited.infer('test', 'openai/gpt-oss-20b', 'run3'))
    assert len(calls) == 1


def test_known_usage_reconciles_reservation_and_run_request_cap(tmp_path):
    from backend.app.providers.base import ProviderError
    provider, store, _ = setup_provider(tmp_path, lambda request: httpx.Response(200, json=success()), max_requests_per_run=1)
    asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'run1'))
    with store._connect() as db:
        assert db.execute('SELECT SUM(cost_usd) FROM inference_reservations').fetchone()[0] == pytest.approx(0.0000135)
    with pytest.raises(ProviderError, match='PROVIDER_RATE_LIMITED'):
        asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'run1'))


def test_extended_completion_limit_is_sent_and_reserved(tmp_path):
    from backend.app.pricing import cost
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=success({}))
    provider, store, settings = setup_provider(
        tmp_path, handler,
        max_completion_tokens=32768,
    )
    asyncio.run(provider.infer('synthetic long answer request', 'openai/gpt-oss-20b', 'extended-run'))
    assert json.loads(calls[0].content)['max_completion_tokens'] == 32768
    assert 'max_tokens' not in json.loads(calls[0].content)
    with store._connect() as db:
        reserved = db.execute('SELECT cost_usd FROM inference_reservations').fetchone()[0]
    assert reserved == pytest.approx(cost('openai/gpt-oss-20b', 131072, 32768))


@pytest.mark.parametrize('limit', [0, -1, 65537, True])
def test_completion_limit_must_fit_supported_range(tmp_path, limit):
    from backend.app.settings import Settings
    with pytest.raises(ValueError, match='INFERENCE_MAX_COMPLETION_TOKENS'):
        Settings(database_path=tmp_path / 'invalid-limit.sqlite3', max_completion_tokens=limit)


def test_completion_limit_is_bounded_by_selected_groq_model(tmp_path):
    from backend.app.settings import Settings
    settings = Settings(database_path=tmp_path / 'model-cap.sqlite3', max_completion_tokens=65536)
    assert settings.completion_limit_for('openai/gpt-oss-20b') == 65536
    assert settings.completion_limit_for('openai/gpt-oss-120b') == 65536
    assert settings.completion_limit_for('qwen/qwen3.8-27b') == 16384


def test_live_api_does_not_fallback_and_keeps_null_usage(tmp_path):
    from backend.app.main import create_app
    provider, _, settings = setup_provider(tmp_path, lambda request: httpx.Response(200, json=success({})))
    with TestClient(create_app(settings)) as client:
        client.app.state.runner.live = provider
        assert client.get('/api/v1/capabilities').json()['live_enabled'] is True
        response = client.post('/api/v1/runs', json={'mode': 'live', 'tasks': SAMPLES['tasks'][:1]})
        assert response.status_code == 202
        run = wait_run(client, response.headers['location'])
        assert run['status'] == 'completed'
        assert run['measurement_source'] == 'provider_usage_and_client_timing'
        assert run['results'][0]['model_id'] == 'openai/gpt-oss-120b'
        assert run['results'][0]['input_tokens'] is None
        assert run['comparison']['energy_wh']['baseline'] is None


def test_benchmark_groq_mode_disabled_without_key(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    from test_benchmarks import REQUEST
    with TestClient(create_app(Settings(database_path=tmp_path / 'runs.sqlite3', benchmark_mode='groq'))) as client:
        response = client.post('/api/v1/benchmarks/runs', json=REQUEST)
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'PROVIDER_UNAVAILABLE'


def test_benchmark_observed_pipeline_records_failure_without_demo_fallback(tmp_path):
    from backend.app.main import create_app
    from test_benchmarks import REQUEST, wait
    def handler(request):
        if json.loads(request.content)['model'] == 'openai/gpt-oss-20b':
            return httpx.Response(429, text='private-provider-body test-only-key')
        return httpx.Response(200, json=success())
    provider, _, settings = setup_provider(tmp_path, handler, benchmark_mode='groq')
    with TestClient(create_app(settings)) as client:
        client.app.state.benchmarks.live = provider
        response = client.post('/api/v1/benchmarks/runs', json={**REQUEST, 'max_cases': 1})
        assert response.status_code == 202
        path = response.headers['location']; run = wait(client, path)
        assert run['measurement_source'] == 'observed'
        assert run['status'] == 'partial'
        assert run['baseline_metrics']['total_cost_usd'] == pytest.approx(0.000027)
        assert run['candidate_metrics']['total_cost_usd'] is None
        case = client.get(path + '/cases').json()['items'][0]
        assert case['candidate']['output'] is None
        assert case['candidate']['error']['code'] == 'PROVIDER_RATE_LIMITED'
        assert 'private-provider-body' not in json.dumps(case)
        assert 'test-only-key' not in json.dumps(case)


def test_local_compatible_url_preserves_path_and_omits_empty_bearer(tmp_path):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=success())
    provider, _, settings = setup_provider(tmp_path, handler, base_url='http://localhost:9999/custom/v1/')
    provider.settings = replace(settings, api_key='')
    asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'run1'))
    assert str(calls[0].url) == 'http://localhost:9999/custom/v1/chat/completions'
    assert 'authorization' not in calls[0].headers


def test_environment_configuration_is_backend_only_and_secret_safe(tmp_path, monkeypatch):
    import backend.app.settings as module
    monkeypatch.setattr(module, 'ROOT', tmp_path)
    (tmp_path / '.env').write_text('GROQ_API_KEY=file-test-key\nLIVE_ENABLED=true\nBENCHMARK_INFERENCE_MODE=groq\n')
    (tmp_path / 'api.env').write_text('GROQ_API_KEY=ignored-api-env-key\n')
    monkeypatch.setenv('GROQ_API_KEY', 'environment-test-key')
    settings = module.Settings.from_env()
    assert settings.api_key == 'environment-test-key'
    assert settings.benchmark_mode == 'groq'
    assert settings.live_disabled_reason is None
    assert 'environment-test-key' not in repr(settings)
    assert 'file-test-key' not in repr(settings)


def test_per_run_cost_limit_blocks_before_http(tmp_path):
    from backend.app.providers.base import ProviderError
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=success())
    provider, _, _ = setup_provider(tmp_path, handler, max_run_cost_usd=0.0001)
    with pytest.raises(ProviderError, match='PROVIDER_RATE_LIMITED'):
        asyncio.run(provider.infer('test', 'openai/gpt-oss-20b', 'run1'))
    assert calls == []


def test_benchmark_local_limit_does_not_count_unsent_http_request(tmp_path):
    from backend.app.main import create_app
    from test_benchmarks import REQUEST, wait
    provider, _, settings = setup_provider(tmp_path, lambda request: httpx.Response(200, json=success()),
                                          benchmark_mode='groq', max_requests_per_minute=1)
    with TestClient(create_app(settings)) as client:
        client.app.state.benchmarks.live = provider
        response = client.post('/api/v1/benchmarks/runs', json={**REQUEST, 'max_cases': 1})
        run = wait(client, response.headers['location'])
        assert run['status'] == 'partial'
        assert run['baseline_metrics']['total_requests'] == 1
        assert run['candidate_metrics']['total_requests'] == 0
        assert run['candidate_metrics']['error_count'] == 1
