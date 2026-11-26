"""JSON REST API consumed by the React frontend."""
import enum
import random
import string
from datetime import date, datetime, timedelta

import sqlalchemy as sa
from flask import Blueprint, g, jsonify, request, send_file
from sqlalchemy.orm import selectinload

from . import pdfs, statements
from .auth import ApiError, find, protect, unscoped
from .database import db_session, engine
from .models import (Activity, ActivityStatusEnum, ActivityType, Currency, Customer, FinancialCategory,
                    FinancialRecord, FinancialType, FuelRecord, FuelType, Inventory, Invoice, InvoiceItem,
                    InvoiceStatus, JourneyRecord, Location, LocationCategory, MileageRecord, Payment,
                    PaymentType, Pricing, StockChangeReason, StockTransaction, Supplier, TransactionType,
                    quotation, quotationItem)

bp = Blueprint('api', __name__, url_prefix='/api')

DEFAULT_CATEGORIES = ['Solar Panel', 'Battery', 'Inverter', 'CCTV', 'Geyser', 'Alarm System',
                      'Borehole Equipment', 'Electrical Appliances']
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


# ---------------------------------------------------------------------------
# Errors & helpers
# ---------------------------------------------------------------------------

def payload():
    return request.get_json(silent=True) or {}


def get_or_404(model, pk, label=None):
    obj = find(model, pk)
    if obj is None:
        raise ApiError(f'{label or model.__name__} not found', 404)
    return obj


def to_json(value):
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def row(obj, **extra):
    data = {c.key: to_json(getattr(obj, c.key)) for c in obj.__table__.columns}
    data.update(extra)
    return data


def parse_date(value):
    if value in (None, ''):
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace('Z', ''))
    except ValueError:
        raise ApiError(f'Invalid date: {value}')


def parse_number(value, cast=float, field='value'):
    if value in (None, ''):
        return None
    try:
        return cast(value)
    except (TypeError, ValueError):
        raise ApiError(f'Invalid number for {field}: {value}')


def parse_enum(enum_cls, value, field='value'):
    if value in (None, ''):
        return None
    if isinstance(value, enum_cls):
        return value
    for member in enum_cls:
        if str(value).upper() in (member.value.upper(), member.name):
            return member
    raise ApiError(f'Invalid {field}: {value}')


def parse_field(kind, value, field):
    if kind == 'str':
        value = value.strip() if isinstance(value, str) else value
        return value or None
    if kind == 'int':
        return parse_number(value, int, field)
    if kind == 'float':
        return parse_number(value, float, field)
    if kind == 'date':
        return parse_date(value)
    if kind == 'bool':
        return bool(value)
    if isinstance(kind, type) and issubclass(kind, enum.Enum):
        return parse_enum(kind, value, field)
    raise ValueError(kind)


def apply_fields(obj, data, spec, required=()):
    for name in required:
        if data.get(name) in (None, '') and getattr(obj, name, None) in (None, ''):
            raise ApiError(f"{name.replace('_', ' ').capitalize()} is required")
    for name, kind in spec.items():
        if name in data:
            value = parse_field(kind, data[name], name)
            # A link to another record must point at a record of the same company.
            if value is not None and name in LINKED_MODELS and find(LINKED_MODELS[name], value) is None:
                raise ApiError(f"{name[:-3].replace('_', ' ').capitalize()} not found")
            setattr(obj, name, value)


LINKED_MODELS = {'supplier_id': Supplier, 'customer_id': Customer, 'activity_type_id': ActivityType,
                 'activity_id': Activity, 'journey_id': JourneyRecord, 'inventory_id': Inventory}


def month_range(year, month):
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start, end


def customer_label(c):
    return pdfs.customer_name(c) if c else None


def customer_brief(c):
    if not c:
        return None
    return {'id': c.identification_number, 'name': customer_label(c), 'phone': c.phone}


def pdf_response(buffer, filename):
    return send_file(buffer, as_attachment=True, download_name=filename, mimetype='application/pdf')


# ---------------------------------------------------------------------------
# Generic CRUD for simple resources
# ---------------------------------------------------------------------------

def register_crud(path, model, spec, required=(), order_by=None, serialize=row,
                  before_delete=None, after_save=None):
    label = path.replace('-', ' ').rstrip('s').capitalize()

    def list_view():
        q = db_session.query(model)
        if order_by is not None:
            q = q.order_by(order_by)
        return jsonify([serialize(o) for o in q.all()])

    def get_view(pk):
        return jsonify(serialize(get_or_404(model, pk, label)))

    def create_view():
        data = payload()
        obj = model()
        apply_fields(obj, data, spec, required)
        db_session.add(obj)
        if after_save:
            after_save(obj, data, True)
        db_session.commit()
        return jsonify(serialize(obj)), 201

    def update_view(pk):
        obj = get_or_404(model, pk, label)
        data = payload()
        apply_fields(obj, data, spec, required)
        if after_save:
            after_save(obj, data, False)
        db_session.commit()
        return jsonify(serialize(obj))

    def delete_view(pk):
        obj = get_or_404(model, pk, label)
        if before_delete:
            before_delete(obj)
        db_session.delete(obj)
        db_session.commit()
        return jsonify(ok=True)

    ep = path.replace('-', '_')
    bp.add_url_rule(f'/{path}', f'{ep}_list', list_view, methods=['GET'])
    bp.add_url_rule(f'/{path}', f'{ep}_create', create_view, methods=['POST'])
    bp.add_url_rule(f'/{path}/<int:pk>', f'{ep}_get', get_view, methods=['GET'])
    bp.add_url_rule(f'/{path}/<int:pk>', f'{ep}_update', update_view, methods=['PUT'])
    bp.add_url_rule(f'/{path}/<int:pk>', f'{ep}_delete', delete_view, methods=['DELETE'])


# Suppliers
register_crud('suppliers', Supplier, {
    'name': 'str', 'contact_person': 'str', 'phone': 'str', 'email': 'str', 'address': 'str',
    'payment_terms': 'str', 'currency': Currency, 'notes': 'str',
}, required=('name',), order_by=Supplier.name,
    before_delete=lambda s: db_session.query(Inventory).filter_by(supplier_id=s.id)
    .update({Inventory.supplier_id: None}))

# Locations
register_crud('locations', Location, {
    'name': 'str', 'address': 'str', 'latitude': 'float', 'longitude': 'float',
    'category': LocationCategory, 'notes': 'str',
}, required=('name',), order_by=Location.name)

# Pricing
register_crud('pricing', Pricing, {
    'item_type': 'str', 'item_name': 'str', 'price': 'float', 'currency': Currency, 'unit': 'str',
    'effective_date': 'date', 'expiry_date': 'date', 'notes': 'str',
}, required=('item_type', 'item_name', 'price'), order_by=Pricing.item_name)


# Activity types
def _activity_type_delete(t):
    db_session.query(Activity).filter_by(activity_type_id=t.id).update({Activity.activity_type_id: None})
    db_session.query(Invoice).filter_by(activity_type_id=t.id).update({Invoice.activity_type_id: None})


