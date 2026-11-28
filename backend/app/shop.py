"""Online shop on the public landing page: solar, CCTV, borehole and alarm equipment sold by the platform operator.

Products are read once a day from other shops' public WooCommerce product feeds (for example TV Sales & Home), or
typed in by hand for shops without a website. The operator approves which items are listed; the selling price is the
shop's price plus the operator's markup, rounded up to a whole dollar. Customers place an order (no online payment
yet); the operator contacts them, takes the payment and delivers.

Public (no login):  GET /api/shop/info, GET /api/shop/products, POST /api/shop/orders
Operator only:      /api/shop/admin/...   (emails in PLATFORM_ADMIN_EMAILS)
"""
import base64
import html
import json
import logging
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timedelta

from flask import Blueprint, Response, g, jsonify, request
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint,
                        or_)
from sqlalchemy.orm import deferred, relationship, selectinload

from .auth import PUBLIC_ENDPOINTS, ApiError, _client_ip, _limited, _logo_mime, is_operator, protect
from .database import Base, db_session

log = logging.getLogger('erp.shop')
shop_bp = Blueprint('shop', __name__, url_prefix='/api/shop')

USER_AGENT = 'AfritechCatalogBot/1.0 (product price reader; respects robots.txt)'
TRADES = ('solar', 'cctv', 'borehole', 'alarms', 'razorwire', 'materials')
PAY_OPTIONS = ('COD', 'ONLINE')            # cash on delivery, or pay online now (a deposit of at least the minimum, up to all)
ONLINE_METHODS = ('ECOCASH', 'TRANSFER')
MAX_IMAGE_BYTES = 1_200_000
PRODUCT_STATUSES = ('pending', 'listed', 'hidden')
ORDER_STATUSES = ('NEW', 'CONTACTED', 'PAID', 'DELIVERED', 'CANCELLED')
SYNC_EVERY = timedelta(hours=24)
MAX_PAGES = 30           # 100 products per page
PAGE_PAUSE = 1.0         # seconds between feed pages, to be gentle on the shop's server

DEFAULT_SETTINGS = {'markup_percent': '15', 'markup_flat': '0', 'whatsapp_number': '', 'last_auto_sync': '',
                    'min_deposit_percent': '70', 'install_fee_default': '0', 'payment_instructions': '', 'seeded_sources': ''}
# Shops whose public WooCommerce product lists are read (robots.txt permitting). Only items for the trades we sell are kept.
DEFAULT_SOURCES = [
    {'name': 'TV Sales & Home', 'base_url': 'https://www.tvsales.co.zw', 'categories': ''},
    {'name': 'Montana Mall', 'base_url': 'https://montanamallzw.com', 'categories': ''},
]


# ---------------------------------------------------------------------------
# Tables (platform-wide: they belong to the operator, not to a tenant company)
# ---------------------------------------------------------------------------

class ShopSetting(Base):
    __tablename__ = 'shop_settings'
    key = Column(String(50), primary_key=True)
    value = Column(String(500), default='')


class ShopSource(Base):
    __tablename__ = 'shop_sources'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    base_url = Column(String(300), nullable=False)
    categories = Column(String(300), default='')     # comma-separated category slugs; empty = whole shop
    active = Column(Boolean, default=True)
    last_sync = Column(DateTime)
    last_error = Column(String(500))
    item_count = Column(Integer, default=0)


class ShopProduct(Base):
    __tablename__ = 'shop_products'
    __table_args__ = (UniqueConstraint('source_id', 'external_id', name='uq_shop_product_source'),)
    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey('shop_sources.id', ondelete='SET NULL'))
    source_name = Column(String(100))                # shown to the operator only, never to customers
    external_id = Column(String(50))
    source_url = Column(String(500))
    name = Column(String(250), nullable=False)
    trade = Column(String(20), default='solar')
    description = Column(Text, default='')
    image_url = Column(String(500))
    source_price = Column(Float, default=0)          # the shop's price (USD)
    price_override = Column(Float)                   # operator's own selling price, if set
    supplier_company = Column(String(100))           # the company providing this product, shown to customers
    install_fee = Column(Float)                      # fee for an installer for this item; empty = the shop's default fee
    image = deferred(Column(LargeBinary))            # a photo uploaded by the operator (image_url then points at it)
    offers = relationship('ShopOffer', cascade='all, delete-orphan', order_by='ShopOffer.price')
    in_stock = Column(Boolean, default=True)
    status = Column(String(20), default='pending')
    created = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)


class ShopOffer(Base):
    """One seller's price for a product (the operator's own list; the source shop's price is kept on the product)."""
    __tablename__ = 'shop_offers'
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey('shop_products.id', ondelete='CASCADE'), nullable=False, index=True)
    supplier = Column(String(100), nullable=False)
    price = Column(Float, nullable=False)
    url = Column(String(500))
    note = Column(String(200))
    recommended = Column(Boolean, default=False)     # a seller we recommend buying this from
    updated = Column(DateTime, default=datetime.utcnow)


