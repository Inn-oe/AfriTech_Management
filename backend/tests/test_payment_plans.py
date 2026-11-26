"""Payment plans: a part-paid invoice is paid off in monthly instalments, and a missed instalment makes it overdue."""
import itertools
from datetime import date, datetime, timedelta

import pytest

from app.payment_plans import add_months, build_schedule

H = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def post(c, url, body=None, status=(200, 201)):
    r = c.post(url, headers=H, json=body or {})
    assert r.status_code in status, (url, r.status_code, r.get_json())
    return r.get_json()


@pytest.fixture()
def owed(app):
    """A company with an invoice for $1000 that has had $400 paid on it."""
    c = app.test_client()
    n = next(_n)
    post(c, '/api/auth/signup', {'company_name': f'Plan Co {n}', 'name': 'Owner',
                                 'email': f'owner{n}@plan.test', 'password': 'a-long-password'})
    cust = post(c, '/api/customers', {'name': 'Tendai', 'surname': 'Moyo', 'phone': '0771234567', 'address': 'Harare'})
    inv = post(c, '/api/invoices', {'customer_id': cust['id'], 'items': [
        {'description': 'Solar kit', 'quantity': 1, 'unit_price': 1000}]})
    post(c, f"/api/invoices/{inv['id']}/payments", {'amount': 400, 'payment_method': 'CASH'})
    return c, inv['id']


def invoice(c, inv_id):
    return c.get(f'/api/invoices/{inv_id}').get_json()


def days_ago(n):
    return (date.today() - timedelta(days=n)).isoformat()


def test_months_and_schedule_arithmetic():
    assert add_months(datetime(2026, 1, 31), 1) == datetime(2026, 2, 28)
    assert add_months(datetime(2026, 11, 15), 3) == datetime(2027, 2, 15)
    plan = build_schedule(600, 3, datetime(2026, 12, 1))
    assert [a for _, a in plan] == [200, 200, 200]
    uneven = build_schedule(100, 3, datetime(2026, 12, 31))
    assert [a for _, a in uneven] == [33.33, 33.33, 33.34] and round(sum(a for _, a in uneven), 2) == 100
    assert [d.month for d, _ in uneven] == [12, 1, 2]


def test_plan_splits_the_balance_into_monthly_instalments(owed):
    c, inv_id = owed
    plan = post(c, f'/api/invoices/{inv_id}/plan', {'months': 3})['plan']
    assert [i['amount'] for i in plan['installments']] == [200, 200, 200]
    assert plan['overdue_amount'] == 0 and plan['next_due']['amount'] == 200
    inv = invoice(c, inv_id)
    assert inv['has_plan'] and inv['overdue'] is False and inv['display_status'] == 'PARTIAL'
    assert inv['due_date'][:10] == plan['installments'][-1]['due_date'][:10]   # due in full at the last instalment


def test_a_missed_instalment_makes_the_invoice_overdue_until_it_is_paid(owed):
    c, inv_id = owed
    post(c, f'/api/invoices/{inv_id}/plan', {'months': 3, 'start_date': days_ago(40)})   # due 40 and 10 days ago, then ahead
    inv = invoice(c, inv_id)
    assert inv['overdue'] and inv['display_status'] == 'OVERDUE' and inv['overdue_amount'] == 400
    assert c.get('/api/dashboard').get_json()['overdue_invoices'] == 1
    assert c.get('/api/dashboard').get_json()['overdue_amount'] == 400

    post(c, f'/api/invoices/{inv_id}/payments', {'amount': 200})        # settles the oldest instalment
    inv = invoice(c, inv_id)
    assert inv['overdue_amount'] == 200 and [i['status'] for i in inv['plan']['installments']] == ['PAID', 'UNPAID', 'UNPAID']
    post(c, f'/api/invoices/{inv_id}/payments', {'amount': 200})
    inv = invoice(c, inv_id)
    assert inv['overdue'] is False and inv['display_status'] == 'PARTIAL'
    assert c.get('/api/dashboard').get_json()['overdue_invoices'] == 0

    post(c, f'/api/invoices/{inv_id}/payments', {'amount': 200})
    assert invoice(c, inv_id)['status'] == 'PAID'


def test_a_part_payment_toward_an_instalment_counts(owed):
    c, inv_id = owed
    post(c, f'/api/invoices/{inv_id}/plan', {'months': 3, 'start_date': days_ago(5)})
    post(c, f'/api/invoices/{inv_id}/payments', {'amount': 50})
    inv = invoice(c, inv_id)
    first = inv['plan']['installments'][0]
    assert first['status'] == 'PARTIAL' and first['paid'] == 50 and inv['overdue_amount'] == 150


def test_an_invoice_without_a_plan_is_overdue_after_its_due_date(owed):
    c, inv_id = owed
    c.put(f'/api/invoices/{inv_id}', headers=H, json={
        'customer_id': invoice(c, inv_id)['customer']['id'], 'due_date': days_ago(3),
        'items': [{'description': 'Solar kit', 'quantity': 1, 'unit_price': 1000}]})
    inv = invoice(c, inv_id)
    assert inv['overdue'] and inv['overdue_amount'] == 600 and inv['has_plan'] is False


def test_plan_can_be_changed_removed_and_is_refused_when_nothing_is_owed(owed):
    c, inv_id = owed
    post(c, f'/api/invoices/{inv_id}/plan', {'months': 3})
    changed = post(c, f'/api/invoices/{inv_id}/plan', {'months': 6})['plan']
    assert changed['count'] == 6                                         # replaced, not added to
    gone = c.delete(f'/api/invoices/{inv_id}/plan', headers=H).get_json()
    assert gone['plan'] is None and gone['has_plan'] is False
    assert c.post(f'/api/invoices/{inv_id}/plan', headers=H, json={'months': 0}).status_code == 400
    assert c.post(f'/api/invoices/{inv_id}/plan', headers=H, json={'months': 99}).status_code == 400
    post(c, f'/api/invoices/{inv_id}/payments', {'amount': 600})
    assert c.post(f'/api/invoices/{inv_id}/plan', headers=H, json={'months': 3}).status_code == 400


def test_editing_the_total_clears_the_plan_and_the_pdf_shows_it(owed):
    c, inv_id = owed
    post(c, f'/api/invoices/{inv_id}/plan', {'months': 2})
    pdf = c.get(f'/api/invoices/{inv_id}/pdf')
    assert pdf.status_code == 200 and pdf.data.startswith(b'%PDF')
    cust = invoice(c, inv_id)['customer']['id']
    same = c.put(f'/api/invoices/{inv_id}', headers=H, json={'customer_id': cust, 'items': [
        {'description': 'Solar kit', 'quantity': 1, 'unit_price': 1000}]}).get_json()
    assert same['plan_cleared'] is False and same['has_plan']
    bigger = c.put(f'/api/invoices/{inv_id}', headers=H, json={'customer_id': cust, 'items': [
        {'description': 'Solar kit', 'quantity': 1, 'unit_price': 1200}]}).get_json()
    assert bigger['plan_cleared'] is True and bigger['has_plan'] is False


def test_deleting_the_invoice_removes_its_plan(owed):
    c, inv_id = owed
    post(c, f'/api/invoices/{inv_id}/plan', {'months': 3})
    assert c.delete(f'/api/invoices/{inv_id}', headers=H).status_code == 200
    assert c.get(f'/api/invoices/{inv_id}').status_code == 404
