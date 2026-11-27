"""Online shop: reading shop feeds, markup prices, approval, public ordering and operator-only management."""
import itertools

from app import shop
from app.database import db_session

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def operator(app, monkeypatch):
    client = app.test_client()
    email = f'shop-op{next(_n)}@example.test'
    resp = client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Shop Op {email}', 'name': 'Op', 'email': email, 'password': 'a-long-password'})
    assert resp.status_code == 201
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', email)
    return client


def fake_feed(products, categories=None):
    def get_json(url):
        if '/products/categories' in url:
            return categories or []
        return products if 'page=1' in url else []
    return get_json


def woo(pid, name, cents, cats=('Solar',), stock=True):
    return {'id': pid, 'name': name, 'permalink': f'https://shop.test/p/{pid}', 'short_description': '<p>Good</p>',
            'images': [{'src': f'https://shop.test/{pid}.jpg'}], 'is_in_stock': stock,
            'categories': [{'name': c} for c in cats],
            'prices': {'price': str(cents), 'currency_code': 'USD', 'currency_minor_unit': 2}}


def test_classify_sorts_equipment_into_trades_and_skips_appliances():
    assert shop.classify('Hikvision 4MP Dome Camera', []) == 'cctv'
    assert shop.classify('Paradox Alarm Kit with Siren', []) == 'alarms'
    assert shop.classify('Solar Water Pump 1HP Submersible', ['Solar']) == 'borehole'
    assert shop.classify('Must 5kVA Hybrid Inverter', ['Solar']) == 'solar'
    assert shop.classify('Samsung 635L Inverter Fridge', ['Fridges']) is None
    assert shop.classify('Sofa set', ['Living Room']) is None


def test_sync_stores_new_items_as_pending_and_marks_vanished_items_out_of_stock(app):
    with app.app_context():
        src = shop.ShopSource(name='Test Shop', base_url='https://shop.test', categories='')
        db_session.add(src)
        db_session.commit()
        feed = [woo(1, 'Jinko 550W Solar Panel', 12000), woo(2, 'LG Inverter Fridge', 90000, cats=('Fridges',))]
        assert shop.sync_source(src, get_json=fake_feed(feed), pause=0) == 1
        p = db_session.query(shop.ShopProduct).filter_by(source_id=src.id).one()
        assert (p.name, p.status, p.source_price, p.trade, p.in_stock) == ('Jinko 550W Solar Panel', 'pending', 120.0,
                                                                             'solar', True)
        assert shop.sync_source(src, get_json=fake_feed([]), pause=0) == 0
        db_session.refresh(p)
        assert p.in_stock is False
        db_session.delete(p)
        db_session.delete(src)
        db_session.commit()


def test_sync_records_the_error_when_a_shop_cannot_be_read(app):
    with app.app_context():
        src = shop.ShopSource(name='Down', base_url='https://down.test')
        db_session.add(src)
        db_session.commit()

        def broken(url):
            raise OSError('HTTP Error 403: Forbidden')
        assert shop.sync_source(src, get_json=broken, pause=0) == 0
        assert '403' in src.last_error
        db_session.delete(src)
        db_session.commit()


def test_price_is_shop_price_plus_markup_rounded_up_unless_overridden(app):
    p = shop.ShopProduct(source_price=100.0)
    assert shop.selling_price(p, {'markup_percent': '15', 'markup_flat': '0'}) == 115.0
    assert shop.selling_price(p, {'markup_percent': '10', 'markup_flat': '2.5'}) == 113.0
    p.price_override = 99.99
    assert shop.selling_price(p, {'markup_percent': '15', 'markup_flat': '0'}) == 99.99


def test_only_listed_items_are_public_and_an_order_uses_server_prices(app, monkeypatch):
    op = operator(app, monkeypatch)
    assert op.put('/api/shop/admin/settings', headers=HEADERS,
                  json={'markup_percent': 10, 'markup_flat': 0, 'whatsapp_number': '+263 77 123 4567'}).status_code == 200
    item = op.post('/api/shop/admin/products', headers=HEADERS, json={
        'name': 'Hilook 4-camera CCTV kit', 'trade': 'cctv', 'source_price': 200, 'source_name': 'Mahommed Mussa'})
    assert item.status_code == 201, item.get_json()
    pid = item.get_json()['id']
    hidden = op.post('/api/shop/admin/products', headers=HEADERS,
                     json={'name': 'Hidden pump', 'trade': 'borehole', 'source_price': 50}).get_json()['id']
    op.patch(f'/api/shop/admin/products/{hidden}', headers=HEADERS, json={'status': 'hidden'})

    public = app.test_client()
    listed = public.get('/api/shop/products?trade=cctv').get_json()['products']
    mine = next(p for p in listed if p['id'] == pid)
    assert mine['price'] == 220.0
    assert 'source_name' not in mine and 'source_price' not in mine          # the source shop stays private
    assert hidden not in [p['id'] for p in public.get('/api/shop/products').get_json()['products']]

    resp = public.post('/api/shop/orders', headers=HEADERS, json={
        'name': 'Tendai', 'phone': '0771 234 567', 'town': 'Harare',
        'items': [{'id': pid, 'quantity': 2, 'price': 1}]})                    # a price sent by the browser is ignored
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body['total'] == 440.0 and body['ref'].startswith('SO') and body['whatsapp_number'] == '263771234567'

    assert public.post('/api/shop/orders', headers=HEADERS, json={
        'name': 'X', 'phone': '0771234567', 'town': 'Harare', 'items': [{'id': hidden}]}).status_code == 400

    orders = op.get('/api/shop/admin/orders').get_json()['orders']
    order = next(o for o in orders if o['ref'] == body['ref'])
    assert order['items'][0]['source_name'] == 'Mahommed Mussa' and order['status'] == 'NEW'
    done = op.patch(f"/api/shop/admin/orders/{order['id']}", headers=HEADERS, json={'status': 'PAID'})
    assert done.get_json()['status'] == 'PAID'


def test_shop_management_is_for_the_platform_operator_only(app, monkeypatch):
    op = operator(app, monkeypatch)
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', 'someone-else@example.test')
    assert op.get('/api/shop/admin/overview').status_code == 403
    assert op.get('/api/shop/admin/orders').status_code == 403
    assert app.test_client().get('/api/shop/admin/orders').status_code == 401
    assert app.test_client().get('/api/shop/info').status_code == 200


def test_order_needs_name_phone_town_and_items(app):
    c = app.test_client()
    assert c.post('/api/shop/orders', headers=HEADERS, json={'phone': '0771234567', 'town': 'Harare',
                                                             'items': [{'id': 1}]}).status_code == 400
    assert c.post('/api/shop/orders', headers=HEADERS, json={'name': 'A', 'phone': '12', 'town': 'Harare',
                                                             'items': [{'id': 1}]}).status_code == 400
    assert c.post('/api/shop/orders', headers=HEADERS, json={'name': 'A', 'phone': '0771234567', 'town': 'Harare',
                                                             'items': []}).status_code == 400