register_crud('activity-types', ActivityType, {
    'name': 'str', 'description': 'str', 'is_active': 'bool',
}, required=('name',), order_by=ActivityType.name, before_delete=_activity_type_delete)

# Financial categories
register_crud('financial-categories', FinancialCategory, {
    'name': 'str', 'type': FinancialType, 'description': 'str', 'is_active': 'bool',
}, required=('name', 'type'), order_by=FinancialCategory.name)

# Financial records
register_crud('financial-records', FinancialRecord, {
    'type': FinancialType, 'category': 'str', 'description': 'str', 'amount': 'float', 'date': 'date',
    'receipt_number': 'str', 'vendor_supplier': 'str', 'notes': 'str',
}, required=('type', 'amount'), order_by=FinancialRecord.date.desc())


# Activities
def _serialize_activity(a):
    return row(a, customer_name=customer_label(a.customer),
               activity_type_name=a.activity_type.name if a.activity_type else None)


def _activity_save(a, data, created):
    if a.customer_id and not find(Customer, a.customer_id):
        raise ApiError('Customer not found')
    if a.date is None:
        a.date = datetime.now()
    if a.currency is None:
        a.currency = Currency.USD


register_crud('activities', Activity, {
    'customer_id': 'str', 'activity_type_id': 'int', 'description': 'str', 'status': ActivityStatusEnum,
    'date': 'date', 'completed_date': 'date', 'technician': 'str', 'total_cost': 'float',
    'currency': Currency, 'notes': 'str',
}, required=('customer_id', 'activity_type_id'), order_by=Activity.date.desc(),
    serialize=_serialize_activity, after_save=_activity_save,
    before_delete=lambda a: db_session.query(JourneyRecord).filter_by(activity_id=a.id)
    .update({JourneyRecord.activity_id: None}))


# Fuel records — each new record also books a Fuel expense
def _fuel_save(f, data, created):
    f.total_cost = round((f.quantity_liters or 0) * (f.price_per_liter or 0), 2)
    if f.date is None:
        f.date = datetime.now()
    if created:
        db_session.add(FinancialRecord(
            type=FinancialType.EXPENSE, category='Fuel',
            description=f'Fuel for vehicle {f.vehicle_id} at {f.fuel_station or "unknown station"}',
            amount=f.total_cost, date=f.date, notes=f.notes))


register_crud('fuel-records', FuelRecord, {
    'vehicle_id': 'str', 'fuel_type': FuelType, 'quantity_liters': 'float', 'price_per_liter': 'float',
    'fuel_station': 'str', 'date': 'date', 'notes': 'str', 'journey_id': 'int',
}, required=('vehicle_id', 'quantity_liters', 'price_per_liter'), order_by=FuelRecord.date.desc(),
    after_save=_fuel_save)


# Mileage records
def _mileage_save(m, data, created):
    if m.distance_km is None and m.start_odometer is not None and m.end_odometer is not None:
        m.distance_km = m.end_odometer - m.start_odometer
    if m.date is None:
        m.date = datetime.now()


register_crud('mileage-records', MileageRecord, {
    'vehicle_id': 'str', 'start_location': 'str', 'end_location': 'str', 'distance_km': 'float',
    'start_odometer': 'float', 'end_odometer': 'float', 'date': 'date', 'notes': 'str', 'journey_id': 'int',
}, required=('vehicle_id',), order_by=MileageRecord.date.desc(), after_save=_mileage_save)


# Journeys
def _journey_delete(j):
    db_session.query(FuelRecord).filter_by(journey_id=j.id).update({FuelRecord.journey_id: None})
    db_session.query(MileageRecord).filter_by(journey_id=j.id).update({MileageRecord.journey_id: None})


register_crud('journeys', JourneyRecord, {
    'vehicle_id': 'str', 'driver': 'str', 'start_location': 'str', 'end_location': 'str',
    'start_time': 'date', 'end_time': 'date', 'purpose': 'str', 'status': 'str',
    'total_distance': 'float', 'notes': 'str', 'activity_id': 'int',
}, required=('vehicle_id', 'start_location', 'end_location'), order_by=JourneyRecord.start_time.desc(),
    before_delete=_journey_delete)


# ---------------------------------------------------------------------------
# Meta & dashboard
# ---------------------------------------------------------------------------

@bp.get('/meta')
def meta():
    url = str(engine.url)
    db_type = 'SQLite (Local)' if 'sqlite' in url else 'PostgreSQL' if 'postgres' in url else 'Unknown'
    enums = {name: [m.value for m in cls] for name, cls in {
        'currency': Currency, 'payment_type': PaymentType, 'stock_change_reason': StockChangeReason,
        'activity_status': ActivityStatusEnum, 'invoice_status': InvoiceStatus,
        'financial_type': FinancialType, 'fuel_type': FuelType, 'location_category': LocationCategory,
    }.items()}
    enums['journey_status'] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
    return jsonify(db_type=db_type, enums=enums)


def _top_locations(limit):
    counts = {}
    for start, end in db_session.query(JourneyRecord.start_location, JourneyRecord.end_location):
        loc = end or start
        if loc:
            counts[loc] = counts.get(loc, 0) + 1
    top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return [{'label': k, 'value': v} for k, v in top]


def _dashboard_extras():
    """Numbers for the executive dashboard and reports, all taken from stored records."""
    now = datetime.now()
    monthly = []
    for back in range(5, -1, -1):
        y, m = now.year, now.month - back
        while m < 1:
            y, m = y - 1, m + 12
        m_start, m_end = month_range(y, m)
        monthly.append({'label': MONTHS[m - 1], 'revenue': _sum(Invoice.total_amount, *_invoiced(m_start, m_end)),
                        'expenses': _sum(FinancialRecord.amount, *_records(FinancialType.EXPENSE, m_start, m_end))})
    start, end = month_range(now.year, now.month)
    category = sa.func.coalesce(Inventory.category, 'Services & labour')
    by_category = db_session.query(category, sa.func.sum(InvoiceItem.amount)) \
        .select_from(InvoiceItem).join(Invoice, InvoiceItem.invoice_id == Invoice.id) \
        .outerjoin(Inventory, InvoiceItem.inventory_id == Inventory.id) \
        .filter(*_invoiced(start, end)).group_by(category) \
        .order_by(sa.func.sum(InvoiceItem.amount).desc()).all()

    quote_rows = db_session.query(quotation.status, sa.func.count(quotation.id),
                                  sa.func.coalesce(sa.func.sum(quotation.total_amount), 0)) \
        .group_by(quotation.status).all()
    by_status = [{'label': getattr(st, 'value', st) or 'PENDING', 'count': n, 'value': v} for st, n, v in quote_rows]
    open_q = [q for q in by_status if q['label'] == 'PENDING']
    quote_total = sum(q['count'] for q in by_status)
    converted = sum(q['count'] for q in by_status if q['label'] == 'PROCESSED')

    def jobs(status):
        return db_session.query(Activity).filter(Activity.status == status).count()

    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    recent_jobs = db_session.query(Activity).order_by(Activity.date.desc(), Activity.id.desc()).limit(6).all()
    overdue = db_session.query(Invoice).filter(
        Invoice.status.notin_([InvoiceStatus.CANCELLED, InvoiceStatus.PAID]),
        Invoice.balance_due > 0, Invoice.due_date < day_start).count()
    prev_y, prev_m = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    return dict(
        monthly=monthly,
        revenue_by_category=[{'label': c, 'value': v} for c, v in by_category if v],
        month_revenue=monthly[-1]['revenue'], prev_month_revenue=monthly[-2]['revenue'],
        quotes={'open_count': sum(q['count'] for q in open_q), 'open_value': sum(q['value'] for q in open_q),
                'total': quote_total, 'converted': converted, 'by_status': by_status},
        jobs={'active': jobs(ActivityStatusEnum.IN_PROGRESS), 'scheduled': jobs(ActivityStatusEnum.SCHEDULED),
              'completed': jobs(ActivityStatusEnum.COMPLETED),
              'this_week': db_session.query(Activity).filter(
                  Activity.date >= week_start, Activity.date < week_start + timedelta(days=7)).count(),
              'today': db_session.query(Activity).filter(
                  Activity.date >= day_start, Activity.date < day_start + timedelta(days=1)).count(),
              'recent': [_serialize_activity(a) for a in recent_jobs]},
        overdue_invoices=overdue,
    )