class ShopOrder(Base):
    __tablename__ = 'shop_orders'
    id = Column(Integer, primary_key=True)
    ref = Column(String(20), unique=True)
    customer_name = Column(String(100), nullable=False)
    phone = Column(String(40), nullable=False)
    email = Column(String(120))
    town = Column(String(80))
    address = Column(String(300))
    notes = Column(String(1000))
    status = Column(String(20), default='NEW')
    admin_note = Column(String(1000))
    total = Column(Float, default=0)                 # goods plus the installer fee
    payment_option = Column(String(10), default='COD')   # COD = pay on delivery; ONLINE = pay a deposit (or all) now
    deposit_percent = Column(Integer, default=0)
    deposit_due = Column(Float, default=0)           # what the customer promised to pay now
    paid_amount = Column(Float, default=0)           # what we have received so far (recorded by the operator)
    payment_method = Column(String(20))              # ECOCASH or TRANSFER, for online payments
    payment_reference = Column(String(100))          # the customer's EcoCash / bank reference
    installer = Column(Boolean, default=False)       # the customer wants an installer
    installation_fee = Column(Float, default=0)
    created = Column(DateTime, default=datetime.utcnow)
    updated = Column(DateTime, default=datetime.utcnow)
    items = relationship('ShopOrderItem', cascade='all, delete-orphan', order_by='ShopOrderItem.id')


class ShopOrderItem(Base):
    __tablename__ = 'shop_order_items'
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey('shop_orders.id', ondelete='CASCADE'), nullable=False)
    product_id = Column(Integer, ForeignKey('shop_products.id', ondelete='SET NULL'))
    name = Column(String(250))
    unit_price = Column(Float, default=0)
    quantity = Column(Integer, default=1)
    source_name = Column(String(100))
    source_url = Column(String(500))
    source_price = Column(Float)
    supplier_company = Column(String(100))


# ---------------------------------------------------------------------------
# Settings and prices
# ---------------------------------------------------------------------------

def settings():
    rows = {s.key: s.value for s in db_session.query(ShopSetting).all()}
    return {k: rows.get(k, v) for k, v in DEFAULT_SETTINGS.items()}


def _set(key, value):
    row = db_session.get(ShopSetting, key)
    if row is None:
        db_session.add(ShopSetting(key=key, value=str(value)))
    else:
        row.value = str(value)


def _num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def selling_price(product, conf=None):
    """Operator's own price if set, otherwise the shop's price plus markup, rounded up to a whole dollar."""
    if product.price_override:
        return round(product.price_override, 2)
    conf = conf or settings()
    raw = (product.source_price or 0) * (1 + _num(conf['markup_percent']) / 100) + _num(conf['markup_flat'])
    return float(math.ceil(raw - 1e-9)) if raw > 0 else 0.0


def offers_view(p, conf=None):
    """Every seller of this product with the profit we would make at our selling price, and the best ones.

    Returns (rows, cheapest, preferred). `preferred` is the cheapest seller we recommend, or the cheapest overall
    when none is recommended. A seller that is out of stock, or has no price, is shown but never chosen."""
    price = selling_price(p, conf)
    rows = []
    if p.source_price:
        rows.append({'id': None, 'supplier': p.source_name or 'Source shop', 'price': round(p.source_price, 2),
                     'url': p.source_url, 'note': '', 'recommended': False, 'in_stock': bool(p.in_stock), 'read_from_shop': True})
    for o in p.offers:
        rows.append({'id': o.id, 'supplier': o.supplier, 'price': round(o.price, 2), 'url': o.url, 'note': o.note or '',
                     'recommended': bool(o.recommended), 'in_stock': True, 'read_from_shop': False})
    for r in rows:
        r['profit'] = round(price - r['price'], 2)
        r['margin'] = round((price - r['price']) / price * 100, 1) if price else 0.0
    usable = [r for r in rows if r['price'] > 0 and r['in_stock']]
    cheapest = min(usable, key=lambda r: r['price']) if usable else None
    recommended = [r for r in usable if r['recommended']]
    preferred = min(recommended, key=lambda r: r['price']) if recommended else cheapest
    return rows, cheapest, preferred


def install_fee_for(product, conf=None):
    """The fee for an installer to fit this item: its own fee, otherwise the shop's default fee."""
    if product.install_fee is not None:
        return round(product.install_fee, 2)
    return round(_num((conf or settings())['install_fee_default']), 2)


def ensure_defaults():
    """Add each default shop once (called at start-up). A shop the operator later removes is not put back."""
    seeded = {u for u in settings()['seeded_sources'].split(',') if u}
    changed = False
    for default in DEFAULT_SOURCES:
        if default['base_url'] in seeded:
            continue
        existing = db_session.query(ShopSource).filter_by(base_url=default['base_url']).first()
        if existing is None:
            db_session.add(ShopSource(**default))
        elif existing.categories == 'solar' and not default['categories']:
            existing.categories = ''          # it used to read only solar; now it reads the whole shop and keeps our trades
        seeded.add(default['base_url'])
        changed = True
    if changed:
        _set('seeded_sources', ','.join(sorted(seeded)))
        db_session.commit()


# ---------------------------------------------------------------------------
# Reading other shops' product feeds
# ---------------------------------------------------------------------------

