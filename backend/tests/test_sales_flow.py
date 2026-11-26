"""The way a solar company really trades: stock in, quotation, invoice, part payments, receipts, the books,
and the walls between companies and between staff roles."""
import itertools

import pytest

H = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def new_company(app):
    """A fresh signed-up company owner, with their own browser session."""
    n = next(_n)
    c = app.test_client()
    r = c.post('/api/auth/signup', headers=H, json={
        'company_name': f'Sun Co {n}', 'name': 'Owner', 'email': f'owner{n}@flow.test', 'password': 'a-long-password'})
    assert r.status_code == 201, r.get_json()
    return c


def post(c, url, body=None, status=(200, 201)):
    r = c.post(url, headers=H, json=body or {})
    assert r.status_code in status, (url, r.status_code, r.get_json())
    return r.get_json()


def stock_item(c, name, qty, cost, price, category='Solar Panels'):
    return post(c, '/api/inventory', {'name': name, 'quantity': qty, 'cost_price': cost, 'unit_price': price,
                                      'category': category})


@pytest.fixture()
def shop(app):
    """A company with a customer and stock: 10 panels (cost 80, sell 120) and 2 inverters (cost 500, sell 700)."""
    c = new_company(app)
    cust = post(c, '/api/customers', {'name': 'Tendai', 'surname': 'Moyo', 'phone': '0771234567', 'address': 'Harare'})
    panel = stock_item(c, '550W Panel', 10, 80, 120)
    inverter = stock_item(c, '5kVA Inverter', 2, 500, 700, 'Inverters')
    return c, cust, panel, inverter


def qty(c, item):
    return c.get(f"/api/inventory/{item['id']}").get_json()['quantity']


def test_quote_to_invoice_to_payment_moves_stock_and_money_correctly(shop):
    c, cust, panel, inverter = shop
    # a quotation mixing stock items with a custom labour line
    q = post(c, '/api/quotations', {'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 4, 'unit_price': 120},
        {'inventory_id': inverter['id'], 'quantity': 1, 'unit_price': 700},
        {'description': 'Installation labour', 'quantity': 1, 'unit_price': 150}]})
    assert q['total_amount'] == 4 * 120 + 700 + 150 == 1330 and q['status'] == 'PENDING'
    assert qty(c, panel) == 10, 'a quotation must not take stock'

    inv = post(c, f"/api/quotations/{q['id']}/convert")
    assert inv['total_amount'] == 1330 and inv['balance_due'] == 1330 and inv['quotation_number'] == q['quotation_number']
    assert (qty(c, panel), qty(c, inverter)) == (6, 1), 'an invoice takes the stock'
    again = c.post(f"/api/quotations/{q['id']}/convert", headers=H, json={})
    assert again.status_code == 400, 'a quotation converts only once'

    # part payment, then an overpayment is refused, then the rest
    p1 = post(c, f"/api/invoices/{inv['id']}/payments", {'amount': 500, 'payment_method': 'ECOCASH', 'payer_name': 'Tendai'})
    assert c.get(f"/api/invoices/{inv['id']}").get_json()['status'] == 'PARTIAL'
    over = c.post(f"/api/invoices/{inv['id']}/payments", headers=H, json={'amount': 900})
    assert over.status_code == 400
    p2 = post(c, f"/api/invoices/{inv['id']}/payments", {'amount': 830, 'payment_method': 'CASH'})
    paid = c.get(f"/api/invoices/{inv['id']}").get_json()
    assert paid['status'] == 'PAID' and paid['balance_due'] == 0 and paid['paid_amount'] == 1330
    assert p1['transaction_id'] != p2['transaction_id']

    # documents print
    for url in (f"/api/quotations/{q['id']}/pdf", f"/api/invoices/{inv['id']}/pdf", f"/api/payments/{p1['id']}/pdf"):
        r = c.get(url)
        assert r.status_code == 200 and r.mimetype == 'application/pdf' and r.data.startswith(b'%PDF'), url

    # the books: revenue 1330, cost of goods 4*80 + 500 = 820, cash collected 1330
    k = c.get('/api/financial/summary').get_json()['kpis']
    assert k['revenue'] == 1330 and k['cogs'] == 820 and k['gross_profit'] == 510 and k['collected'] == 1330

    # a deleted payment re-opens the invoice
    assert c.delete(f"/api/payments/{p2['id']}", headers=H).status_code == 200
    reopened = c.get(f"/api/invoices/{inv['id']}").get_json()
    assert reopened['status'] == 'PARTIAL' and reopened['balance_due'] == 830