def _unpriced_stock_in():
    """Invoice items that were bought in when sold and are still waiting for their buying price."""
    rows = db_session.query(InvoiceItem.invoice_id).join(Invoice, InvoiceItem.invoice_id == Invoice.id) \
        .filter(InvoiceItem.cost_pending.is_(True), Invoice.status != InvoiceStatus.CANCELLED) \
        .order_by(Invoice.date_created.desc()).all()
    return {'count': len(rows), 'invoices': len({r[0] for r in rows}), 'invoice_id': rows[0][0] if rows else None}


@bp.get('/dashboard')
def dashboard():
    outstanding = db_session.query(sa.func.sum(Invoice.balance_due)).filter(
        Invoice.status != InvoiceStatus.CANCELLED).scalar() or 0
    low_stock = db_session.query(Inventory).filter(
        Inventory.quantity <= sa.func.coalesce(Inventory.minimum_stock_level, 5)
    ).order_by(Inventory.quantity).limit(8).all()
    recent_invoices = db_session.query(Invoice).order_by(Invoice.date_created.desc()).limit(6).all()
    return jsonify(
        counts={
            'suppliers': db_session.query(Supplier).count(),
            'customers': db_session.query(Customer).count(),
            'inventory': db_session.query(Inventory).count(),
            'quotations': db_session.query(quotation).count(),
            'invoices': db_session.query(Invoice).count(),
            'activities': db_session.query(Activity).count(),
        },
        outstanding_balance=outstanding,
        low_stock=[{'id': i.id, 'name': i.name, 'quantity': i.quantity,
                    'minimum_stock_level': i.minimum_stock_level} for i in low_stock],
        unpriced_stock_in=_unpriced_stock_in(),
        recent_invoices=[_serialize_invoice(i) for i in recent_invoices],
        top_locations=_top_locations(10),
        **_dashboard_extras(),
    )


# ---------------------------------------------------------------------------
# Customers (string primary key + auto-generated IDs)
# ---------------------------------------------------------------------------

CUSTOMER_FIELDS = {'name': 'str', 'surname': 'str', 'citizenship': 'str', 'address': 'str',
                   'phone': 'str', 'email': 'str'}


def _serialize_customer(c):
    return row(c, id=c.identification_number, full_name=customer_label(c))


@bp.get('/customers')
def customers_list():
    items = db_session.query(Customer).order_by(Customer.name).all()
    billed = {cid: (n, total, due) for cid, n, total, due in db_session.query(
        Invoice.customer_id, sa.func.count(Invoice.id), sa.func.coalesce(sa.func.sum(Invoice.total_amount), 0),
        sa.func.coalesce(sa.func.sum(Invoice.balance_due), 0))
        .filter(Invoice.status != InvoiceStatus.CANCELLED).group_by(Invoice.customer_id)}
    jobs = dict(db_session.query(Activity.customer_id, sa.func.count(Activity.id)).group_by(Activity.customer_id))
    out = []
    for c in items:
        n, total, due = billed.get(c.identification_number, (0, 0, 0))
        out.append(_serialize_customer(c) | {'invoice_count': n, 'total_billed': total, 'balance_due': due,
                                             'job_count': jobs.get(c.identification_number, 0)})
    return jsonify(out)


@bp.get('/customers/<string:pk>')
def customers_get(pk):
    return jsonify(_serialize_customer(get_or_404(Customer, pk, 'Customer')))


@bp.post('/customers')
def customers_create():
    data = payload()
    id_num = (data.get('identification_number') or '').strip()
    # Customer IDs are unique across the whole platform (they are the table's primary key).
    if not id_num:
        numeric = [int(x) for (x,) in db_session.query(Customer.identification_number)
                   if x and x.isdigit() and len(x) <= 9]
        n = (max(numeric) if numeric else 0) + 1
        with unscoped():
            while db_session.get(Customer, f'{n:05d}'):
                n += 1
        id_num = f'{n:05d}'
    else:
        with unscoped():
            taken = db_session.get(Customer, id_num) is not None
        if taken:
            raise ApiError(f'Customer ID {id_num} is already in use. Please choose a different ID.')
    customer = Customer(identification_number=id_num)
    apply_fields(customer, data, CUSTOMER_FIELDS, required=('name',))
    db_session.add(customer)
    db_session.commit()
    return jsonify(_serialize_customer(customer)), 201


@bp.put('/customers/<string:pk>')
def customers_update(pk):
    customer = get_or_404(Customer, pk, 'Customer')
    apply_fields(customer, payload(), CUSTOMER_FIELDS, required=('name',))
    db_session.commit()
    return jsonify(_serialize_customer(customer))


@bp.delete('/customers/<string:pk>')
def customers_delete(pk):
    customer = get_or_404(Customer, pk, 'Customer')
    for model in (Activity, quotation, Invoice):
        db_session.query(model).filter_by(customer_id=pk).update({model.customer_id: None})
    db_session.delete(customer)
    db_session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Inventory & stock movements
# ---------------------------------------------------------------------------

INVENTORY_FIELDS = {'name': 'str', 'brand': 'str', 'category': 'str', 'specifications': 'str',
                    'quantity': 'int', 'unit_price': 'float', 'cost_price': 'float', 'supplier_id': 'int',
                    'minimum_stock_level': 'int', 'notes': 'str'}


def _serialize_inventory(i):
    return row(i, supplier_name=i.supplier.name if i.supplier else None)