_KEYWORDS = {
    'materials': ('cable', 'breaker', 'isolator', 'mcb', 'rcd', 'distribution board', 'db board', 'conduit', 'trunking',
                  'cable lug', 'connector', 'mc4', 'junction box', 'surge', 'fuse', 'earth rod', 'din rail',
                  'cable tie', 'busbar', 'gland'),
    'razorwire': ('razor wire', 'razorwire', 'razor-wire', 'concertina', 'barbed wire', 'barbwire', 'razor tape',
                  'security wire', 'palisade'),
    'cctv': ('cctv', 'dvr', 'nvr', 'ip camera', 'security camera', 'surveillance', 'dome camera', 'bullet camera',
             'hikvision', 'dahua', 'ezviz', 'hilook', 'poe switch'),
    'alarms': ('alarm', 'siren', 'intruder', 'motion sensor', 'motion detector', 'pir ', 'electric fence', 'energizer',
               'energiser', 'access control', 'intercom', 'gate motor', 'smart lock', 'biometric', 'keypad'),
    'borehole': ('borehole', 'submersible', 'water pump', 'solar pump', 'booster pump', 'pressure pump',
                 'pressure tank', 'water tank', 'jojo', 'pump controller', 'pump station'),
    'solar': ('solar', 'photovoltaic', 'pv panel', 'mppt', 'charge controller', 'lithium', 'lifepo4', 'deep cycle',
              'gel battery', 'power station', 'hybrid inverter', 'off-grid', 'off grid', 'kva', 'growatt', 'deye',
              'must inverter', 'felicity', 'pylontech', 'victron'),
}
# Household appliances that share words with the trades ("inverter fridge", "inverter air conditioner").
_EXCLUDE = ('fridge', 'freezer', 'refrigerator', 'air condition', 'aircon', 'washing', 'washer', 'microwave',
            'television', ' tv ', ' tvs', 'oven', 'cooker', 'dishwasher', 'kettle', ' iron ', 'blender', 'cell phone',
            'smartphone', 'smart watch', 'hair ', 'fuel pump', 'inflator', 'balloon', 'bicycle', 'tyre', 'tire',
            'mercedes', 'toyota', 'pajero', 'hilux', 'engine', 'breathalyzer', ' car ', 'vehicle')


def classify(name, category_names):
    """The trade a product belongs to, or None when it is not equipment we sell."""
    text = f' {name} '.lower()
    cats = ' '.join(category_names).lower()
    if any(w in text for w in _EXCLUDE):
        return None
    order = ('razorwire', 'cctv', 'alarms', 'borehole', 'solar', 'materials')        # most specific first ("solar water pump" -> borehole)
    for trade in order:
        if any(w in text for w in _KEYWORDS[trade]):
            return trade
    for trade in order:
        if any(w in cats for w in _KEYWORDS[trade]):
            return trade
    return 'solar' if 'solar' in cats else None


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=25) as resp:      # noqa: S310 - only http(s) URLs are stored
        return json.loads(resp.read().decode('utf-8'))


def _allowed_by_robots(base_url, path):
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(base_url.rstrip('/') + '/robots.txt')
    try:
        rp.read()
    except Exception:          # no robots.txt reachable: the usual convention is that reading is allowed
        return True
    return rp.can_fetch(USER_AGENT, base_url.rstrip('/') + path)


def _plain(text_html, limit=600):
    text = re.sub(r'<[^>]+>', ' ', text_html or '')
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()[:limit]


def check_source(base_url, get_json=None):
    """Raise RuntimeError, in plain words, when a shop's prices cannot be read automatically."""
    getter = get_json or _get_json
    base = base_url.rstrip('/')
    if get_json is None and not _allowed_by_robots(base, '/wp-json/wc/store/v1/products'):
        raise RuntimeError("This shop's robots.txt does not allow reading its product list, so it was not added.")
    try:
        items = getter(base + '/wp-json/wc/store/v1/products?per_page=1&page=1')
    except Exception:
        items = None
    if not isinstance(items, list):
        raise RuntimeError("This website has no public product list (it is not a WooCommerce shop), so its prices cannot "
                           "be read automatically. Add its prices by hand under Compare sellers instead.")
    currency = ((items[0].get('prices') or {}).get('currency_code') or 'USD').upper() if items else 'USD'
    if currency != 'USD':
        raise RuntimeError(f'This shop shows its prices in {currency}. The shop only reads US dollar prices.')


def fetch_products(source, get_json=_get_json, pause=PAGE_PAUSE):
    """Products of one WooCommerce shop as dicts, using its public Store API."""
    base = source.base_url.rstrip('/')
    api = base + '/wp-json/wc/store/v1'
    if get_json is _get_json and not _allowed_by_robots(base, '/wp-json/wc/store/v1/products'):
        raise RuntimeError("The shop's robots.txt does not allow reading its product list.")
    category_ids = []
    wanted = [s.strip().lower() for s in (source.categories or '').split(',') if s.strip()]
    if wanted:
        cats = get_json(api + '/products/categories?per_page=100')
        category_ids = [str(c['id']) for c in cats if c.get('slug', '').lower() in wanted
                        or html.unescape(c.get('name', '')).lower() in wanted]
        if not category_ids:
            raise RuntimeError(f'None of the categories "{source.categories}" exist on this shop.')
    out = []
    for page in range(1, MAX_PAGES + 1):
        query = {'per_page': 100, 'page': page}
        if category_ids:
            query['category'] = ','.join(category_ids)
        items = get_json(api + '/products?' + urllib.parse.urlencode(query))
        if not items:
            break
        for p in items:
            prices = p.get('prices') or {}
            if (prices.get('currency_code') or 'USD').upper() != 'USD' or not prices.get('price'):
                continue
            minor = int(prices.get('currency_minor_unit') or 0)
            cat_names = [html.unescape(c.get('name', '')) for c in p.get('categories') or []]
            name = html.unescape(p.get('name') or '').strip()
            trade = classify(name, cat_names)
            if not name or trade is None:
                continue
            images = p.get('images') or []
            out.append({
                'external_id': str(p.get('id')), 'name': name[:250], 'trade': trade,
                'source_url': (p.get('permalink') or '')[:500],
                'description': _plain(p.get('short_description') or p.get('description')),
                'image_url': (images[0].get('src') if images else None),
                'source_price': int(prices['price']) / (10 ** minor),
                'in_stock': bool(p.get('is_in_stock', True)),
            })
        if len(items) < 100:
            break
        if pause:
            time.sleep(pause)
    return out


