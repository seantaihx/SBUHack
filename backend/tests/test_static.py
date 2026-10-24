from fastapi.testclient import TestClient


def test_built_frontend_served_with_api_precedence_and_safe_paths(tmp_path):
    from backend.app.main import create_app
    from backend.app.settings import Settings
    dist = tmp_path / 'dist'; dist.mkdir()
    (dist / 'index.html').write_text('<html>frontend-test</html>')
    (dist / 'assets').mkdir()
    (dist / 'assets/app.js').write_text('export const app = true;')
    outside = tmp_path / 'private.txt'; outside.write_text('must-not-serve')
    (dist / 'leak.txt').symlink_to(outside)
    settings = Settings(database_path=tmp_path / 'runs.sqlite3', frontend_dist=dist)
    with TestClient(create_app(settings)) as client:
        assert 'frontend-test' in client.get('/').text
        assert 'frontend-test' in client.get('/benchmarks/screen').text
        assert client.get('/assets/app.js').status_code == 200
        assert client.get('/assets/missing.js').status_code == 404
        assert client.get('/leak.txt').status_code == 404
        assert client.get('/api/v1/health').json()['status'] == 'ok'
        for path in ['/api', '/api/missing', '/api/v1/missing']:
            response = client.get(path)
            assert response.status_code == 404
            assert response.headers['content-type'].startswith('application/json')
            assert 'frontend-test' not in response.text