@bp.get('/inventory')
def inventory_list():
    q = db_session.query(Inventory)
    search = request.args.get('search', '').strip()
    category = request.args.get('category', '').strip()
    if search:
        like = f'%{search}%'
        q = q.filter(sa.or_(Inventory.name.ilike(like), Inventory.brand.ilike(like),
                            Inventory.specifications.ilike(like)))
    if category:
        q = q.filter(Inventory.category == category)
    if request.args.get('in_stock') == '1':
        q = q.filter(Inventory.quantity > 0)
    return jsonify([_serialize_inventory(i) for i in q.order_by(Inventory.name).all()])


@bp.get('/inventory/categories')
def inventory_categories():
    existing = {c for (c,) in db_session.query(Inventory.category).distinct() if c}
    return jsonify(sorted(existing | set(DEFAULT_CATEGORIES)))


@bp.get('/inventory/<int:pk>')
def inventory_get(pk):
    item = get_or_404(Inventory, pk, 'Inventory item')
    txns = db_session.query(StockTransaction).filter_by(inventory_id=pk) \
        .order_by(StockTransaction.date_created.desc()).limit(50).all()
    return jsonify(_serialize_inventory(item) | {'transactions': [row(t) for t in txns]})


@bp.post('/inventory')
def inventory_create():
    data = payload()
    item = Inventory()
    apply_fields(item, data, INVENTORY_FIELDS, required=('name',))
    item.quantity = item.quantity or 0
    item.unit_price = item.unit_price or 0.0
    db_session.add(item)
    db_session.flush()
    if item.quantity:
        db_session.add(StockTransaction(
            inventory_id=item.id, transaction_type=TransactionType.STOCK_IN, quantity=item.quantity,
            unit_price=item.cost_price or item.unit_price,
            total_value=item.quantity * (item.cost_price or item.unit_price),
            notes=f'Initial stock for {item.name}'))
    db_session.commit()
    return jsonify(_serialize_inventory(item)), 201


@bp.put('/inventory/<int:pk>')
def inventory_update(pk):
    item = get_or_404(Inventory, pk, 'Inventory item')
    data = payload()
    old_qty = item.quantity or 0
    apply_fields(item, data, INVENTORY_FIELDS, required=('name',))
    diff = (item.quantity or 0) - old_qty
    if diff:
        db_session.add(StockTransaction(
            inventory_id=item.id, transaction_type=TransactionType.ADJUSTMENT, quantity=diff,
            reason=StockChangeReason.ADJUSTMENT, notes='Manual quantity edit'))
    db_session.commit()
    return jsonify(_serialize_inventory(item))


@bp.delete('/inventory/<int:pk>')
def inventory_delete(pk):
    item = get_or_404(Inventory, pk, 'Inventory item')
    db_session.query(StockTransaction).filter_by(inventory_id=pk).delete()
    db_session.query(quotationItem).filter_by(inventory_id=pk).update({quotationItem.inventory_id: None})
    db_session.query(InvoiceItem).filter_by(inventory_id=pk).update({InvoiceItem.inventory_id: None})
    db_session.delete(item)
    db_session.commit()
    return jsonify(ok=True)


@bp.post('/inventory/<int:pk>/stock-in')
def stock_in(pk):
    item = get_or_404(Inventory, pk, 'Inventory item')
    data = payload()
    qty = parse_number(data.get('quantity'), int, 'quantity')
    cost = parse_number(data.get('unit_price'), float, 'unit price')
    if not qty or qty <= 0:
        raise ApiError('Quantity must be greater than zero')
    item.quantity = (item.quantity or 0) + qty
    if cost is not None:
        item.cost_price = cost  # buying price; selling price is left untouched
    db_session.add(StockTransaction(
        inventory_id=item.id, transaction_type=TransactionType.STOCK_IN, quantity=qty,
        unit_price=cost, total_value=qty * (cost or 0), notes=data.get('notes') or ''))
    db_session.commit()
    return jsonify(_serialize_inventory(item))


@bp.post('/inventory/<int:pk>/stock-out')
def stock_out(pk):
    item = get_or_404(Inventory, pk, 'Inventory item')
    data = payload()
    qty = parse_number(data.get('quantity'), int, 'quantity')
    if not qty or qty <= 0:
        raise ApiError('Quantity must be greater than zero')
    if (item.quantity or 0) < qty:
        raise ApiError(f'Insufficient stock! Available: {item.quantity}')
    item.quantity -= qty
    db_session.add(StockTransaction(
        inventory_id=item.id, transaction_type=TransactionType.STOCK_OUT, quantity=-qty,
        unit_price=item.unit_price, total_value=-qty * (item.unit_price or 0),
        reason=parse_enum(StockChangeReason, data.get('reason'), 'reason') or StockChangeReason.ADJUSTMENT,
        customer_name=data.get('customer_name') or '', notes=data.get('notes') or ''))
    db_session.commit()
    return jsonify(_serialize_inventory(item))


# ---------------------------------------------------------------------------
# Shared document helpers (quotations / invoices)
# ---------------------------------------------------------------------------

def generate_document_number(customer, model, field):
    """[first 2 letters of name][customer ID][sequence if the customer already has documents]."""
    prefix = customer.name[:2].upper() if customer.name else 'XX'
    base = f'{prefix}{customer.identification_number}'
    n = db_session.query(model).filter_by(customer_id=customer.identification_number).count()
    candidate = base if n == 0 else f'{base}{n}'
    column = getattr(model, field)
    with unscoped():  # document numbers are unique across the whole platform
        while db_session.query(model).filter(column == candidate).first():
            n += 1
            candidate = f'{base}{n}'
    return candidate


def parse_lines(items):
    """Validate line items from the client: [{inventory_id?, description?, quantity, unit_price}]."""
    lines = []
    stamp = datetime.now().strftime('%Y%m%d%H%M%S')
    for i, it in enumerate(items or [], start=1):
        qty = parse_number(it.get('quantity'), int, f'line {i} quantity')
        price = parse_number(it.get('unit_price'), float, f'line {i} price')
        if not qty or qty <= 0:
            raise ApiError(f'Line {i}: quantity must be greater than zero')
        if price is None or price < 0:
            raise ApiError(f'Line {i}: unit price is required')
        inv_id = it.get('inventory_id')
        if inv_id:
            inv = get_or_404(Inventory, int(inv_id), 'Inventory item')
            lines.append({'inventory': inv, 'description': it.get('description') or inv.name,
                          'item_code': inv.specifications or 'INV-ITM', 'quantity': qty,
                          'unit_price': price, 'cost_price': inv.cost_price or 0.0})
        else:
            desc = (it.get('description') or '').strip()
            if not desc:
                raise ApiError(f'Line {i}: custom item name is required')
            lines.append({'inventory': None, 'description': desc,
                          'item_code': it.get('item_code') or f'CUST-{stamp}-{i}', 'quantity': qty,
                          'unit_price': price, 'cost_price': 0.0})
    if not lines:
        raise ApiError('Add at least one item')
    return lines


def _needed(lines):
    """{inventory id: (item, total quantity wanted across all lines)}."""
    needed = {}
    for line in lines:
        if line['inventory']:
            inv = line['inventory']
            needed[inv.id] = (inv, needed.get(inv.id, (inv, 0))[1] + line['quantity'])
    return needed