def sync_source(source, get_json=_get_json, pause=PAGE_PAUSE):
    """Update the stored products of one source. New items wait for the operator's approval."""
    try:
        items = fetch_products(source, get_json=get_json, pause=pause)
    except Exception as exc:  # network errors, blocks (403), bad JSON
        source.last_error = str(exc)[:500]
        source.last_sync = datetime.utcnow()
        db_session.commit()
        log.warning('Shop sync of %s failed: %s', source.base_url, exc)
        return 0
    now = datetime.utcnow()
    existing = {p.external_id: p for p in db_session.query(ShopProduct).filter_by(source_id=source.id)}
    for item in items:
        product = existing.pop(item['external_id'], None)
        if product is None:
            product = ShopProduct(source_id=source.id, status='pending', created=now, trade=item['trade'])
            db_session.add(product)
        for key in ('external_id', 'name', 'source_url', 'description', 'image_url', 'source_price', 'in_stock'):
            setattr(product, key, item[key])
        product.source_name = source.name
        product.last_seen = now
    for gone in existing.values():          # no longer on the shop: keep it, but it cannot be ordered
        gone.in_stock = False
    source.last_sync, source.last_error, source.item_count = now, None, len(items)
    db_session.commit()
    log.info('Shop sync of %s: %d products', source.base_url, len(items))
    return len(items)


_sync_lock = threading.Lock()


def sync_all(source_id=None):
    """Sync every active source (or one). Runs in a background thread; one sync at a time per worker."""
    if not _sync_lock.acquire(blocking=False):
        return
    try:
        q = db_session.query(ShopSource).filter_by(active=True)
        if source_id:
            q = q.filter(ShopSource.id == source_id)
        for source in q.all():
            sync_source(source)
    except Exception:
        db_session.rollback()
        log.exception('Shop sync failed')
    finally:
        db_session.remove()
        _sync_lock.release()


def _start_sync(source_id=None):
    threading.Thread(target=sync_all, args=(source_id,), daemon=True, name='shop-sync').start()


def _maybe_daily_sync():
    """Started by public shop visits: at most one automatic sync per day (SHOP_AUTO_SYNC=0 turns it off)."""
    if os.environ.get('SHOP_AUTO_SYNC', '1') == '0':
        return
    conf = settings()
    try:
        last = datetime.fromisoformat(conf['last_auto_sync']) if conf['last_auto_sync'] else None
    except ValueError:
        last = None
    if last and datetime.utcnow() - last < SYNC_EVERY:
        return
    _set('last_auto_sync', datetime.utcnow().isoformat(timespec='seconds'))
    db_session.commit()
    _start_sync()


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

def _public(p, conf):
    return {'id': p.id, 'name': p.name, 'trade': p.trade, 'description': p.description or '',
            'image_url': p.image_url, 'price': selling_price(p, conf), 'supplier_company': p.supplier_company or '',
            'install_fee': install_fee_for(p, conf)}


@shop_bp.get('/info')
def info():
    conf = settings()
    counts = dict.fromkeys(TRADES, 0)
    for (trade,) in db_session.query(ShopProduct.trade).filter_by(status='listed', in_stock=True):
        counts[trade] = counts.get(trade, 0) + 1
    return jsonify(whatsapp_number=conf['whatsapp_number'], counts=counts, business='ecommerce',
                   min_deposit_percent=int(_num(conf['min_deposit_percent'], 70)),
                   install_fee_default=_num(conf['install_fee_default']))


@shop_bp.get('/products/<int:pid>/image')
def product_image(pid):
    p = db_session.get(ShopProduct, pid)
    blob = p.image if p is not None else None
    if not blob:
        raise ApiError('No photo.', 404)
    resp = Response(blob, mimetype=_logo_mime(blob) or 'image/jpeg')
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@shop_bp.get('/products')
def products():
    try:
        _maybe_daily_sync()
    except Exception:
        db_session.rollback()
        log.exception('Could not start the daily shop sync')
    conf = settings()
    q = db_session.query(ShopProduct).filter_by(status='listed', in_stock=True)
    trade = request.args.get('trade', '')
    if trade in TRADES:
        q = q.filter(ShopProduct.trade == trade)
    term = (request.args.get('q') or '').strip()[:80]
    if term:
        q = q.filter(ShopProduct.name.ilike(f'%{term}%'))
    try:
        limit = max(1, min(int(request.args.get('limit', 60)), 200))
    except ValueError:
        limit = 60
    rows = q.order_by(ShopProduct.trade, ShopProduct.name).limit(limit).all()
    return jsonify(products=[_public(p, conf) for p in rows])


