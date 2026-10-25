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
        'providers': {
            'groq': {'configured': False, 'saved_in_env': True, 'restart_required': True, 'environment_override': False},
            'openai': {'configured': False, 'saved_in_env': False, 'restart_required': False, 'environment_override': False},
            'gemini': {'configured': False, 'saved_in_env': False, 'restart_required': False, 'environment_override': False},
            'anthropic': {'configured': False, 'saved_in_env': False, 'restart_required': False, 'environment_override': False},
            'ollama': {'configured': True, 'saved_in_env': False, 'restart_required': False, 'environment_override': False, 'local_only': True},
        },
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


@pytest.mark.parametrize(('provider', 'env_name'), [
    ('openai', 'OPENAI_API_KEY'), ('gemini', 'GEMINI_API_KEY'), ('anthropic', 'ANTHROPIC_API_KEY'),
])
def test_provider_keys_saved_to_backend_env_without_echo(local_client, provider, env_name):
    client, env_path = local_client
    secret = 'provider_key_should_never_be_returned_12345'
    response = client.put(f'/api/v1/local-settings/provider-keys/{provider}',
                          headers={'Origin': 'http://127.0.0.1:8000'}, json={'api_key': secret})
    assert response.status_code == 200
    assert secret not in response.text
    assert f'{env_name}=' in env_path.read_text(encoding='utf-8')


def test_ollama_key_is_not_accepted_by_key_setup(local_client):
    client, env_path = local_client
    response = client.put('/api/v1/local-settings/provider-keys/ollama',
                          headers={'Origin': 'http://127.0.0.1:8000'}, json={'api_key': 'not-used'})
    assert response.status_code == 422
    assert not env_path.exists()


def test_provider_environment_override_refuses_env_write_and_never_echoes_secret(local_client, monkeypatch):
    client, env_path = local_client
    secret = 'openai_environment_secret_never_echoed_12345'
    monkeypatch.setenv('OPENAI_API_KEY', secret)
    response = client.put('/api/v1/local-settings/provider-keys/openai',
                          headers={'Origin': 'http://127.0.0.1:8000'},
                          json={'api_key': 'replacement_secret_never_echoed_12345'})
    assert response.status_code == 409
    assert secret not in response.text and 'replacement_secret' not in response.text
    assert not env_path.exists()


def test_provider_qualified_role_models_save_to_new_env_names(local_client):
    client, env_path = local_client
    assignments = {
        'manager': 'openai::gpt-6-luna', 'writer': 'groq::openai/gpt-oss-20b',
        'coder': 'anthropic::claude-haiku-5-5', 'reviewer': 'ollama::qwen3:8b',
    }
    response = client.put('/api/v1/local-settings/agent-models',
                          headers={'Origin': 'http://127.0.0.1:8000'}, json=assignments)
    assert response.status_code == 200
    assert response.json()['saved_models'] == assignments
    contents = env_path.read_text(encoding='utf-8')
    assert 'ECOAGENT_AGENT_MODEL_MANAGER=' in contents
    assert 'ECOAGENT_AGENT_MODEL_REVIEWER=' in contents


@pytest.mark.parametrize('url', [
    'https://example.com/v1', 'http://192.0.2.10:11434/v1', 'http://127.0.0.1:11434/v1?token=secret',
])
def test_ollama_base_url_must_be_local_without_credentials_or_query(url, tmp_path):
    with pytest.raises(ValueError, match='loopback'):
        Settings(database_path=tmp_path / 'settings.sqlite3', ollama_base_url=url)
