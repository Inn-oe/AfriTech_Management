"""Shop: several sellers per product, the profit against each, recommended sellers and installation materials."""
import itertools

from app import shop

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def operator(app, monkeypatch):
    client = app.test_client()
    email = f'shop-offers{next(_n)}@example.test'
    assert client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Offers {email}', 'name': 'Op', 'email': email, 'password': 'a-long-password'}).status_code == 201
    monkeypatch.setenv('PLATFORM_ADMIN_EMAILS', email)
    return client


def inverter(op, price=380):
    """A 3kVA inverter: Electrosales-style source price $320, sold by us for $380."""
    r = op.post('/api/shop/admin/products', headers=HEADERS, json={
        'name': '3kVA inverter', 'trade': 'solar', 'source_name': 'Electrosales', 'source_price': 320, 'price_override': price})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def offer(op, pid, supplier, price, **extra):
    r = op.post(f'/api/shop/admin/products/{pid}/offers', headers=HEADERS, json={'supplier': supplier, 'price': price, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def test_profit_is_shown_against_every_seller_and_the_cheapest_is_found(app, monkeypatch):
    op = operator(app, monkeypatch)
    p = inverter(op)
    assert p['cheapest']['supplier'] == 'Electrosales' and p['cheapest']['profit'] == 60       # 380 - 320

    p = offer(op, p['id'], 'Mr Dube (Harare)', 280, note='cash only')
    assert len(p['offers']) == 2
    assert p['cheapest'] == {'supplier': 'Mr Dube (Harare)', 'price': 280.0, 'profit': 100.0, 'margin': 26.3, 'recommended': False}
    by = {o['supplier']: o for o in p['offers']}
    assert by['Electrosales']['profit'] == 60 and by['Electrosales']['read_from_shop'] is True
    assert by['Mr Dube (Harare)']['profit'] == 100 and by['Mr Dube (Harare)']['note'] == 'cash only'
    assert p['preferred']['supplier'] == 'Mr Dube (Harare)'                                    # nobody recommended: the cheapest


def test_a_recommended_seller_is_preferred_even_when_not_the_cheapest(app, monkeypatch):
    op = operator(app, monkeypatch)
    p = inverter(op)
    p = offer(op, p['id'], 'Mr Dube (Harare)', 280)
    oid = next(o['id'] for o in p['offers'] if o['supplier'] == 'Mr Dube (Harare)')
    p = op.patch(f'/api/shop/admin/offers/{oid}', headers=HEADERS, json={'price': 300, 'recommended': True}).get_json()
    assert p['preferred']['supplier'] == 'Mr Dube (Harare)' and p['preferred']['recommended'] is True and p['preferred']['profit'] == 80
    # a cheaper seller exists, but the one we recommend is the one we buy from
    p = offer(op, p['id'], 'Cheap Corner', 250)
    assert p['cheapest']['supplier'] == 'Cheap Corner' and p['preferred']['supplier'] == 'Mr Dube (Harare)'


def test_changing_our_price_changes_the_profit_and_bad_offers_are_refused(app, monkeypatch):
    op = operator(app, monkeypatch)
    p = inverter(op)
    p = op.patch(f"/api/shop/admin/products/{p['id']}", headers=HEADERS, json={'price_override': 400}).get_json()
    assert p['cheapest']['profit'] == 80
    assert op.post(f"/api/shop/admin/products/{p['id']}/offers", headers=HEADERS, json={'supplier': 'X', 'price': 0}).status_code == 400
    assert op.post(f"/api/shop/admin/products/{p['id']}/offers", headers=HEADERS, json={'price': 10}).status_code == 400
    assert op.post('/api/shop/admin/products/999999/offers', headers=HEADERS, json={'supplier': 'X', 'price': 10}).status_code == 404


def test_deleting_an_offer_and_a_product_clean_up(app, monkeypatch):
    op = operator(app, monkeypatch)
    p = inverter(op)
    p = offer(op, p['id'], 'Mr Dube', 280)
    oid = next(o['id'] for o in p['offers'] if o['supplier'] == 'Mr Dube')
    p = op.delete(f'/api/shop/admin/offers/{oid}', headers=HEADERS).get_json()
    assert [o['supplier'] for o in p['offers']] == ['Electrosales']
    p = offer(op, p['id'], 'Mr Dube', 280)
    assert op.delete(f"/api/shop/admin/products/{p['id']}", headers=HEADERS).status_code == 200
    assert op.delete(f'/api/shop/admin/offers/{oid}', headers=HEADERS).status_code == 404


def test_an_order_records_who_to_buy_from_and_at_what_cost(app, monkeypatch):
    op = operator(app, monkeypatch)
    p = inverter(op)
    p = offer(op, p['id'], 'Mr Dube (Harare)', 280)
    pub = app.test_client()
    from app import auth
    auth._HITS.clear()
    r = pub.post('/api/shop/orders', headers=HEADERS, json={
        'name': 'Tendai', 'phone': '0771234567', 'town': 'Harare', 'items': [{'id': p['id'], 'quantity': 2}]})
    assert r.status_code == 201, r.get_json()
    order = next(o for o in op.get('/api/shop/admin/orders').get_json()['orders'] if o['ref'] == r.get_json()['ref'])
    item = order['items'][0]
    assert item['source_name'] == 'Mr Dube (Harare)' and item['source_price'] == 280 and item['unit_price'] == 380


def test_offers_are_private_to_the_operator(app, monkeypatch):
    op = operator(app, monkeypatch)
    p = inverter(op)
    offer(op, p['id'], 'Mr Dube', 280)
    public = app.test_client().get('/api/shop/products').get_json()['products']
    item = next(x for x in public if x['id'] == p['id'])
    assert 'offers' not in item and 'cheapest' not in item and 'source_price' not in item
    assert app.test_client().post(f"/api/shop/admin/products/{p['id']}/offers", headers=HEADERS,
                                  json={'supplier': 'X', 'price': 1}).status_code in (401, 403)


def test_installation_materials_are_a_category():
    assert shop.classify('Surge protector 40kA', []) == 'materials'
    assert shop.classify('6mm solar cable 100m', []) == 'solar'                 # solar equipment keeps its own category
    assert shop.classify('Razor wire 450mm coil', []) == 'razorwire'
    assert shop.classify('25A MCB circuit breaker', []) == 'materials'
    assert shop.classify('Sofa set', ['Living Room']) is None


def test_default_shops_are_added_once_and_a_removed_one_stays_removed(app):
    from app.database import db_session
    with app.app_context():
        db_session.query(shop.ShopSource).delete()
        shop._set('seeded_sources', '')
        # an older install: TV Sales was set up to read only solar
        db_session.add(shop.ShopSource(name='TV Sales & Home', base_url='https://www.tvsales.co.zw', categories='solar'))
        db_session.commit()
        shop.ensure_defaults()
        sources = {s.base_url: s for s in db_session.query(shop.ShopSource)}
        assert set(sources) == {'https://www.tvsales.co.zw', 'https://montanamallzw.com'}
        assert sources['https://www.tvsales.co.zw'].categories == ''                    # now reads the whole shop
        db_session.delete(sources['https://montanamallzw.com'])
        db_session.commit()
        shop.ensure_defaults()
        assert {s.base_url for s in db_session.query(shop.ShopSource)} == {'https://www.tvsales.co.zw'}   # not put back
        db_session.remove()


def test_a_shop_that_cannot_be_read_is_refused_in_plain_words(app, monkeypatch):
    op = operator(app, monkeypatch)
    monkeypatch.setattr(shop, '_allowed_by_robots', lambda base, path: True)
    def feed(items):
        def get_json(url):
            if items is None:
                raise OSError('404')
            return items
        return get_json
    body = {'name': 'Custom Site', 'base_url': 'https://custom.example.co.zw'}
    monkeypatch.setattr(shop, '_get_json', feed(None))
    no_api = op.post('/api/shop/admin/sources', headers=HEADERS, json=body)
    assert no_api.status_code == 400 and 'not a WooCommerce shop' in no_api.get_json()['error']
    monkeypatch.setattr(shop, '_get_json', feed([{'prices': {'currency_code': 'ZAR'}}]))
    rand = op.post('/api/shop/admin/sources', headers=HEADERS, json=body)
    assert rand.status_code == 400 and 'ZAR' in rand.get_json()['error']
    monkeypatch.setattr(shop, '_get_json', feed([{'prices': {'currency_code': 'USD'}}]))
    ok = op.post('/api/shop/admin/sources', headers=HEADERS, json=body)
    assert ok.status_code == 201
    monkeypatch.setattr(shop, '_allowed_by_robots', lambda base, path: False)
    blocked = op.post('/api/shop/admin/sources', headers=HEADERS, json={'name': 'B', 'base_url': 'https://blocked.example.co.zw'})
    assert blocked.status_code == 400 and 'robots.txt' in blocked.get_json()['error']


def test_car_parts_and_toys_are_not_mistaken_for_borehole_pumps():
    assert shop.classify('Mercedes Benz C & E-Class Fuel Pump', []) is None
    assert shop.classify('Electric Balloon Pump Inflator', []) is None
    assert shop.classify('1HP solar submersible pump', []) == 'borehole'
    assert shop.classify('Pressure booster pump 0.75kW', []) == 'borehole'