def _clean(data, key, limit, label, required=False):
    value = data.get(key)
    value = value.strip()[:limit] if isinstance(value, str) else ''
    if required and not value:
        raise ApiError(f'{label} is required.')
    return value


def _receipt(order, conf):
    """What the customer is shown after ordering: the amounts and how to pay."""
    return {'ref': order.ref, 'total': order.total, 'goods_total': round(order.total - (order.installation_fee or 0), 2),
            'installer': bool(order.installer), 'installation_fee': order.installation_fee or 0,
            'payment_option': order.payment_option, 'deposit_percent': order.deposit_percent or 0,
            'deposit_due': order.deposit_due or 0, 'balance_on_delivery': round(order.total - (order.deposit_due or 0), 2),
            'payment_method': order.payment_method, 'payment_instructions': conf['payment_instructions'],
            'whatsapp_number': conf['whatsapp_number']}


@shop_bp.post('/orders')
def place_order():
    data = request.get_json(silent=True) or {}
    if data.get('website'):                      # hidden honeypot field: bots fill it, people never see it
        raise ApiError('Could not place the order.')
    if _limited(f'shop-order:{_client_ip()}', 5, 600):
        raise ApiError('Too many orders from this connection. Please try again in a few minutes.', 429)
    name = _clean(data, 'name', 100, 'Your name', required=True)
    phone = _clean(data, 'phone', 40, 'Phone number', required=True)
    if len(re.sub(r'\D', '', phone)) < 7:
        raise ApiError('Please enter a valid phone number.')
    lines = data.get('items') if isinstance(data.get('items'), list) else []
    if not lines:
        raise ApiError('Your order is empty.')
    if len(lines) > 30:
        raise ApiError('Too many different items in one order.')
    conf = settings()

    # How the customer pays: on delivery, or online now. Online means at least the minimum deposit, up to everything.
    option = data.get('payment_option') or 'COD'          # an older page that does not ask means pay on delivery
    if option not in PAY_OPTIONS:
        raise ApiError('Choose how you would like to pay: cash on delivery, or pay online now.')
    percent, method = 0, None
    if option == 'ONLINE':
        floor = int(min(100, max(1, _num(conf['min_deposit_percent'], 70))))
        try:
            percent = int(data.get('deposit_percent', 100))
        except (TypeError, ValueError):
            raise ApiError('Choose how much you would like to pay now.')
        if not floor <= percent <= 100:
            raise ApiError(f'To pay online, pay at least {floor}% now, or all of it.')
        method = data.get('payment_method')
        if method not in ONLINE_METHODS:
            raise ApiError('Choose EcoCash or bank transfer.')

    order = ShopOrder(customer_name=name, phone=phone, email=_clean(data, 'email', 120, 'Email'),
                      town=_clean(data, 'town', 80, 'Town', required=True),
                      address=_clean(data, 'address', 300, 'Address'), notes=_clean(data, 'notes', 1000, 'Notes'),
                      payment_option=option, deposit_percent=percent, payment_method=method,
                      installer=bool(data.get('installer')))
    goods, install = 0.0, 0.0
    for line in lines:
        try:
            pid, qty = int(line.get('id')), int(line.get('quantity', 1))
        except (TypeError, ValueError, AttributeError):
            raise ApiError('Your order has an item that is not valid.')
        qty = max(1, min(qty, 50))
        product = db_session.get(ShopProduct, pid)
        if product is None or product.status != 'listed' or not product.in_stock:
            raise ApiError('One of the items is no longer available. Please refresh the page.')
        price = selling_price(product, conf)
        goods += price * qty
        install += install_fee_for(product, conf)          # one installer visit per kind of item, however many
        _, _, buy_from = offers_view(product, conf)       # who we would buy it from, and at what cost
        order.items.append(ShopOrderItem(
            product_id=product.id, name=product.name, unit_price=price, quantity=qty,
            source_name=(buy_from['supplier'] if buy_from else product.source_name),
            source_url=(buy_from['url'] if buy_from else product.source_url),
            source_price=(buy_from['price'] if buy_from else product.source_price), supplier_company=product.supplier_company))
    order.installation_fee = round(install, 2) if order.installer else 0.0
    order.total = round(goods + order.installation_fee, 2)
    order.deposit_due = round(order.total * percent / 100, 2) if option == 'ONLINE' else 0.0
    db_session.add(order)
    db_session.flush()
    order.ref = f'SO{order.id:05d}'
    db_session.commit()
    log.info('New shop order %s for $%.2f (%s)', order.ref, order.total, option)
    return jsonify(_receipt(order, conf)), 201


@shop_bp.post('/orders/<ref>/payment')
def order_payment(ref):
    """The customer sends the EcoCash / bank reference of the money they paid. Needs the order number and phone."""
    data = request.get_json(silent=True) or {}
    if _limited(f'shop-pay:{_client_ip()}', 10, 600):
        raise ApiError('Too many tries. Please wait a few minutes.', 429)
    digits = re.sub(r'\D', '', _clean(data, 'phone', 40, 'Phone number', required=True))
    order = db_session.query(ShopOrder).filter_by(ref=str(ref).upper()[:20]).first()
    if order is None or len(digits) < 7 or digits[-7:] != re.sub(r'\D', '', order.phone or '')[-7:]:
        raise ApiError('We could not find that order. Check the order number and the phone number you used.', 404)
    if order.payment_option != 'ONLINE':
        raise ApiError('This order is cash on delivery, so there is no payment to confirm yet.')
    order.payment_reference = _clean(data, 'reference', 100, 'Payment reference', required=True)
    order.updated = datetime.utcnow()
    db_session.commit()
    return jsonify(ok=True)