def plan_restock(lines, restock=None, auto=False):
    """Work out what must be bought in because the shelf is short: {inventory id: (item, quantity, buying price or None)}.

    `restock` is what the user entered ([{inventory_id, quantity, cost_price}]); with `auto` the shortfall itself is
    bought in at an unknown price. A shortfall that was not covered is refused, so stock never goes negative.
    """
    entered = {}
    for r in restock or []:
        inv_id = parse_number(r.get('inventory_id'), int, 'stock-in item')
        if inv_id is not None:
            entered[inv_id] = r
    plan = {}
    for inv, qty in _needed(lines).values():
        short = qty - (inv.quantity or 0)
        if short <= 0:
            continue
        entry = entered.get(inv.id)
        if entry is None and auto:
            plan[inv.id] = (inv, short, None)
            continue
        if entry is None:
            raise ApiError(f'{inv.name} is out of stock (available {inv.quantity or 0}, needed {qty}). '
                           f'Stock in at least {short} to continue.')
        buy = parse_number(entry.get('quantity'), int, f'{inv.name} stock-in quantity')
        if not buy or buy < short:
            raise ApiError(f'{inv.name}: stock in at least {short} (the invoice needs {qty}, {inv.quantity or 0} on hand).')
        cost = parse_number(entry.get('cost_price'), float, f'{inv.name} buying price')
        if cost is not None and cost < 0:
            raise ApiError(f'{inv.name}: the buying price cannot be negative.')
        plan[inv.id] = (inv, buy, cost)
    return plan


def apply_restock(plan, lines, invoice):
    """Book the stock-in for items that were out of stock, and note on the lines whether their cost is still unknown."""
    for inv, qty, cost in plan.values():
        inv.quantity = (inv.quantity or 0) + qty
        if cost is not None:
            inv.cost_price = cost   # latest buying price, as on the Stock in button
        note = f'Bought in for invoice {invoice.invoice_number or invoice.id} (was out of stock)'
        db_session.add(StockTransaction(
            inventory_id=inv.id, transaction_type=TransactionType.STOCK_IN, quantity=qty,
            unit_price=cost, total_value=qty * (cost or 0), reference_id=invoice.id, reference_type='invoice_restock',
            notes=note if cost is not None else f'{note}; buying price still to be added'))
    for line in lines:
        inv = line['inventory']
        if inv is not None and inv.id in plan:
            line['cost_price'] = inv.cost_price or 0.0
            line['cost_pending'] = plan[inv.id][2] is None


def _activity_type_id(data):
    type_id = parse_number(data.get('activity_type_id'), int, 'activity type')
    if type_id is not None and find(ActivityType, type_id) is None:
        raise ApiError('Activity type not found')
    return type_id


def require_customer(customer_id):
    customer = find(Customer, (customer_id or '').strip())
    if not customer:
        raise ApiError(f'Customer "{customer_id}" not found. Please add the customer first.')
    return customer


def _serialize_line(item):
    return {'id': item.id, 'inventory_id': item.inventory_id,
            'description': item.description or (item.inventory.name if item.inventory else 'Item'),
            'item_code': item.item_code, 'quantity': item.quantity, 'unit_price': item.unit_price,
            'amount': round(item.quantity * item.unit_price, 2), 'cost_pending': bool(getattr(item, 'cost_pending', False)),
            'stock_available': item.inventory.quantity if item.inventory else None}


# ---------------------------------------------------------------------------
# Quotations
# ---------------------------------------------------------------------------

def _serialize_quotation(q, detail=False, invoice_map=None):
    if invoice_map is None:
        linked = db_session.query(Invoice.id).filter_by(quotation_id=q.id).first()
        invoice_id = linked[0] if linked else None
    else:
        invoice_id = invoice_map.get(q.id)
    data = row(q, customer=customer_brief(q.customer), item_count=len(q.items), invoice_id=invoice_id)
    if detail:
        data['items'] = [_serialize_line(i) for i in q.items]
    return data


def _write_quotation_items(q, lines):
    db_session.query(quotationItem).filter_by(quotation_id=q.id).delete()
    for line in lines:
        db_session.add(quotationItem(
            quotation_id=q.id, inventory_id=line['inventory'].id if line['inventory'] else None,
            quantity=line['quantity'], unit_price=line['unit_price'],
            description=line['description'], item_code=line['item_code']))
    q.total_amount = round(sum(l['quantity'] * l['unit_price'] for l in lines), 2)


@bp.get('/quotations')
def quotations_list():
    # load the customers and item lists together (one query each) instead of one query per quotation
    items = db_session.query(quotation).options(selectinload(quotation.customer), selectinload(quotation.items)) \
        .order_by(quotation.date_created.desc()).all()
    invoice_map = {qid: iid for iid, qid in
                   db_session.query(Invoice.id, Invoice.quotation_id).filter(Invoice.quotation_id.isnot(None))}
    return jsonify([_serialize_quotation(q, invoice_map=invoice_map) for q in items])


@bp.get('/quotations/<int:pk>')
def quotations_get(pk):
    return jsonify(_serialize_quotation(get_or_404(quotation, pk, 'Quotation'), detail=True))


@bp.post('/quotations')
def quotations_create():
    data = payload()
    customer = require_customer(data.get('customer_id'))
    lines = parse_lines(data.get('items'))
    q = quotation(customer_id=customer.identification_number, total_amount=0, status='PENDING',
                  notes=data.get('notes') or None, due_date=parse_date(data.get('due_date')),
                  quotation_number=generate_document_number(customer, quotation, 'quotation_number'))
    db_session.add(q)
    db_session.flush()
    _write_quotation_items(q, lines)
    db_session.commit()
    return jsonify(_serialize_quotation(q, detail=True)), 201


@bp.put('/quotations/<int:pk>')
def quotations_update(pk):
    q = get_or_404(quotation, pk, 'Quotation')
    if q.status == 'PROCESSED':
        raise ApiError('Cannot edit a quotation that has already been converted to an invoice')
    data = payload()
    customer = require_customer(data.get('customer_id'))
    lines = parse_lines(data.get('items'))
    q.customer_id = customer.identification_number
    q.notes = data.get('notes') or None
    q.due_date = parse_date(data.get('due_date'))
    _write_quotation_items(q, lines)
    db_session.commit()
    db_session.refresh(q)
    return jsonify(_serialize_quotation(q, detail=True))


@bp.delete('/quotations/<int:pk>')
def quotations_delete(pk):
    q = get_or_404(quotation, pk, 'Quotation')
    db_session.query(Invoice).filter_by(quotation_id=pk).update({Invoice.quotation_id: None})
    db_session.query(quotationItem).filter_by(quotation_id=pk).delete()
    db_session.delete(q)
    db_session.commit()
    return jsonify(ok=True)


@bp.get('/quotations/<int:pk>/pdf')
def quotations_pdf(pk):
    return pdf_response(*pdfs.quotation_pdf(g.company, get_or_404(quotation, pk, 'Quotation')))


