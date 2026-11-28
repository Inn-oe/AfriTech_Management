"""Master admin portal: plans, company subscriptions, payments that move the renewal date, suspension, suppliers."""
import itertools
from datetime import date, timedelta

import pytest

from app.payment_plans import add_months

H = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def signup(app, name):
    c = app.test_client()
    n = next(_n)
    email = f'{name.lower().replace(" ", "")}{n}@master.test'
    r = c.post('/api/auth/signup', headers=H, json={'company_name': f'{name} {n}', 'name': 'Owner', 'email': email,
                                                    'password': 'a-long-password'})
    assert r.status_code == 201, r.get_json()
    return c, email, r.get_json()['company']['id']


@pytest.fixture()
def owner(app, monkeypatch):
    """The platform owner (signed in, listed in PLATFORM_ADMIN_EMAILS) and a separate customer company."""
    op, op_email, _ = signup(app, 'Platform')
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', op_email)
    cust, cust_email, cust_id = signup(app, 'Sunshine')
    return op, cust, cust_id, cust_email


def post(c, url, body=None, status=(200, 201)):
    r = c.post(url, headers=H, json=body or {})
    assert r.status_code in status, (url, r.status_code, r.get_json())
    return r.get_json()


def patch(c, url, body, status=(200,)):
    r = c.patch(url, headers=H, json=body)
    assert r.status_code in status, (url, r.status_code, r.get_json())
    return r.get_json()


def row(op, cid):
    return next(c for c in op.get('/api/master/companies').get_json()['companies'] if c['id'] == cid)


def test_only_the_platform_owner_can_use_it(owner):
    op, cust, cid, _ = owner
    assert op.get('/api/master/overview').status_code == 200
    assert cust.get('/api/master/overview').status_code == 403
    assert cust.post('/api/master/plans', headers=H, json={'name': 'Free', 'monthly_price': 0}).status_code == 403
    assert cust.patch(f'/api/master/companies/{cid}', headers=H, json={'is_active': False}).status_code == 403


def test_a_new_company_has_no_plan_until_you_give_it_one(owner):
    op, _, cid, cust_email = owner
    r = row(op, cid)
    assert r['status'] == 'no_plan' and r['owner_email'] == cust_email and r['users'] == 1 and r['plan_name'] is None
    no_plan = op.post(f'/api/master/companies/{cid}/payments', headers=H, json={'amount': 30})
    assert no_plan.status_code == 400 and 'plan' in no_plan.get_json()['error']


def test_a_payment_moves_the_renewal_date_and_an_unpaid_company_is_overdue(owner):
    op, _, cid, _ = owner
    plan = post(op, '/api/master/plans', {'name': 'Starter', 'monthly_price': 30, 'max_users': 3})
    r = patch(op, f'/api/master/companies/{cid}', {'plan_id': plan['id']})
    assert r['plan_name'] == 'Starter' and r['status'] in ('renews_soon', 'active')          # renews today, unpaid
    patch(op, f'/api/master/companies/{cid}', {'renews_on': (date.today() - timedelta(days=10)).isoformat()})
    r = row(op, cid)
    assert r['status'] == 'overdue' and r['days_overdue'] == 10

    paid = post(op, f'/api/master/companies/{cid}/payments', {'amount': 90, 'months': 3, 'method': 'ECOCASH', 'reference': 'EC77'})
    assert paid['renews_on'] == add_months(date.today(), 3).isoformat() and paid['status'] == 'active'    # from today, not from the old date
    assert paid['last_payment']['amount'] == 90
    again = post(op, f'/api/master/companies/{cid}/payments', {'amount': 30})
    assert again['renews_on'] == add_months(add_months(date.today(), 3), 1).isoformat()                    # paid ahead: added on top
    history = op.get(f'/api/master/companies/{cid}/payments').get_json()['payments']
    assert [p['amount'] for p in history] == [30, 90] or sorted(p['amount'] for p in history) == [30, 90]
    assert op.post(f'/api/master/companies/{cid}/payments', headers=H, json={'amount': 0}).status_code == 400

    overview = op.get('/api/master/overview').get_json()
    assert overview['collected_this_month'] >= 120 and overview['companies'] >= 2


