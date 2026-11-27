"""Shop checkout: cash on delivery or pay online now (70% or more), an installer for a fee, razor wire, supplier company."""
import base64
import itertools

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')


def operator(app, monkeypatch):
    client = app.test_client()
    email = f'shop-pay{next(_n)}@example.test'
    assert client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Shop Pay {email}', 'name': 'Op', 'email': email, 'password': 'a-long-password'}).status_code == 201
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', email)
    return client


def listed(op, name, price, **extra):
    r = op.post('/api/shop/admin/products', headers=HEADERS, json={
        'name': name, 'trade': 'solar', 'source_price': 1, 'price_override': price, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()['id']


def order(client, pid, qty=1, **extra):
    from app import auth
    auth._HITS.clear()                      # the shop allows 5 orders per 10 minutes from one connection
    return client.post('/api/shop/orders', headers=HEADERS, json={
        'name': 'Tendai', 'phone': '0771 234 567', 'town': 'Harare', 'items': [{'id': pid, 'quantity': qty}], **extra})


def test_cash_on_delivery_needs_nothing_upfront(app, monkeypatch):
    op = operator(app, monkeypatch)
    pid = listed(op, 'Panel 550W', 100)
    body = order(app.test_client(), pid, 2, payment_option='COD').get_json()
    assert body['total'] == 200 and body['payment_option'] == 'COD' and body['deposit_due'] == 0
    assert body['balance_on_delivery'] == 200


def test_an_order_that_does_not_say_how_to_pay_is_cash_on_delivery(app, monkeypatch):
    op = operator(app, monkeypatch)
    pid = listed(op, 'Panel 550W', 100)
    assert order(app.test_client(), pid).get_json()['payment_option'] == 'COD'


def test_online_payment_is_at_least_the_minimum_deposit(app, monkeypatch):
    op = operator(app, monkeypatch)
    pid = listed(op, 'Inverter 5kVA', 1000)
    pub = app.test_client()
    ok = order(pub, pid, payment_option='ONLINE', deposit_percent=70, payment_method='ECOCASH')
    assert ok.status_code == 201 and ok.get_json()['deposit_due'] == 700 and ok.get_json()['balance_on_delivery'] == 300
    assert order(pub, pid, payment_option='ONLINE', deposit_percent=100, payment_method='TRANSFER').get_json()['balance_on_delivery'] == 0
    low = order(pub, pid, payment_option='ONLINE', deposit_percent=50, payment_method='ECOCASH')
    assert low.status_code == 400 and '70%' in low.get_json()['error']
    assert order(pub, pid, payment_option='ONLINE', deposit_percent=70).status_code == 400          # no method
    assert order(pub, pid, payment_option='CARD').status_code == 400

    # the owner can change the smallest deposit
    assert op.put('/api/shop/admin/settings', headers=HEADERS, json={'min_deposit_percent': 50}).status_code == 200
    assert order(pub, pid, payment_option='ONLINE', deposit_percent=50, payment_method='ECOCASH').status_code == 201
    assert op.put('/api/shop/admin/settings', headers=HEADERS, json={'min_deposit_percent': 0}).status_code == 400
    op.put('/api/shop/admin/settings', headers=HEADERS, json={'min_deposit_percent': 70})


def test_installer_for_a_fee_is_added_to_the_total(app, monkeypatch):
    op = operator(app, monkeypatch)
    op.put('/api/shop/admin/settings', headers=HEADERS, json={'install_fee_default': 30})
    panel = listed(op, 'Panel 550W', 100)                            # no fee of its own: the default $30
    camera = listed(op, 'CCTV kit', 200, install_fee=80)
    pub = app.test_client()
    products = {p['id']: p for p in pub.get('/api/shop/products').get_json()['products']}
    assert products[panel]['install_fee'] == 30 and products[camera]['install_fee'] == 80

    r = pub.post('/api/shop/orders', headers=HEADERS, json={
        'name': 'Tendai', 'phone': '0771234567', 'town': 'Harare', 'installer': True, 'payment_option': 'COD',
        'items': [{'id': panel, 'quantity': 4}, {'id': camera, 'quantity': 1}]}).get_json()
    assert r['installer'] and r['installation_fee'] == 110 and r['goods_total'] == 600 and r['total'] == 710
    none = order(pub, panel, 4, payment_option='COD').get_json()
    assert none['installation_fee'] == 0 and none['total'] == 400                                   # not asked for: no fee
    op.put('/api/shop/admin/settings', headers=HEADERS, json={'install_fee_default': 0})


def test_razor_wire_supplier_company_and_own_photo(app, monkeypatch):
    op = operator(app, monkeypatch)
    pid = op.post('/api/shop/admin/products', headers=HEADERS, json={
        'name': 'Razor wire 450mm coil', 'trade': 'razorwire', 'price_override': 25, 'source_price': 20,
        'supplier_company': 'Steel Fencing Zimbabwe'}).get_json()['id']
    pub = app.test_client()
    item = next(p for p in pub.get('/api/shop/products?trade=razorwire').get_json()['products'] if p['id'] == pid)
    assert item['supplier_company'] == 'Steel Fencing Zimbabwe' and item['trade'] == 'razorwire'
    assert pub.get('/api/shop/info').get_json()['business'] == 'ecommerce'

    up = op.put(f'/api/shop/admin/products/{pid}/image', headers=HEADERS,
                json={'image': 'data:image/png;base64,' + base64.b64encode(PNG).decode()})
    assert up.status_code == 200 and up.get_json()['image_url'].startswith(f'/api/shop/products/{pid}/image')
    img = pub.get(f'/api/shop/products/{pid}/image')
    assert img.status_code == 200 and img.mimetype == 'image/png' and img.data == PNG
    assert op.put(f'/api/shop/admin/products/{pid}/image', headers=HEADERS, json={'image': 'AAAA'}).status_code == 400
    assert op.delete(f'/api/shop/admin/products/{pid}/image', headers=HEADERS).status_code == 200
    assert pub.get(f'/api/shop/products/{pid}/image').status_code == 404


def test_customer_sends_a_payment_reference_and_the_owner_records_the_money(app, monkeypatch):
    op = operator(app, monkeypatch)
    pid = listed(op, 'Inverter 5kVA', 1000)
    pub = app.test_client()
    r = order(pub, pid, payment_option='ONLINE', deposit_percent=70, payment_method='ECOCASH').get_json()

    wrong = pub.post(f"/api/shop/orders/{r['ref']}/payment", headers=HEADERS, json={'phone': '0779999999', 'reference': 'EC123'})
    assert wrong.status_code == 404                                           # the phone must match the order
    ok = pub.post(f"/api/shop/orders/{r['ref']}/payment", headers=HEADERS, json={'phone': '077 1234567', 'reference': 'EC123'})
    assert ok.status_code == 200

    found = next(o for o in op.get('/api/shop/admin/orders').get_json()['orders'] if o['ref'] == r['ref'])
    assert found['payment_reference'] == 'EC123' and found['deposit_due'] == 700 and found['balance_due'] == 1000
    done = op.patch(f"/api/shop/admin/orders/{found['id']}", headers=HEADERS, json={'paid_amount': 700}).get_json()
    assert done['status'] == 'PAID' and done['balance_due'] == 300
    assert op.patch(f"/api/shop/admin/orders/{found['id']}", headers=HEADERS, json={'paid_amount': 5000}).status_code == 400

    cod = order(pub, pid, payment_option='COD').get_json()
    assert pub.post(f"/api/shop/orders/{cod['ref']}/payment", headers=HEADERS,
                    json={'phone': '0771234567', 'reference': 'X'}).status_code == 400
