import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.settings import Settings
import backend.app.local_settings as local_settings


@pytest.fixture
def local_client(tmp_path, monkeypatch):
    env_path = tmp_path / '.env'
    monkeypatch.setattr(local_settings, 'ENV_PATH', env_path)
    monkeypatch.delenv('GROQ_API_KEY', raising=False)
    app = create_app(Settings(database_path=tmp_path / 'runs.sqlite3'))
    with TestClient(app, base_url='http://127.0.0.1:8000', client=('127.0.0.1', 50100)) as client:
        yield client, env_path


def test_local_key_save_writes_only_ignored_env_and_never_returns_key(local_client):
    client, env_path = local_client
    env_path.write_text('LIVE_ENABLED=true\n# keep this comment\nGROQ_MODEL_SMALL=openai/gpt-oss-20b\n', encoding='utf-8')
    secret = 'provider_test_secret_value_not_for_response_12345'

    response = client.put('/api/v1/local-settings/provider-key', headers={'Origin': 'http://127.0.0.1:8000'}, json={'api_key': secret})

    assert response.status_code == 200
    assert secret not in response.text
    assert response.json() == {
        'local_setup_available': True,
        'provider_key_configured': False,
        'provider_key_saved_in_env': True,
        'restart_required': True,
        'environment_override': False,
    }
    contents = env_path.read_text(encoding='utf-8')
    assert 'LIVE_ENABLED=true' in contents
    assert '# keep this comment' in contents
    assert 'GROQ_MODEL_SMALL=openai/gpt-oss-20b' in contents
    assert contents.count('GROQ_API_KEY=') == 1
    assert secret in contents


def test_status_returns_booleans_without_returning_key(local_client):
    client, env_path = local_client
    secret = 'provider_test_configured_secret_that_must_not_return_12345'
    env_path.write_text('GROQ_API_KEY=' + secret + '\n', encoding='utf-8')
    response = client.get('/api/v1/local-settings/provider')
    assert response.status_code == 200
    assert secret not in response.text
    assert response.json()['provider_key_saved_in_env'] is True
    assert response.json()['provider_key_configured'] is False
    assert response.json()['restart_required'] is True


def test_status_rejects_cross_origin_request(local_client):
    client, _ = local_client
    response = client.get('/api/v1/local-settings/provider', headers={'Origin': 'https://attacker.example'})
    assert response.status_code == 403


@pytest.mark.parametrize('origin', ['https://attacker.example', 'http://localhost:8001', None])
def test_provider_key_endpoint_rejects_cross_origin_or_missing_origin(local_client, origin):
    client, env_path = local_client
    headers = {} if origin is None else {'Origin': origin}
    response = client.put('/api/v1/local-settings/provider-key', headers=headers, json={'api_key': 'secret_key_that_should_not_persist_123'})
    assert response.status_code == 403
    assert not env_path.exists()


def test_provider_key_endpoint_rejects_non_loopback_caller(tmp_path, monkeypatch):
    monkeypatch.setattr(local_settings, 'ENV_PATH', tmp_path / '.env')
    app = create_app(Settings(database_path=tmp_path / 'runs.sqlite3'))
    with TestClient(app, base_url='http://127.0.0.1:8000', client=('192.0.2.5', 50100)) as client:
        response = client.put('/api/v1/local-settings/provider-key', headers={'Origin': 'http://127.0.0.1:8000'}, json={'api_key': 'secret_key_that_should_not_persist_123'})
    assert response.status_code == 403
    assert not (tmp_path / '.env').exists()


def test_environment_override_rejects_save_without_exposing_key(local_client, monkeypatch):
    client, env_path = local_client
    secret = 'environment_key_must_not_be_echoed_123456'
    monkeypatch.setenv('GROQ_API_KEY', secret)
    response = client.put('/api/v1/local-settings/provider-key', headers={'Origin': 'http://127.0.0.1:8000'}, json={'api_key': 'another_secret_not_echoed_12345'})
    assert response.status_code == 409
    assert secret not in response.text
    assert 'another_secret_not_echoed_12345' not in response.text
    assert not env_path.exists()


def test_invalid_key_is_not_written(local_client):
    client, env_path = local_client
    response = client.put('/api/v1/local-settings/provider-key', headers={'Origin': 'http://127.0.0.1:8000'}, json={'api_key': 'secret\nINJECTED=true'})
    assert response.status_code == 422
    assert 'INJECTED' not in response.text
    assert not env_path.exists()
