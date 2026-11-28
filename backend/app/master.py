"""Master admin portal: the platform owner manages the companies that use the software and the shops they source from.

Only emails listed in PLATFORM_ADMIN_EMAILS can use it.

  Companies      every company, its plan, when it renews, whether it is overdue, and a switch to suspend it
  Plans          the plans you sell (monthly price, how many users they allow)
  Payments       money you receive from a company; each payment moves its renewal date forward
  Suppliers      the shops and sellers you source products from (a directory; the shop's seller comparison uses the names)

Payments are recorded by you when the money arrives (EcoCash, bank, cash); there is no online billing.
"""
import hmac
import os
from datetime import date, datetime

from flask import Blueprint, g, jsonify, request
from werkzeug.security import generate_password_hash
from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from .auth import (PUBLIC_ENDPOINTS, ApiError, _client_ip, _email, _limited, _password, _session_json, _start_session,
                   _text, is_operator, platform_operators, protect)
from .database import Base, db_session
from .models import Company, User
from .payment_plans import add_months

master_bp = Blueprint('master', __name__, url_prefix='/api/master')

PAYMENT_METHODS = ('CASH', 'ECOCASH', 'TRANSFER', 'OTHER')
SUPPLIER_TRADES = ('solar', 'cctv', 'borehole', 'alarms', 'razorwire', 'materials')
SOON = 7            # a renewal this many days away is flagged "renews soon"


# ---------------------------------------------------------------------------
# Tables (platform-wide: they belong to the owner, not to any company)
# ---------------------------------------------------------------------------

class Plan(Base):
    __tablename__ = 'plans'
    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    monthly_price = Column(Float, default=0)
    max_users = Column(Integer)                 # empty = no limit on team members
    notes = Column(String(300))
    is_active = Column(Boolean, default=True)


class Subscription(Base):
    __tablename__ = 'subscriptions'
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey('companies.id'), nullable=False, unique=True)
    plan_id = Column(Integer, ForeignKey('plans.id'))
    plan = relationship('Plan')
    started_on = Column(Date)
    renews_on = Column(Date)                    # paid up to this day
    notes = Column(String(500))


class SubscriptionPayment(Base):
    __tablename__ = 'subscription_payments'
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey('companies.id'), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    paid_on = Column(Date, nullable=False)
    method = Column(String(20), default='CASH')
    reference = Column(String(100))
    months = Column(Integer, default=1)         # how many months this payment covers
    notes = Column(String(300))
    created = Column(DateTime, default=datetime.utcnow)


class ShopSupplier(Base):
    """A shop or seller the owner buys products from."""
    __tablename__ = 'shop_suppliers'
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    contact = Column(String(100))
    phone = Column(String(60))
    email = Column(String(120))
    town = Column(String(80))
    website = Column(String(300))
    supplies = Column(String(200))              # comma-separated trades they supply
    notes = Column(String(500))
    recommended = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _operator():
    if not is_operator(g.get('user')):
        raise ApiError('Only the platform owner can use the master admin.', 403)


def _not_found():
    raise ApiError('Not found', 404)


def _clean(data, key, limit, label, required=False):
    value = data.get(key)
    value = value.strip()[:limit] if isinstance(value, str) else ''
    if required and not value:
        raise ApiError(f'{label} is required.')
    return value