PUBLIC_ENDPOINTS.update({'shop.info', 'shop.products', 'shop.product_image', 'shop.place_order', 'shop.order_payment'})


# ---------------------------------------------------------------------------
# Operator endpoints
# ---------------------------------------------------------------------------

def _operator():
    if not is_operator(g.get('user')):
        raise ApiError('Only the platform operator can manage the shop.', 403)


def _admin_product(p, conf):
    rows, cheapest, preferred = offers_view(p, conf)
    pick = lambda r: ({k: r[k] for k in ('supplier', 'price', 'profit', 'margin', 'recommended')} if r else None)  # noqa: E731
    return {**_public(p, conf), 'status': p.status, 'in_stock': bool(p.in_stock), 'source_id': p.source_id,
            'offers': rows, 'cheapest': pick(cheapest), 'preferred': pick(preferred),
            'source_name': p.source_name, 'source_url': p.source_url, 'source_price': p.source_price,
            'price_override': p.price_override, 'install_fee_own': p.install_fee, 'last_seen': p.last_seen.isoformat() if p.last_seen else None}


def _source(s):
    return {'id': s.id, 'name': s.name, 'base_url': s.base_url, 'categories': s.categories or '',
            'active': bool(s.active), 'item_count': s.item_count or 0, 'last_error': s.last_error,
            'last_sync': s.last_sync.isoformat() if s.last_sync else None}


def _order(o):
    paid = o.paid_amount or 0
    return {'id': o.id, 'ref': o.ref, 'customer_name': o.customer_name, 'phone': o.phone, 'email': o.email,
            'town': o.town, 'address': o.address, 'notes': o.notes, 'status': o.status, 'admin_note': o.admin_note,
            'total': o.total, 'created': o.created.isoformat() if o.created else None,
            'payment_option': o.payment_option or 'COD', 'deposit_percent': o.deposit_percent or 0,
            'deposit_due': o.deposit_due or 0, 'paid_amount': paid, 'balance_due': round(max(0.0, (o.total or 0) - paid), 2),
            'payment_method': o.payment_method, 'payment_reference': o.payment_reference,
            'installer': bool(o.installer), 'installation_fee': o.installation_fee or 0,
            'items': [{'name': i.name, 'unit_price': i.unit_price, 'quantity': i.quantity,
                       'source_name': i.source_name, 'source_url': i.source_url, 'source_price': i.source_price,
                       'supplier_company': i.supplier_company}
                      for i in o.items]}


@shop_bp.get('/admin/overview')
def admin_overview():
    _operator()
    conf = settings()
    statuses = {s: 0 for s in PRODUCT_STATUSES}
    for (status,) in db_session.query(ShopProduct.status):
        statuses[status] = statuses.get(status, 0) + 1
    new_orders = db_session.query(ShopOrder).filter_by(status='NEW').count()
    return jsonify(settings={k: conf[k] for k in ('markup_percent', 'markup_flat', 'whatsapp_number', 'min_deposit_percent',
                                   'install_fee_default', 'payment_instructions')},
                   sources=[_source(s) for s in db_session.query(ShopSource).order_by(ShopSource.id)],
                   products=statuses, new_orders=new_orders, syncing=_sync_lock.locked())


@shop_bp.put('/admin/settings')
def admin_settings():
    _operator()
    data = request.get_json(silent=True) or {}
    for key in ('markup_percent', 'markup_flat'):
        if key in data:
            value = _num(data[key], None)
            if value is None or value < 0 or value > 1000:
                raise ApiError('Markup must be a number between 0 and 1000.')
            _set(key, value)
    if 'whatsapp_number' in data:
        _set('whatsapp_number', re.sub(r'\D', '', str(data['whatsapp_number']))[:20])
    if 'min_deposit_percent' in data:
        value = _num(data['min_deposit_percent'], None)
        if value is None or not 1 <= value <= 100:
            raise ApiError('The smallest deposit must be between 1% and 100%.')
        _set('min_deposit_percent', int(value))
    if 'install_fee_default' in data:
        value = _num(data['install_fee_default'], None)
        if value is None or value < 0 or value > 100000:
            raise ApiError('The installer fee must be a number, 0 or more.')
        _set('install_fee_default', value)
    if 'payment_instructions' in data:
        _set('payment_instructions', _clean(data, 'payment_instructions', 500, 'Payment instructions'))
    db_session.commit()
    return admin_overview()


def _source_fields(source, data):
    if 'name' in data:
        source.name = _clean(data, 'name', 100, 'Shop name', required=True)
    if 'base_url' in data:
        url = _clean(data, 'base_url', 300, 'Website', required=True).rstrip('/')
        if not re.match(r'^https?://[^/\s]+\.[^/\s]+', url):
            raise ApiError('Enter the shop website as https://www.example.co.zw')
        source.base_url = url
    if 'categories' in data:
        source.categories = _clean(data, 'categories', 300, 'Categories')
    if 'active' in data:
        source.active = bool(data['active'])