def test_suspending_a_company_stops_its_people_signing_in_and_reactivating_restores_it(app, owner):
    op, cust, cid, cust_email = owner
    patch(op, f'/api/master/companies/{cid}', {'is_active': False})
    assert row(op, cid)['status'] == 'suspended'
    login = app.test_client().post('/api/auth/login', headers=H, json={'email': cust_email, 'password': 'a-long-password'})
    assert login.status_code == 401
    assert cust.get('/api/auth/me').get_json().get('user') is None          # an open session is ended too
    patch(op, f'/api/master/companies/{cid}', {'is_active': True})
    login = app.test_client().post('/api/auth/login', headers=H, json={'email': cust_email, 'password': 'a-long-password'})
    assert login.status_code == 200


def test_the_plan_limits_how_many_team_members_a_company_can_add(owner):
    op, cust, cid, _ = owner
    plan = post(op, '/api/master/plans', {'name': 'Solo', 'monthly_price': 10, 'max_users': 2})
    patch(op, f'/api/master/companies/{cid}', {'plan_id': plan['id']})
    one = cust.post('/api/users', headers=H, json={'name': 'Second', 'email': f'second{next(_n)}@master.test',
                                                   'password': 'a-long-password', 'role': 'sales'})
    assert one.status_code == 201
    two = cust.post('/api/users', headers=H, json={'name': 'Third', 'email': f'third{next(_n)}@master.test',
                                                   'password': 'a-long-password', 'role': 'sales'})
    assert two.status_code == 400 and 'allows 2 team members' in two.get_json()['error']
    patch(op, f'/api/master/plans/{plan["id"]}', {'max_users': ''})          # no limit: allowed again
    assert cust.post('/api/users', headers=H, json={'name': 'Third', 'email': f'third{next(_n)}@master.test',
                                                    'password': 'a-long-password', 'role': 'sales'}).status_code == 201


def test_plans_can_be_changed_and_one_in_use_cannot_be_deleted(owner):
    op, _, cid, _ = owner
    plan = post(op, '/api/master/plans', {'name': 'Pro', 'monthly_price': 80})
    assert patch(op, f'/api/master/plans/{plan["id"]}', {'monthly_price': 90})['monthly_price'] == 90
    patch(op, f'/api/master/companies/{cid}', {'plan_id': plan['id']})
    assert op.delete(f'/api/master/plans/{plan["id"]}', headers=H).status_code == 400
    patch(op, f'/api/master/companies/{cid}', {'plan_id': None})
    assert op.delete(f'/api/master/plans/{plan["id"]}', headers=H).status_code == 200
    assert op.post('/api/master/plans', headers=H, json={'name': '', 'monthly_price': 5}).status_code == 400
    assert op.post('/api/master/plans', headers=H, json={'name': 'Bad', 'monthly_price': -1}).status_code == 400


def test_suppliers_directory(owner):
    op, cust, _, _ = owner
    s = post(op, '/api/master/suppliers', {'name': 'Mr Dube (Harare)', 'phone': '0771111111', 'town': 'Harare',
                                           'supplies': ['solar', 'nonsense', 'cctv'], 'recommended': True})
    assert s['supplies'] == ['solar', 'cctv'] and s['recommended'] is True
    post(op, '/api/master/suppliers', {'name': 'Electrosales', 'website': 'https://www.electrosales.co.zw'})
    listing = op.get('/api/master/suppliers').get_json()['suppliers']
    assert [x['name'] for x in listing][0] == 'Mr Dube (Harare)'                # recommended ones first
    assert patch(op, f'/api/master/suppliers/{s["id"]}', {'recommended': False, 'notes': 'cash only'})['notes'] == 'cash only'
    assert op.delete(f'/api/master/suppliers/{s["id"]}', headers=H).status_code == 200
    assert cust.get('/api/master/suppliers').status_code == 403