@bp.post('/quotations/<int:pk>/convert')
def quotations_convert(pk):
    q = get_or_404(quotation, pk, 'Quotation')
    if q.status == 'PROCESSED':
        raise ApiError('This quotation has already been converted')
    if not q.customer:
        raise ApiError('Quotation has no customer; assign one before converting')
    lines = [{'inventory': i.inventory, 'description': i.description or (i.inventory.name if i.inventory else 'Item'),
              'item_code': i.item_code or (i.inventory.specifications if i.inventory else f'CUST-LEGACY-{i.id}')
              or 'INV-ITM', 'quantity': i.quantity, 'unit_price': i.unit_price,
              'cost_price': (i.inventory.cost_price if i.inventory else 0.0) or 0.0} for i in q.items]
    # Out-of-stock items are only bought in when the user agreed to it (the app asks first); the price is added later.
    data = payload()
    plan = plan_restock(lines, data.get('restock'), auto=bool(data.get('allow_restock')))

    number = q.quotation_number
    with unscoped():
        taken = bool(number) and db_session.query(Invoice).filter_by(invoice_number=number).first() is not None
    if not number or taken:
        number = generate_document_number(q.customer, Invoice, 'invoice_number')
    invoice = Invoice(customer_id=q.customer_id, quotation_id=q.id, total_amount=0, paid_amount=0,
                      balance_due=0, status=InvoiceStatus.DRAFT, due_date=datetime.now(),
                      invoice_number=number, notes=q.notes)
    db_session.add(invoice)
    db_session.flush()
    apply_restock(plan, lines, invoice)
    _write_invoice_items(invoice, lines, 'invoice', f'Converted from Quotation {q.quotation_number or q.id}')
    q.status = 'PROCESSED'
    db_session.commit()
    return jsonify(_serialize_invoice(invoice, detail=True)), 201


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

def refresh_invoice(inv):
    inv.paid_amount = round(inv.paid_amount or 0, 2)
    inv.balance_due = round(max(0.0, (inv.total_amount or 0) - inv.paid_amount), 2)
    if inv.status == InvoiceStatus.CANCELLED:
        return
    if inv.paid_amount <= 0:
        if inv.status not in (InvoiceStatus.DRAFT, InvoiceStatus.SENT, InvoiceStatus.OVERDUE):
            inv.status = InvoiceStatus.SENT
    elif inv.balance_due <= 0:
        inv.status = InvoiceStatus.PAID
    else:
        inv.status = InvoiceStatus.PARTIAL


def _serialize_payment(p):
    inv = p.invoice
    return row(p, invoice_number=inv.invoice_number if inv else None,
               customer=customer_brief(inv.customer) if inv else None)


def _serialize_invoice(inv, detail=False):
    data = row(inv, customer=customer_brief(inv.customer),
               activity_type_name=inv.activity_type.name if inv.activity_type else None,
               quotation_number=inv.quotation.quotation_number if inv.quotation else None)
    if detail:
        data['items'] = [_serialize_line(i) for i in inv.items]
        data['payments'] = [_serialize_payment(p) for p in
                            sorted(inv.payments, key=lambda p: p.payment_date or datetime.min)]
    return data


def _restore_invoice_stock(inv, ref_type, note):
    for item in inv.items:
        if item.inventory:
            item.inventory.quantity = (item.inventory.quantity or 0) + item.quantity
            db_session.add(StockTransaction(
                inventory_id=item.inventory_id, transaction_type=TransactionType.STOCK_IN,
                quantity=item.quantity, unit_price=item.unit_price, total_value=item.quantity * item.unit_price,
                reason=StockChangeReason.RETURNED, reference_id=inv.id, reference_type=ref_type, notes=note))


def _write_invoice_items(inv, lines, ref_type, note):
    """Replace the invoice's items and deduct stock for inventory lines."""
    db_session.query(InvoiceItem).filter_by(invoice_id=inv.id).delete()
    customer = customer_label(inv.customer) or ''
    for line in lines:
        amount = round(line['quantity'] * line['unit_price'], 2)
        inventory = line['inventory']
        db_session.add(InvoiceItem(
            invoice_id=inv.id, inventory_id=inventory.id if inventory else None,
            item_code=line['item_code'], description=line['description'], quantity=line['quantity'],
            unit_price=line['unit_price'], cost_price=line['cost_price'], amount=amount,
            cost_pending=bool(line.get('cost_pending'))))
        if inventory:
            inventory.quantity = (inventory.quantity or 0) - line['quantity']
            db_session.add(StockTransaction(
                inventory_id=inventory.id, transaction_type=TransactionType.STOCK_OUT,
                quantity=-line['quantity'], unit_price=line['unit_price'], total_value=-amount,
                reason=StockChangeReason.SOLD_TO_CUSTOMER, reference_id=inv.id, reference_type=ref_type,
                customer_name=customer, notes=f'{note} (Invoice {inv.invoice_number or inv.id})'))
    inv.total_amount = round(sum(l['quantity'] * l['unit_price'] for l in lines), 2)
    refresh_invoice(inv)


@bp.get('/invoices')
def invoices_list():
    q = db_session.query(Invoice).options(selectinload(Invoice.customer), selectinload(Invoice.activity_type),
                                          selectinload(Invoice.quotation)).order_by(Invoice.date_created.desc())
    if request.args.get('customer_id'):
        q = q.filter(Invoice.customer_id == request.args['customer_id'])
    return jsonify([_serialize_invoice(i) for i in q.all()])


@bp.get('/invoices/<int:pk>')
def invoices_get(pk):
    return jsonify(_serialize_invoice(get_or_404(Invoice, pk, 'Invoice'), detail=True))


@bp.post('/invoices')
def invoices_create():
    data = payload()
    customer = require_customer(data.get('customer_id'))
    lines = parse_lines(data.get('items'))
    plan = plan_restock(lines, data.get('restock'))
    invoice = Invoice(customer_id=customer.identification_number,
                      activity_type_id=_activity_type_id(data),
                      total_amount=0, paid_amount=0, balance_due=0, status=InvoiceStatus.DRAFT,
                      due_date=parse_date(data.get('due_date')) or datetime.now(),
                      notes=data.get('notes') or None,
                      invoice_number=generate_document_number(customer, Invoice, 'invoice_number'))
    db_session.add(invoice)
    db_session.flush()
    apply_restock(plan, lines, invoice)
    _write_invoice_items(invoice, lines, 'invoice', 'Sold')
    db_session.commit()
    return jsonify(_serialize_invoice(invoice, detail=True)), 201


