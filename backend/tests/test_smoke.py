def test_health(client):
    resp = client.get('/_health')
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'healthy'


def test_api_requires_login(client):
    assert client.get('/api/customers').status_code in (401, 403)


def test_unknown_api_route_is_json_404(client):
    resp = client.get('/api/does-not-exist')
    assert resp.status_code == 404
    assert resp.get_json()['error']
