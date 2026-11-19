"""Daily platform usage, for pricing the software: counting, the operator-only report, and who may see it."""
import itertools

from app import usage

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def signup(app, email=None):
    """A new company with a logged-in owner, on its own test client."""
    n = next(_n)
    client = app.test_client()
    email = email or f'usage{n}@example.test'
    resp = client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Usage Co {n}', 'name': 'Owner', 'email': email, 'password': 'a-long-password'})
    assert resp.status_code == 201
    return client, resp.get_json()['company']['id'], email


def report(client, days=7):
    resp = client.get(f'/api/platform/usage?days={days}')
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def mine(data, company_id):
    return next(c for c in data['companies'] if c['id'] == company_id)


def test_only_the_platform_operator_can_open_the_report(app, monkeypatch):
    client, _, email = signup(app)
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', '')
    assert client.get('/api/platform/usage').status_code == 403
    assert client.get('/api/auth/me').get_json()['features']['operator'] is False
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', f' Someone@Else.test , {email.upper()} ')
    assert client.get('/api/auth/me').get_json()['features']['operator'] is True
    assert client.get('/api/platform/usage').status_code == 200
    assert app.test_client().get('/api/platform/usage').status_code in (401, 403)      # not logged in


def test_requests_writes_and_active_users_are_counted_per_company(app, monkeypatch):
    client, company_id, email = signup(app)
    other, other_id, _ = signup(app)
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', email)
    usage.flush()
    before = mine(report(client), company_id)['totals']

    for _ in range(3):
        client.get('/api/customers')
    client.post('/api/customers', headers=HEADERS, json={'name': 'Counted Customer'})
    other.get('/api/customers')

    data = report(client)
    after = mine(data, company_id)['totals']
    assert after['requests'] - before['requests'] >= 4 + 1           # the 4 calls above (and the report's own)
    assert after['writes'] - before['writes'] == 1
    assert after['active_users'] >= 1
    assert mine(data, other_id)['totals']['requests'] >= 1           # the other company is counted on its own
    today = mine(data, company_id)['series'][-1]
    assert today['requests'] >= 5 and today['new_records'] >= 1       # the new customer shows as a new record


def test_report_shape_and_totals(app, monkeypatch):
    client, company_id, email = signup(app)
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', email)
    client.get('/api/customers')
    data = report(client, days=3)
    assert data['days'] == 3 and len(mine(data, company_id)['series']) == 3 and data['from'] <= data['to']
    c = mine(data, company_id)
    assert c['users'] == 1 and c['name'].startswith('Usage Co')
    assert c['per_day']['requests'] == round(c['totals']['requests'] / 3, 1)
    assert data['totals']['requests'] == sum(x['totals']['requests'] for x in data['companies'])
    assert report(client, days=9999)['days'] == 180 and report(client, days=0)['days'] == 1   # kept in range