@bp.put('/invoices/<int:pk>')
def invoices_update(pk):
    invoice = get_or_404(Invoice, pk, 'Invoice')
    data = payload()
    customer = require_customer(data.get('customer_id'))
    lines = parse_lines(data.get('items'))
    # Put the old items back on the shelf before validating the new quantities.
    _restore_invoice_stock(invoice, 'INVOICE_EDIT_REVERT', f'Reverting for invoice {invoice.invoice_number or pk} edit')
    db_session.flush()
    plan = plan_restock(lines, data.get('restock'))
    apply_restock(plan, lines, invoice)
    invoice.customer_id = customer.identification_number
    invoice.activity_type_id = _activity_type_id(data)
    invoice.notes = data.get('notes') or None
    if data.get('due_date'):
        invoice.due_date = parse_date(data['due_date'])
    if data.get('status'):
        invoice.status = parse_enum(InvoiceStatus, data['status'], 'status')
    _write_invoice_items(invoice, lines, 'INVOICE_EDIT_DEDUCT', 'Updated')
    if invoice.paid_amount > invoice.total_amount:
        raise ApiError(f'New total {invoice.total_amount:,.2f} is less than the amount already paid '
                       f'({invoice.paid_amount:,.2f}). Remove payments first.')
    db_session.commit()
    db_session.refresh(invoice)
    return jsonify(_serialize_invoice(invoice, detail=True))


@bp.post('/invoices/<int:pk>/status')
def invoices_set_status(pk):
    invoice = get_or_404(Invoice, pk, 'Invoice')
    invoice.status = parse_enum(InvoiceStatus, payload().get('status'), 'status')
    if invoice.status != InvoiceStatus.CANCELLED:
        refresh_invoice(invoice)
    db_session.commit()
    return jsonify(_serialize_invoice(invoice, detail=True))


@bp.delete('/invoices/<int:pk>')
def invoices_delete(pk):
    invoice = get_or_404(Invoice, pk, 'Invoice')
    _restore_invoice_stock(invoice, 'invoice_deletion', f'Restored from deleted invoice {invoice.invoice_number or pk}')
    for p in list(invoice.payments):
        db_session.delete(p)
    for item in list(invoice.items):
        db_session.delete(item)
    if invoice.quotation and invoice.quotation.status == 'PROCESSED':
        invoice.quotation.status = 'PENDING'
    db_session.delete(invoice)
    db_session.commit()
    return jsonify(ok=True)


@bp.post('/invoices/<int:pk>/items/<int:item_id>/cost')
def invoice_item_cost(pk, item_id):
    """Add the buying price of an item that was bought in when it was sold (it was left blank at the time)."""
    invoice = get_or_404(Invoice, pk, 'Invoice')
    item = db_session.query(InvoiceItem).filter_by(id=item_id, invoice_id=invoice.id).first()
    if item is None:
        raise ApiError('Invoice item not found', 404)
    cost = parse_number(payload().get('cost_price'), float, 'buying price')
    if cost is None or cost < 0:
        raise ApiError('Enter the buying price (zero or more).')
    item.cost_price = cost
    item.cost_pending = False
    inv = item.inventory
    if inv is not None:
        if not inv.cost_price:
            inv.cost_price = cost
        # the stock-in booked with this invoice gets its price too
        for t in db_session.query(StockTransaction).filter_by(
                inventory_id=inv.id, reference_id=invoice.id, reference_type='invoice_restock').all():
            if t.unit_price is None:
                t.unit_price = cost
                t.total_value = t.quantity * cost
    db_session.commit()
    return jsonify(_serialize_invoice(invoice, detail=True))


@bp.get('/invoices/<int:pk>/pdf')
def invoices_pdf(pk):
    return pdf_response(*pdfs.invoice_pdf(g.company, get_or_404(Invoice, pk, 'Invoice')))


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

def _new_transaction_id():
    while True:
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        tx = f"TX-{datetime.now().strftime('%Y%m%d')}-{suffix}"
        with unscoped():
            taken = db_session.query(Payment).filter_by(transaction_id=tx).first() is not None
        if not taken:
            return tx


@bp.post('/invoices/<int:pk>/payments')
def payments_create(pk):
    invoice = get_or_404(Invoice, pk, 'Invoice')
    data = payload()
    amount = parse_number(data.get('amount'), float, 'amount')
    if not amount or amount <= 0:
        raise ApiError('Payment amount must be greater than zero')
    if amount > (invoice.balance_due or 0) + 0.005:
        raise ApiError(f'Payment amount (${amount:,.2f}) cannot exceed balance due (${invoice.balance_due:,.2f})')
    method = parse_enum(PaymentType, data.get('payment_method'), 'payment method') or PaymentType.CASH
    payment = Payment(invoice_id=invoice.id, amount=amount, payment_method=method,
                      payer_name=data.get('payer_name') or None, transaction_id=_new_transaction_id(),
                      reference_number=data.get('reference_number') or None, notes=data.get('notes') or None,
                      payment_date=parse_date(data.get('payment_date')) or datetime.now())
    db_session.add(payment)
    invoice.paid_amount = (invoice.paid_amount or 0) + amount
    refresh_invoice(invoice)
    db_session.add(FinancialRecord(
        type=FinancialType.INCOME, category='Sales',
        description=f'Payment for Invoice {invoice.invoice_number or invoice.id}', amount=amount,
        date=payment.payment_date, reference_id=invoice.id,
        notes=f'Payer: {payment.payer_name or ""} | Method: {method.value} | Ref: {payment.reference_number or ""}'))
    db_session.commit()
    return jsonify(_serialize_payment(payment)), 201


@bp.get('/payments')
def payments_list():
    items = db_session.query(Payment).options(selectinload(Payment.invoice).selectinload(Invoice.customer)) \
        .order_by(Payment.payment_date.desc()).all()
    return jsonify([_serialize_payment(p) for p in items])


@bp.get('/payments/<int:pk>')
def payments_get(pk):
    return jsonify(_serialize_payment(get_or_404(Payment, pk, 'Payment')))


@bp.put('/payments/<int:pk>')
def payments_update(pk):
    payment = get_or_404(Payment, pk, 'Payment')
    data = payload()
    new_amount = parse_number(data.get('amount'), float, 'amount')
    if not new_amount or new_amount <= 0:
        raise ApiError('Payment amount must be greater than zero')
    invoice = payment.invoice
    if invoice:
        new_paid = (invoice.paid_amount or 0) - payment.amount + new_amount
        if new_paid > invoice.total_amount + 0.005:
            raise ApiError(f'Total paid would exceed the invoice total (${invoice.total_amount:,.2f})')
        invoice.paid_amount = new_paid
    payment.amount = new_amount
    if data.get('payment_method'):
        payment.payment_method = parse_enum(PaymentType, data['payment_method'], 'payment method')
    for field in ('payer_name', 'reference_number', 'notes'):
        if field in data:
            setattr(payment, field, data[field] or None)
    if data.get('payment_date'):
        payment.payment_date = parse_date(data['payment_date'])
    if invoice:
        refresh_invoice(invoice)
    db_session.commit()
    return jsonify(_serialize_payment(payment))


@bp.delete('/payments/<int:pk>')
def payments_delete(pk):
    payment = get_or_404(Payment, pk, 'Payment')
    invoice = payment.invoice
    if invoice:
        invoice.paid_amount = (invoice.paid_amount or 0) - payment.amount
        refresh_invoice(invoice)
    db_session.delete(payment)
    db_session.commit()
    return jsonify(ok=True)


@bp.get('/payments/<int:pk>/pdf')
def payments_pdf(pk):
    return pdf_response(*pdfs.receipt_pdf(g.company, get_or_404(Payment, pk, 'Payment')))