@shop_bp.post('/admin/sources')
def add_source():
    _operator()
    source = ShopSource(active=True)
    _source_fields(source, {'name': '', 'base_url': '', **(request.get_json(silent=True) or {})})
    try:
        check_source(source.base_url)             # say now, in plain words, if this shop cannot be read
    except RuntimeError as exc:
        raise ApiError(str(exc))
    db_session.add(source)
    db_session.commit()
    return jsonify(_source(source)), 201


@shop_bp.patch('/admin/sources/<int:sid>')
def edit_source(sid):
    _operator()
    source = db_session.get(ShopSource, sid) or _not_found()
    _source_fields(source, request.get_json(silent=True) or {})
    db_session.commit()
    return jsonify(_source(source))


@shop_bp.delete('/admin/sources/<int:sid>')
def delete_source(sid):
    _operator()
    source = db_session.get(ShopSource, sid) or _not_found()
    db_session.query(ShopProduct).filter_by(source_id=sid).filter(ShopProduct.status != 'listed').delete()
    db_session.query(ShopProduct).filter_by(source_id=sid).update({'source_id': None, 'in_stock': False})
    db_session.delete(source)
    db_session.commit()
    return jsonify(ok=True)


@shop_bp.post('/admin/sync')
def admin_sync():
    _operator()
    if _sync_lock.locked():
        return jsonify(started=False, message='A sync is already running.'), 202
    data = request.get_json(silent=True) or {}
    _start_sync(data.get('source_id'))
    return jsonify(started=True), 202


def _not_found():
    raise ApiError('Not found.', 404)


@shop_bp.get('/admin/products')
def admin_products():
    _operator()
    conf = settings()
    q = db_session.query(ShopProduct).options(selectinload(ShopProduct.offers))
    if request.args.get('status') in PRODUCT_STATUSES:
        q = q.filter(ShopProduct.status == request.args['status'])
    if request.args.get('trade') in TRADES:
        q = q.filter(ShopProduct.trade == request.args['trade'])
    term = (request.args.get('q') or '').strip()[:80]
    if term:
        q = q.filter(or_(ShopProduct.name.ilike(f'%{term}%'), ShopProduct.source_name.ilike(f'%{term}%')))
    rows = q.order_by(ShopProduct.in_stock.desc(), ShopProduct.trade, ShopProduct.name).limit(500).all()
    return jsonify(products=[_admin_product(p, conf) for p in rows])


def _product_fields(p, data):
    if 'status' in data:
        if data['status'] not in PRODUCT_STATUSES:
            raise ApiError('Unknown status.')
        p.status = data['status']
    if 'trade' in data:
        if data['trade'] not in TRADES:
            raise ApiError('Unknown category.')
        p.trade = data['trade']
    if 'price_override' in data:
        value = data['price_override']
        p.price_override = None if value in (None, '') else _num(value, None)
        if p.price_override is not None and p.price_override <= 0:
            raise ApiError('The selling price must be more than 0.')
    if 'install_fee' in data:
        value = data['install_fee']
        p.install_fee = None if value in (None, '') else _num(value, None)
        if p.install_fee is not None and p.install_fee < 0:
            raise ApiError('The installer fee cannot be negative.')
    for key, limit in (('name', 250), ('description', 2000), ('image_url', 500), ('source_name', 100),
                       ('source_url', 500), ('supplier_company', 100)):
        if key in data:
            setattr(p, key, _clean(data, key, limit, key.replace('_', ' ').capitalize(), required=(key == 'name')))
    if 'source_price' in data:
        p.source_price = max(0.0, _num(data['source_price']))
    if 'in_stock' in data:
        p.in_stock = bool(data['in_stock'])


@shop_bp.post('/admin/products')
def add_product():
    """An item typed in by hand, e.g. from a shop without a website (Mahommed Mussa) or our own stock."""
    _operator()
    data = request.get_json(silent=True) or {}
    p = ShopProduct(source_id=None, external_id=None, status='listed', in_stock=True, trade='solar')
    _product_fields(p, {'name': '', **data})
    if not p.source_price and not p.price_override:
        raise ApiError("Enter the shop's price or your own selling price.")
    db_session.add(p)
    db_session.commit()
    return jsonify(_admin_product(p, settings())), 201


@shop_bp.patch('/admin/products/<int:pid>')
def edit_product(pid):
    _operator()
    p = db_session.get(ShopProduct, pid) or _not_found()
    data = request.get_json(silent=True) or {}
    if p.source_id:      # synced fields would be overwritten by the next sync
        data = {k: v for k, v in data.items() if k in ('status', 'trade', 'price_override', 'name', 'description',
                                                       'supplier_company', 'install_fee')}
    _product_fields(p, data)
    db_session.commit()
    return jsonify(_admin_product(p, settings()))


def _offer_fields(offer, data):
    if 'supplier' in data:
        offer.supplier = _clean(data, 'supplier', 100, 'Seller', required=True)
    if 'price' in data:
        price = _num(data['price'], None)
        if price is None or price <= 0 or price > 10_000_000:
            raise ApiError('Enter the price this seller charges, more than 0.')
        offer.price = round(price, 2)
    if 'url' in data:
        offer.url = _clean(data, 'url', 500, 'Link')
    if 'note' in data:
        offer.note = _clean(data, 'note', 200, 'Note')
    if 'recommended' in data:
        offer.recommended = bool(data['recommended'])
    offer.updated = datetime.utcnow()