def test_deleting_an_invoice_puts_the_stock_back(shop):
    c, cust, panel, _ = shop
    inv = post(c, '/api/invoices', {'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 3, 'unit_price': 120}]})
    assert qty(c, panel) == 7
    assert c.delete(f"/api/invoices/{inv['id']}", headers=H).status_code == 200
    assert qty(c, panel) == 10


def test_selling_more_than_is_in_stock_is_refused(shop):
    c, cust, panel, inverter = shop
    r = c.post('/api/invoices', headers=H, json={'customer_id': cust['id'], 'items': [
        {'inventory_id': inverter['id'], 'quantity': 3, 'unit_price': 700}]})
    assert r.status_code == 400 and 'Insufficient stock' in r.get_json()['error']
    assert qty(c, inverter) == 2
    out = c.post(f"/api/inventory/{inverter['id']}/stock-out", headers=H, json={'quantity': 5})
    assert out.status_code == 400


def test_editing_an_invoice_rebalances_stock(shop):
    c, cust, panel, _ = shop
    inv = post(c, '/api/invoices', {'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 5, 'unit_price': 120}]})
    assert qty(c, panel) == 5
    r = c.put(f"/api/invoices/{inv['id']}", headers=H, json={'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 2, 'unit_price': 120}]})
    assert r.status_code == 200 and r.get_json()['total_amount'] == 240
    assert qty(c, panel) == 8


def test_receiving_stock_updates_quantity_and_cost(shop):
    c, _, panel, _ = shop
    r = post(c, f"/api/inventory/{panel['id']}/stock-in", {'quantity': 20, 'unit_price': 75, 'notes': 'Supplier delivery'})
    assert r['quantity'] == 30 and r['cost_price'] == 75
    history = c.get(f"/api/inventory/{panel['id']}").get_json()['transactions']
    assert any(t['quantity'] == 20 for t in history)


def test_a_job_can_be_scheduled_and_completed(shop):
    c, cust, _, _ = shop
    kind = post(c, '/api/activity-types', {'name': 'Installation'})
    job = post(c, '/api/activities', {'customer_id': cust['id'], 'activity_type_id': kind['id'],
                                      'technician': 'Farai', 'status': 'SCHEDULED', 'description': '5kVA install'})
    done = c.put(f"/api/activities/{job['id']}", headers=H, json={
        'customer_id': cust['id'], 'activity_type_id': kind['id'], 'status': 'COMPLETED', 'total_cost': 150})
    assert done.status_code == 200 and done.get_json()['status'] == 'COMPLETED'


def test_one_company_can_never_see_or_change_anothers_records(app, shop):
    c, cust, panel, _ = shop
    inv = post(c, '/api/invoices', {'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 1, 'unit_price': 120}]})
    rival = new_company(app)
    for url in (f"/api/invoices/{inv['id']}", f"/api/invoices/{inv['id']}/pdf", f"/api/inventory/{panel['id']}",
                f"/api/customers/{cust['id']}"):
        assert rival.get(url).status_code == 404, url
    for lst in ('/api/invoices', '/api/inventory', '/api/customers', '/api/payments', '/api/quotations'):
        assert rival.get(lst).get_json() == [], lst
    assert rival.delete(f"/api/invoices/{inv['id']}", headers=H).status_code == 404
    assert rival.post(f"/api/invoices/{inv['id']}/payments", headers=H, json={'amount': 10}).status_code == 404
    assert rival.post(f"/api/inventory/{panel['id']}/stock-out", headers=H, json={'quantity': 1}).status_code == 404
    # and the rival cannot invoice the first company's customer or stock
    r = rival.post('/api/invoices', headers=H, json={'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 1, 'unit_price': 1}]})
    assert r.status_code in (400, 404)
    assert rival.get('/api/financial/summary').get_json()['kpis']['revenue'] == 0


def test_staff_roles_see_only_what_their_job_needs(app, shop):
    c, cust, panel, _ = shop
    post(c, '/api/users', {'name': 'Farai', 'email': 'tech@flow.test', 'role': 'technician',
                                'password': 'a-long-password'})
    post(c, '/api/users', {'name': 'Rudo', 'email': 'sales@flow.test', 'role': 'sales',
                                'password': 'a-long-password'})
    tech, sales = app.test_client(), app.test_client()
    for client, email in ((tech, 'tech@flow.test'), (sales, 'sales@flow.test')):
        assert client.post('/api/auth/login', headers=H, json={'email': email, 'password': 'a-long-password'}).status_code == 200

    # a technician works on jobs, but cannot see money or change stock or the team
    assert tech.get('/api/activities').status_code == 200
    assert tech.get('/api/invoices').status_code == 403
    assert tech.get('/api/financial/summary').status_code == 403
    assert tech.post(f"/api/inventory/{panel['id']}/stock-in", headers=H, json={'quantity': 1}).status_code == 403
    assert tech.get('/api/users').status_code == 403
    # a salesperson quotes and invoices, but cannot touch finance, stock levels or the team
    assert sales.post('/api/quotations', headers=H, json={'customer_id': cust['id'], 'items': [
        {'inventory_id': panel['id'], 'quantity': 1, 'unit_price': 120}]}).status_code == 201
    assert sales.get('/api/financial/summary').status_code == 403
    assert sales.post(f"/api/inventory/{panel['id']}/stock-in", headers=H, json={'quantity': 1}).status_code == 403
    assert sales.get('/api/users').status_code == 403
    # nobody can act without the request header (cross-site protection)
    assert c.post('/api/customers', json={'name': 'X'}).status_code == 400


def test_the_same_login_cannot_be_registered_twice_and_weak_passwords_are_refused(app):
    c = new_company(app)
    dup = app.test_client().post('/api/auth/signup', headers=H, json={
        'company_name': 'Other', 'name': 'X', 'email': 'owner1@flow.test', 'password': 'a-long-password'})
    assert dup.status_code == 400
    weak = app.test_client().post('/api/auth/signup', headers=H, json={
        'company_name': 'Weak Co', 'name': 'X', 'email': 'weak@flow.test', 'password': '123'})
    assert weak.status_code == 400