# ---------------------------------------------------------------------------
# Financial dashboard & statements (accrual basis)
# ---------------------------------------------------------------------------

def _sum(column, *filters):
    return db_session.query(sa.func.sum(column)).filter(*filters).scalar() or 0


def _invoiced(start, end):
    return (Invoice.date_created >= start, Invoice.date_created < end, Invoice.status != InvoiceStatus.CANCELLED)


def _records(kind, start, end):
    return (FinancialRecord.type == kind, FinancialRecord.date >= start, FinancialRecord.date < end)


def _period_args():
    now = datetime.now()
    month = parse_number(request.args.get('month'), int, 'month') or now.month
    year = parse_number(request.args.get('year'), int, 'year') or now.year
    if not 1 <= month <= 12:
        raise ApiError('Month must be between 1 and 12')
    return month, year


@bp.get('/financial/summary')
def financial_summary():
    month, year = _period_args()
    start, end = month_range(year, month)

    revenue = _sum(Invoice.total_amount, *_invoiced(start, end))
    other_income = _sum(FinancialRecord.amount, *_records(FinancialType.INCOME, start, end),
                        FinancialRecord.category != 'Sales')
    expenses = _sum(FinancialRecord.amount, *_records(FinancialType.EXPENSE, start, end))
    cogs = db_session.query(sa.func.sum(InvoiceItem.cost_price * InvoiceItem.quantity)).join(Invoice) \
        .filter(*_invoiced(start, end)).scalar() or 0

    stock_rev = db_session.query(sa.func.sum(InvoiceItem.amount)).join(Invoice) \
        .filter(*_invoiced(start, end), InvoiceItem.inventory_id.isnot(None)).scalar() or 0
    service_rev = db_session.query(sa.func.sum(InvoiceItem.amount)).join(Invoice) \
        .filter(*_invoiced(start, end), InvoiceItem.inventory_id.is_(None)).scalar() or 0

    by_activity = db_session.query(ActivityType.name, sa.func.sum(Invoice.total_amount)) \
        .outerjoin(ActivityType, Invoice.activity_type_id == ActivityType.id) \
        .filter(*_invoiced(start, end)).group_by(ActivityType.name).all()

    expense_cats = db_session.query(FinancialRecord.category, sa.func.sum(FinancialRecord.amount)) \
        .filter(*_records(FinancialType.EXPENSE, start, end)).group_by(FinancialRecord.category).all()

    trend = []
    for m in range(1, 13):
        m_start, m_end = month_range(year, m)
        trend.append({'month': MONTHS[m - 1],
                      'revenue': _sum(Invoice.total_amount, *_invoiced(m_start, m_end)),
                      'expenses': _sum(FinancialRecord.amount, *_records(FinancialType.EXPENSE, m_start, m_end))})

    top_items = db_session.query(InvoiceItem.description, sa.func.sum(InvoiceItem.amount)).join(Invoice) \
        .filter(*_invoiced(start, end)).group_by(InvoiceItem.description) \
        .order_by(sa.func.sum(InvoiceItem.amount).desc()).limit(8).all()

    recent = db_session.query(FinancialRecord).filter(FinancialRecord.date >= start, FinancialRecord.date < end) \
        .order_by(FinancialRecord.date.desc()).limit(25).all()

    collected = _sum(Payment.amount, Payment.payment_date >= start, Payment.payment_date < end)

    return jsonify(
        month=month, year=year,
        kpis={'revenue': revenue, 'other_income': other_income, 'total_income': revenue + other_income,
              'expenses': expenses, 'cogs': cogs, 'gross_profit': revenue - cogs,
              'net_profit': revenue + other_income - cogs - expenses, 'collected': collected},
        income_by_source=[{'label': 'Stock Sales', 'value': stock_rev},
                          {'label': 'Services/Labor', 'value': service_rev}],
        income_by_activity=[{'label': name or 'General Sales', 'value': v} for name, v in by_activity if v],
        expense_breakdown=[{'label': c or 'Uncategorized', 'value': v} for c, v in expense_cats],
        monthly_trend=trend,
        top_items=[{'label': d or 'Item', 'value': v} for d, v in top_items],
        top_locations=_top_locations(5),
        recent_records=[row(r) for r in recent],
    )


def _statement_figures(start, end):
    """Everything the income statement shows for one period (accrual basis)."""
    def by_category(kind, *extra):
        rows = db_session.query(FinancialRecord.category, sa.func.sum(FinancialRecord.amount))             .filter(*_records(kind, start, end), *extra).group_by(FinancialRecord.category).all()
        return [(c or 'Uncategorised', v) for c, v in rows if v]

    def item_total(*extra):
        return db_session.query(sa.func.sum(InvoiceItem.amount)).join(Invoice)             .filter(*_invoiced(start, end), *extra).scalar() or 0

    return dict(
        revenue=_sum(Invoice.total_amount, *_invoiced(start, end)),
        stock=item_total(InvoiceItem.inventory_id.isnot(None)),
        service=item_total(InvoiceItem.inventory_id.is_(None)),
        cogs=db_session.query(sa.func.sum(InvoiceItem.cost_price * InvoiceItem.quantity)).join(Invoice)
        .filter(*_invoiced(start, end)).scalar() or 0,
        other=by_category(FinancialType.INCOME, FinancialRecord.category != 'Sales'),
        expenses=by_category(FinancialType.EXPENSE),
    )


@bp.get('/financial/income-statement.pdf')
def income_statement():
    month, year = _period_args()
    start, end = month_range(year, month)
    month_fig = _statement_figures(start, end)
    ytd_fig = _statement_figures(datetime(year, 1, 1), end)
    buf = statements.income_statement_pdf(g.company, start, month_fig, ytd_fig)
    return pdf_response(buf, f'income_statement_{month}_{year}.pdf')


@bp.get('/financial/balance-sheet.pdf')
def balance_sheet():
    month, year = _period_args()
    start, end = month_range(year, month)
    value = sa.func.coalesce(sa.func.nullif(Inventory.cost_price, 0), Inventory.unit_price) * Inventory.quantity
    inventory = db_session.query(Inventory.category, sa.func.sum(value)).group_by(Inventory.category).all()
    unpaid = (Invoice.status != InvoiceStatus.CANCELLED, Invoice.date_created < end)
    receivables = _sum(Invoice.balance_due, *unpaid)
    open_invoices = db_session.query(sa.func.count(Invoice.id)).filter(*unpaid, Invoice.balance_due > 0.004).scalar() or 0
    liabilities = _sum(FinancialRecord.amount, FinancialRecord.type == FinancialType.EXPENSE,
                       FinancialRecord.category.in_(['Loan', 'Credit', 'Liability']), FinancialRecord.date < end)
    buf = statements.balance_sheet_pdf(g.company, end - timedelta(days=1), [(c, v or 0) for c, v in inventory],
                                       receivables, open_invoices, liabilities)
    return pdf_response(buf, f'balance_sheet_{month}_{year}.pdf')


protect(bp)