@shop_bp.post('/admin/products/<int:pid>/offers')
def add_offer(pid):
    """Another seller of this product and their price, e.g. a person selling a 3kVA inverter at $280."""
    _operator()
    p = db_session.get(ShopProduct, pid) or _not_found()
    data = request.get_json(silent=True) or {}
    if not data.get('supplier') or data.get('price') in (None, ''):
        raise ApiError('Enter the seller and their price.')
    offer = ShopOffer(product_id=p.id)
    _offer_fields(offer, data)
    db_session.add(offer)
    db_session.commit()
    db_session.refresh(p)
    return jsonify(_admin_product(p, settings())), 201


@shop_bp.patch('/admin/offers/<int:oid>')
def edit_offer(oid):
    _operator()
    offer = db_session.get(ShopOffer, oid) or _not_found()
    _offer_fields(offer, request.get_json(silent=True) or {})
    db_session.commit()
    p = db_session.get(ShopProduct, offer.product_id)
    db_session.refresh(p)
    return jsonify(_admin_product(p, settings()))


@shop_bp.delete('/admin/offers/<int:oid>')
def delete_offer(oid):
    _operator()
    offer = db_session.get(ShopOffer, oid) or _not_found()
    pid = offer.product_id
    db_session.delete(offer)
    db_session.commit()
    p = db_session.get(ShopProduct, pid)
    db_session.refresh(p)
    return jsonify(_admin_product(p, settings()))


@shop_bp.put('/admin/products/<int:pid>/image')
def set_product_image(pid):
    """Body: {"image": "<base64 or data: URL of a PNG/JPEG>"}: the operator's own photo of an item added by hand."""
    _operator()
    p = db_session.get(ShopProduct, pid) or _not_found()
    if p.source_id:
        raise ApiError("Photos of items read from another shop come from that shop. Add the item by hand to use your own photo.")
    raw = (request.get_json(silent=True) or {}).get('image') or ''
    if raw.startswith('data:') and ',' in raw:
        raw = raw.split(',', 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError):
        raise ApiError('That is not a valid image.')
    if not _logo_mime(blob):
        raise ApiError('Please use a PNG or JPEG photo.')
    if len(blob) > MAX_IMAGE_BYTES:
        raise ApiError('The photo is too big (1 MB at most).')
    p.image = blob
    p.image_url = f'/api/shop/products/{p.id}/image?v={len(blob)}'
    db_session.commit()
    return jsonify(_admin_product(p, settings()))


@shop_bp.delete('/admin/products/<int:pid>/image')
def remove_product_image(pid):
    _operator()
    p = db_session.get(ShopProduct, pid) or _not_found()
    p.image = None
    if (p.image_url or '').startswith('/api/shop/products/'):
        p.image_url = None
    db_session.commit()
    return jsonify(_admin_product(p, settings()))


@shop_bp.post('/admin/products/bulk')
def bulk_products():
    _operator()
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    if status not in PRODUCT_STATUSES:
        raise ApiError('Unknown status.')
    ids = [i for i in data.get('ids') or [] if isinstance(i, int)][:1000]
    if ids:
        db_session.query(ShopProduct).filter(ShopProduct.id.in_(ids)).update({'status': status},
                                                                             synchronize_session=False)
        db_session.commit()
    return jsonify(updated=len(ids))


@shop_bp.delete('/admin/products/<int:pid>')
def delete_product(pid):
    _operator()
    p = db_session.get(ShopProduct, pid) or _not_found()
    if p.source_id:
        raise ApiError('Items read from a shop come back on the next sync. Hide it instead.')
    db_session.delete(p)
    db_session.commit()
    return jsonify(ok=True)


@shop_bp.get('/admin/orders')
def admin_orders():
    _operator()
    q = db_session.query(ShopOrder)
    if request.args.get('status') in ORDER_STATUSES:
        q = q.filter(ShopOrder.status == request.args['status'])
    rows = q.order_by(ShopOrder.created.desc()).limit(300).all()
    return jsonify(orders=[_order(o) for o in rows])


@shop_bp.patch('/admin/orders/<int:oid>')
def edit_order(oid):
    _operator()
    o = db_session.get(ShopOrder, oid) or _not_found()
    data = request.get_json(silent=True) or {}
    if 'status' in data:
        if data['status'] not in ORDER_STATUSES:
            raise ApiError('Unknown order status.')
        o.status = data['status']
    if 'paid_amount' in data:
        amount = _num(data['paid_amount'], None)
        if amount is None or amount < 0 or amount > (o.total or 0) + 0.005:
            raise ApiError('The amount received must be between $0 and the order total.')
        o.paid_amount = round(amount, 2)
        if o.paid_amount > 0 and o.status in ('NEW', 'CONTACTED'):
            o.status = 'PAID'
    if 'admin_note' in data:
        o.admin_note = _clean(data, 'admin_note', 1000, 'Note')
    o.updated = datetime.utcnow()
    db_session.commit()
    return jsonify(_order(o))


protect(shop_bp)