def _num(value, label, minimum=0.0, maximum=10_000_000.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ApiError(f'{label} must be a number.')
    if number < minimum or number > maximum:
        raise ApiError(f'{label} must be between {minimum:g} and {maximum:g}.')
    return number


def _day(value, label):
    if value in (None, ''):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ApiError(f'{label} is not a valid date.')


def _iso(value):
    return value.isoformat() if value else None


def status_of(company, sub, today=None):
    """('suspended' | 'no_plan' | 'overdue' | 'renews_soon' | 'active', days overdue)."""
    today = today or date.today()
    if not company.is_active:
        return 'suspended', 0
    if sub is None or sub.plan_id is None or sub.renews_on is None:
        return 'no_plan', 0
    if sub.renews_on < today:
        return 'overdue', (today - sub.renews_on).days
    if (sub.renews_on - today).days <= SOON:
        return 'renews_soon', 0
    return 'active', 0


def check_user_limit(company_id):
    """Called when a team member is added: refuse it when the company's plan allows no more users."""
    sub = db_session.query(Subscription).filter_by(company_id=company_id).first()
    plan = sub.plan if sub is not None else None
    if plan is None or not plan.max_users:
        return
    active = db_session.query(User).filter_by(company_id=company_id, is_active=True).count()
    if active >= plan.max_users:
        raise ApiError(f'Your {plan.name} plan allows {plan.max_users} team members. Ask the platform owner to upgrade it.')


def _company_row(c, sub, last_payment, users, owner_email):
    status, overdue = status_of(c, sub)
    plan = sub.plan if sub is not None else None
    return {
        'id': c.id, 'name': c.name, 'owner_email': owner_email, 'phone': c.phone, 'email': c.email,
        'created': _iso(c.date_created), 'is_active': bool(c.is_active), 'users': users,
        'plan_id': sub.plan_id if sub else None, 'plan_name': plan.name if plan else None,
        'monthly_price': plan.monthly_price if plan else 0, 'max_users': plan.max_users if plan else None,
        'started_on': _iso(sub.started_on) if sub else None, 'renews_on': _iso(sub.renews_on) if sub else None,
        'notes': sub.notes if sub else None, 'status': status, 'days_overdue': overdue,
        'last_payment': ({'amount': last_payment.amount, 'paid_on': _iso(last_payment.paid_on)} if last_payment else None),
    }


def _all_company_rows():
    companies = db_session.query(Company).order_by(Company.name).all()
    subs = {s.company_id: s for s in db_session.query(Subscription).all()}
    last = {}
    for p in db_session.query(SubscriptionPayment).order_by(SubscriptionPayment.paid_on, SubscriptionPayment.id):
        last[p.company_id] = p
    users = dict(db_session.query(User.company_id, func.count(User.id)).filter(User.is_active.is_(True))
                 .group_by(User.company_id).all())
    owners = {}
    for u in db_session.query(User).filter(User.role == 'owner').order_by(User.id):
        owners.setdefault(u.company_id, u.email)
    return [_company_row(c, subs.get(c.id), last.get(c.id), users.get(c.id, 0), owners.get(c.id)) for c in companies]


# ---------------------------------------------------------------------------
# Creating the master account (public page, protected by a one-time setup code)
# ---------------------------------------------------------------------------

def _setup_code():
    code = os.environ.get('MASTER_SETUP_CODE', '').strip()
    return code if len(code) >= 8 else ''


def _setup_available():
    """True while a setup code is configured and an owner email in PLATFORM_ADMIN_EMAILS has no account yet."""
    if not _setup_code():
        return False
    return any(db_session.query(User).filter(func.lower(User.email) == e).first() is None for e in platform_operators())


@master_bp.get('/setup-status')
def setup_status():
    return jsonify(available=_setup_available())


@master_bp.post('/setup')
def setup():
    """Create the master account. Needs MASTER_SETUP_CODE (set by you in the hosting dashboard); works only for an
    email listed in PLATFORM_ADMIN_EMAILS that has no account yet, so it stops working once the account exists."""
    if _limited(f'master-setup:{_client_ip()}', 6, 3600):
        raise ApiError('Too many tries. Please wait an hour.', 429)
    data = request.get_json(silent=True) or {}
    code = _setup_code()
    if not code or not hmac.compare_digest(str(data.get('code') or '').strip().encode(), code.encode()):
        raise ApiError('That setup code is not right.', 403)
    email = _email(data)
    if email not in platform_operators():
        raise ApiError('That email is not on the list of platform owners.', 403)
    if db_session.query(User).filter(func.lower(User.email) == email).first() is not None:
        raise ApiError('The master account already exists. Sign in instead.')
    name = _text(data, 'name', 100, 'Your name', required=True)
    password = _password(data)
    company = Company(name=os.environ.get('MASTER_COMPANY_NAME', '').strip()[:150] or 'Afritech', email=email)
    db_session.add(company)
    db_session.flush()
    user = User(company_id=company.id, name=name, email=email, role='owner', password_hash=generate_password_hash(password))
    db_session.add(user)
    db_session.flush()
    _start_session(user)
    return jsonify(_session_json(user)), 201


PUBLIC_ENDPOINTS.update({'master.setup_status', 'master.setup'})


# ---------------------------------------------------------------------------
# Companies and subscriptions
# ---------------------------------------------------------------------------

@master_bp.get('/overview')
def overview():
    _operator()
    rows = _all_company_rows()
    count = lambda st: sum(1 for r in rows if r['status'] == st)  # noqa: E731
    month_start = date.today().replace(day=1)
    collected = db_session.query(func.coalesce(func.sum(SubscriptionPayment.amount), 0)) \
        .filter(SubscriptionPayment.paid_on >= month_start).scalar() or 0
    recurring = sum(r['monthly_price'] or 0 for r in rows if r['status'] in ('active', 'renews_soon', 'overdue'))
    return jsonify(companies=len(rows), active=count('active') + count('renews_soon'), overdue=count('overdue'),
                   suspended=count('suspended'), no_plan=count('no_plan'), monthly_recurring=round(recurring, 2),
                   collected_this_month=round(collected, 2))


@master_bp.get('/companies')
def companies():
    _operator()
    return jsonify(companies=_all_company_rows(), plans=[_plan(p) for p in _plans()])


def _company_or_404(cid):
    return db_session.get(Company, cid) or _not_found()


def _one(cid):
    return next(r for r in _all_company_rows() if r['id'] == cid)


@master_bp.patch('/companies/<int:cid>')
def update_company(cid):
    """Change a company's plan or renewal date, add a note, or suspend / reactivate it."""
    _operator()
    company = _company_or_404(cid)
    data = request.get_json(silent=True) or {}
    if 'is_active' in data:
        company.is_active = bool(data['is_active'])
    sub = db_session.query(Subscription).filter_by(company_id=cid).first()
    if sub is None:
        sub = Subscription(company_id=cid, started_on=date.today())
        db_session.add(sub)
    if 'plan_id' in data:
        if data['plan_id'] in (None, ''):
            sub.plan_id = None
        else:
            plan = db_session.get(Plan, int(data['plan_id'])) or _not_found()
            sub.plan_id = plan.id
            if sub.renews_on is None:
                sub.renews_on = date.today()       # a new plan is unpaid until a payment is recorded
    if 'started_on' in data:
        sub.started_on = _day(data['started_on'], 'Start date')
    if 'renews_on' in data:
        sub.renews_on = _day(data['renews_on'], 'Renewal date')
    if 'notes' in data:
        sub.notes = _clean(data, 'notes', 500, 'Notes') or None
    db_session.commit()
    return jsonify(_one(cid))


@master_bp.get('/companies/<int:cid>/payments')
def company_payments(cid):
    _operator()
    _company_or_404(cid)
    rows = db_session.query(SubscriptionPayment).filter_by(company_id=cid) \
        .order_by(SubscriptionPayment.paid_on.desc(), SubscriptionPayment.id.desc()).all()
    return jsonify(payments=[_payment(p) for p in rows])


def _payment(p):
    return {'id': p.id, 'amount': p.amount, 'paid_on': _iso(p.paid_on), 'method': p.method, 'reference': p.reference,
            'months': p.months, 'notes': p.notes}


@master_bp.post('/companies/<int:cid>/payments')
def add_payment(cid):
    """Record money received from a company. It covers `months` months: the renewal date moves forward by that much."""
    _operator()
    company = _company_or_404(cid)
    data = request.get_json(silent=True) or {}
    amount = _num(data.get('amount'), 'The amount', 0.01)
    months = int(_num(data.get('months', 1), 'The number of months', 1, 60))
    method = data.get('method') if data.get('method') in PAYMENT_METHODS else 'CASH'
    paid_on = _day(data.get('paid_on'), 'Payment date') or date.today()
    sub = db_session.query(Subscription).filter_by(company_id=cid).first()
    if sub is None or sub.plan_id is None:
        raise ApiError('Choose a plan for this company before recording a payment.')
    db_session.add(SubscriptionPayment(company_id=cid, amount=round(amount, 2), paid_on=paid_on, method=method,
                                       reference=_clean(data, 'reference', 100, 'Reference') or None, months=months,
                                       notes=_clean(data, 'notes', 300, 'Notes') or None))
    # paid up to the renewal date: extend from it when it is still ahead, otherwise from the day the money came in
    base = sub.renews_on if sub.renews_on and sub.renews_on >= paid_on else paid_on
    sub.renews_on = add_months(base, months)
    if not sub.started_on:
        sub.started_on = paid_on
    if not company.is_active and data.get('reactivate'):
        company.is_active = True
    db_session.commit()
    return jsonify(_one(cid)), 201


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------

def _plans():
    return db_session.query(Plan).order_by(Plan.monthly_price, Plan.name).all()


def _plan(p):
    used = db_session.query(Subscription).filter_by(plan_id=p.id).count()
    return {'id': p.id, 'name': p.name, 'monthly_price': p.monthly_price, 'max_users': p.max_users,
            'notes': p.notes or '', 'is_active': bool(p.is_active), 'companies': used}


def _plan_fields(plan, data):
    if 'name' in data:
        plan.name = _clean(data, 'name', 80, 'Plan name', required=True)
    if 'monthly_price' in data:
        plan.monthly_price = round(_num(data['monthly_price'], 'The monthly price'), 2)
    if 'max_users' in data:
        plan.max_users = None if data['max_users'] in (None, '') else int(_num(data['max_users'], 'Users', 1, 10000))
    if 'notes' in data:
        plan.notes = _clean(data, 'notes', 300, 'Notes') or None
    if 'is_active' in data:
        plan.is_active = bool(data['is_active'])


@master_bp.get('/plans')
def list_plans():
    _operator()
    return jsonify(plans=[_plan(p) for p in _plans()])


@master_bp.post('/plans')
def add_plan():
    _operator()
    plan = Plan(is_active=True)
    _plan_fields(plan, {'name': '', 'monthly_price': 0, **(request.get_json(silent=True) or {})})
    db_session.add(plan)
    db_session.commit()
    return jsonify(_plan(plan)), 201


@master_bp.patch('/plans/<int:pid>')
def edit_plan(pid):
    _operator()
    plan = db_session.get(Plan, pid) or _not_found()
    _plan_fields(plan, request.get_json(silent=True) or {})
    db_session.commit()
    return jsonify(_plan(plan))


@master_bp.delete('/plans/<int:pid>')
def delete_plan(pid):
    _operator()
    plan = db_session.get(Plan, pid) or _not_found()
    if db_session.query(Subscription).filter_by(plan_id=pid).count():
        raise ApiError('Companies are on this plan. Move them to another plan first, or switch it off instead.')
    db_session.delete(plan)
    db_session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Suppliers directory
# ---------------------------------------------------------------------------

def _supplier(s):
    return {'id': s.id, 'name': s.name, 'contact': s.contact or '', 'phone': s.phone or '', 'email': s.email or '',
            'town': s.town or '', 'website': s.website or '', 'supplies': [x for x in (s.supplies or '').split(',') if x],
            'notes': s.notes or '', 'recommended': bool(s.recommended), 'is_active': bool(s.is_active)}


def _supplier_fields(s, data):
    if 'name' in data:
        s.name = _clean(data, 'name', 120, 'Shop or seller name', required=True)
    for key, limit in (('contact', 100), ('phone', 60), ('email', 120), ('town', 80), ('website', 300), ('notes', 500)):
        if key in data:
            setattr(s, key, _clean(data, key, limit, key.capitalize()) or None)
    if 'supplies' in data:
        raw = data['supplies'] if isinstance(data['supplies'], list) else str(data['supplies'] or '').split(',')
        s.supplies = ','.join(x for x in dict.fromkeys(str(t).strip() for t in raw) if x in SUPPLIER_TRADES)
    if 'recommended' in data:
        s.recommended = bool(data['recommended'])
    if 'is_active' in data:
        s.is_active = bool(data['is_active'])


@master_bp.get('/suppliers')
def list_suppliers():
    _operator()
    rows = db_session.query(ShopSupplier).order_by(ShopSupplier.recommended.desc(), ShopSupplier.name).all()
    return jsonify(suppliers=[_supplier(s) for s in rows], trades=list(SUPPLIER_TRADES))


@master_bp.post('/suppliers')
def add_supplier():
    _operator()
    s = ShopSupplier(is_active=True)
    _supplier_fields(s, {'name': '', **(request.get_json(silent=True) or {})})
    db_session.add(s)
    db_session.commit()
    return jsonify(_supplier(s)), 201


@master_bp.patch('/suppliers/<int:sid>')
def edit_supplier(sid):
    _operator()
    s = db_session.get(ShopSupplier, sid) or _not_found()
    _supplier_fields(s, request.get_json(silent=True) or {})
    db_session.commit()
    return jsonify(_supplier(s))


@master_bp.delete('/suppliers/<int:sid>')
def delete_supplier(sid):
    _operator()
    s = db_session.get(ShopSupplier, sid) or _not_found()
    db_session.delete(s)
    db_session.commit()
    return jsonify(ok=True)


protect(master_bp)
