"""Selling something that is out of stock: it is bought in on the invoice (price now or later) instead of being refused."""
import itertools

import pytest

H = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def post(c, url, body=None, status=(200, 201)):
    r = c.post(url, headers=H, json=body or {})
    assert r.status_code in status, (url, r.status_code, r.get_json())
    return r.get_json()


def qty(c, item):
    return c.get(f"/api/inventory/{item['id']}").get_json()['quantity']


@pytest.fixture()
def shop(app):
    """A company with a customer, 10 panels and 2 inverters (cost 500, sell 700)."""
    c = app.test_client()
    n = next(_n)
    post(c, '/api/auth/signup', {'company_name': f'Restock Co {n}', 'name': 'Owner',
                                 'email': f'owner{n}@restock.test', 'password': 'a-long-password'})
    cust = post(c, '/api/customers', {'name': 'Tendai', 'surname': 'Moyo', 'phone': '0771234567', 'address': 'Harare'})
    panel = post(c, '/api/inventory', {'name': '550W Panel', 'quantity': 10, 'cost_price': 80, 'unit_price': 120})
    inverter = post(c, '/api/inventory', {'name': '5kVA Inverter', 'quantity': 2, 'cost_price': 500, 'unit_price': 700,
                                          'category': 'Inverters'})
    return c, cust, panel, inverter


def inv_body(cust, item, quantity, price=700, restock=None):
    body = {'customer_id': cust['id'], 'items': [{'inventory_id': item['id'], 'quantity': quantity, 'unit_price': price}]}
    if restock is not None:
        body['restock'] = restock
    return body


def test_out_of_stock_item_is_bought_in_with_a_price(shop):
    c, cust, _, inverter = shop                       # 2 inverters on hand, cost 500
    inv = post(c, '/api/invoices', inv_body(cust, inverter, 5, restock=[
        {'inventory_id': inverter['id'], 'quantity': 3, 'cost_price': 520}]))
    assert qty(c, inverter) == 0                       # 2 + 3 bought in - 5 sold
    item = c.get(f"/api/inventory/{inverter['id']}").get_json()
    assert item['cost_price'] == 520
    kinds = [t['transaction_type'] for t in item['transactions']]
    assert 'STOCK_IN' in kinds and 'STOCK_OUT' in kinds
    assert inv['items'][0]['cost_pending'] is False
    assert c.get('/api/financial/summary').get_json()['kpis']['cogs'] == 5 * 520


def test_buying_price_can_be_left_blank_and_added_later(shop):
    c, cust, _, inverter = shop
    inv = post(c, '/api/invoices', inv_body(cust, inverter, 4, restock=[{'inventory_id': inverter['id'], 'quantity': 2}]))
    assert qty(c, inverter) == 0 and inv['items'][0]['cost_pending'] is True
    item_id = inv['items'][0]['id']

    bad = c.post(f"/api/invoices/{inv['id']}/items/{item_id}/cost", headers=H, json={})
    assert bad.status_code == 400
    done = post(c, f"/api/invoices/{inv['id']}/items/{item_id}/cost", {'cost_price': 560})
    assert done['items'][0]['cost_pending'] is False
    assert c.get('/api/financial/summary').get_json()['kpis']['cogs'] == 4 * 560
    txns = c.get(f"/api/inventory/{inverter['id']}").get_json()['transactions']
    bought = [t for t in txns if t['reference_type'] == 'invoice_restock']
    assert bought and bought[0]['unit_price'] == 560 and bought[0]['total_value'] == 2 * 560


def test_a_shortfall_that_is_not_covered_is_still_refused(shop):
    c, cust, _, inverter = shop
    r = c.post('/api/invoices', headers=H, json=inv_body(cust, inverter, 5))
    assert r.status_code == 400 and 'out of stock' in r.get_json()['error']
    short = c.post('/api/invoices', headers=H, json=inv_body(cust, inverter, 5, restock=[
        {'inventory_id': inverter['id'], 'quantity': 1}]))
    assert short.status_code == 400 and 'at least 3' in short.get_json()['error']
    assert qty(c, inverter) == 2 and c.get('/api/invoices').get_json() == []


def test_item_with_no_stock_at_all_can_be_sold(shop):
    c, cust, _, _ = shop
    battery = post(c, '/api/inventory', {'name': '5kWh Battery', 'quantity': 0, 'unit_price': 900, 'category': 'Batteries'})
    inv = post(c, '/api/invoices', inv_body(cust, battery, 2, 900, restock=[{'inventory_id': battery['id'], 'quantity': 2}]))
    assert qty(c, battery) == 0 and inv['items'][0]['cost_pending'] is True
    # deleting the invoice puts the sold units back on the shelf
    assert c.delete(f"/api/invoices/{inv['id']}", headers=H).status_code == 200
    assert qty(c, battery) == 2


def test_converting_a_quotation_with_out_of_stock_items_needs_the_go_ahead(shop):
    c, cust, _, inverter = shop
    q = post(c, '/api/quotations', {'customer_id': cust['id'], 'items': [
        {'inventory_id': inverter['id'], 'quantity': 6, 'unit_price': 700}]})
    refused = c.post(f"/api/quotations/{q['id']}/convert", headers=H, json={})
    assert refused.status_code == 400 and qty(c, inverter) == 2
    inv = post(c, f"/api/quotations/{q['id']}/convert", {'allow_restock': True})
    assert qty(c, inverter) == 0 and inv['items'][0]['cost_pending'] is True


def test_editing_an_invoice_can_also_buy_in(shop):
    c, cust, _, inverter = shop
    inv = post(c, '/api/invoices', inv_body(cust, inverter, 1))
    body = inv_body(cust, inverter, 4, restock=[{'inventory_id': inverter['id'], 'quantity': 2, 'cost_price': 505}])
    r = c.put(f"/api/invoices/{inv['id']}", headers=H, json=body)
    assert r.status_code == 200, r.get_json()
    assert qty(c, inverter) == 0 and r.get_json()['items'][0]['cost_pending'] is False


def test_convert_with_the_stock_in_entered_in_the_popup_and_a_dashboard_warning(shop):
    c, cust, _, inverter = shop
    q = post(c, '/api/quotations', {'customer_id': cust['id'], 'items': [
        {'inventory_id': inverter['id'], 'quantity': 5, 'unit_price': 700}]})
    inv = post(c, f"/api/quotations/{q['id']}/convert", {'restock': [{'inventory_id': inverter['id'], 'quantity': 4}]})
    assert qty(c, inverter) == 1 and inv['items'][0]['cost_pending'] is True   # 2 + 4 bought in - 5 sold

    warn = c.get('/api/dashboard').get_json()['unpriced_stock_in']
    assert warn == {'count': 1, 'invoices': 1, 'invoice_id': inv['id']}
    post(c, f"/api/invoices/{inv['id']}/items/{inv['items'][0]['id']}/cost", {'cost_price': 510})
    assert c.get('/api/dashboard').get_json()['unpriced_stock_in']['count'] == 0
