"""Accounts, company isolation (multi-tenancy), roles and the audit log.

Every business table carries a company_id (models.TenantMixin). While a logged-in request is being
handled, every ORM query is automatically limited to that user's company and every new row is stamped
with it, so one company can never read or change another company's data.
"""
import base64
import logging
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime

from flask import Blueprint, Response, g, has_request_context, jsonify, request, session
from sqlalchemy import event, func
from sqlalchemy.orm import Session, with_loader_criteria
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from .database import db_session
from .models import AuditLog, Company, StockTransaction, TenantMixin, User

log = logging.getLogger('erp')
auth_bp = Blueprint('auth', __name__, url_prefix='/api')

SAFE_METHODS = {'GET', 'HEAD', 'OPTIONS'}
PUBLIC_ENDPOINTS = {'auth.login', 'auth.signup', 'auth.me', 'auth.logout'}
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _handle_error(exc):
    db_session.rollback()
    if isinstance(exc, ApiError):
        return jsonify(error=exc.message), exc.status
    if isinstance(exc, HTTPException):
        return jsonify(error=exc.description), exc.code
    log.exception('Unhandled error on %s %s', request.method, request.path)
    return jsonify(error='Something went wrong on the server. Please try again.'), 500


# ---------------------------------------------------------------------------
# Tenant scoping
# ---------------------------------------------------------------------------

def current_company_id():
    """Company of the logged-in user, or None outside a request / inside unscoped()."""
    if not has_request_context() or g.get('_unscoped'):
        return None
    return g.get('company_id')


@contextmanager
def unscoped():
    """Look across all companies. Only for uniqueness checks on globally unique columns."""
    g._unscoped = g.get('_unscoped', 0) + 1
    try:
        yield
    finally:
        g._unscoped -= 1


@event.listens_for(Session, 'do_orm_execute')
def _limit_to_company(state):
    cid = current_company_id()
    if cid is None or state.is_column_load or state.is_relationship_load:
        return
    if state.is_select or state.is_update or state.is_delete:
        state.statement = state.statement.options(
            with_loader_criteria(TenantMixin, lambda cls: cls.company_id == cid, include_aliases=True))


@event.listens_for(Session, 'before_flush')
def _stamp_new_rows(sess, flush_context, instances):
    if not has_request_context():
        return
    cid = g.get('company_id')
    user = g.get('user')
    for obj in sess.new:
        if isinstance(obj, TenantMixin) and obj.company_id is None and cid is not None:
            obj.company_id = cid
        if isinstance(obj, StockTransaction) and not obj.created_by and user is not None:
            obj.created_by = user.name


def find(model, pk):
    """Like session.get(), but never returns another company's row."""
    if pk in (None, ''):
        return None
    obj = db_session.get(model, pk)
    cid = current_company_id()
    if obj is not None and cid is not None and getattr(obj, 'company_id', cid) != cid:
        return None
    return obj


# ---------------------------------------------------------------------------
# Roles and permissions (enforced on the server for every /api request)
# ---------------------------------------------------------------------------

MODULE_OF = {
    'customers': 'customers',
    'quotations': 'sales', 'invoices': 'sales', 'payments': 'sales',
    'inventory': 'inventory', 'suppliers': 'inventory', 'pricing': 'inventory',
    'financial': 'finance', 'financial-records': 'finance', 'financial-categories': 'finance',
    'activities': 'operations', 'activity-types': 'operations', 'fuel-records': 'operations',
    'mileage-records': 'operations', 'journeys': 'operations', 'locations': 'operations',
    'dashboard': 'dashboard', 'meta': 'any', 'auth': 'any',
    'whatsapp': 'customers',
    'users': 'admin', 'company': 'admin', 'audit-log': 'admin',
}
_ALL = {m: 'write' for m in ('customers', 'sales', 'inventory', 'finance', 'operations', 'dashboard')}
ROLES = {
    'owner': {**_ALL, 'admin': 'write'},
    'admin': {**_ALL, 'admin': 'write'},
    'manager': dict(_ALL),
    'sales': {'customers': 'write', 'sales': 'write', 'inventory': 'read', 'operations': 'read',
              'dashboard': 'read'},
    'inventory': {'inventory': 'write', 'customers': 'read', 'sales': 'read', 'operations': 'read',
                  'dashboard': 'read'},
    'accountant': {'finance': 'write', 'sales': 'write', 'customers': 'read', 'inventory': 'read',
                   'operations': 'read', 'dashboard': 'read'},
    'technician': {'operations': 'write', 'customers': 'read', 'inventory': 'read'},
    'support': {'customers': 'write', 'sales': 'read', 'inventory': 'read', 'operations': 'read',
                'dashboard': 'read'},
}
ROLE_LABELS = {'owner': 'Company owner', 'admin': 'Administrator', 'manager': 'Manager',
               'sales': 'Salesperson', 'inventory': 'Inventory manager', 'accountant': 'Accountant',
               'technician': 'Technician', 'support': 'Customer support'}
_LEVEL = {None: 0, 'read': 1, 'write': 2}


def allowed(role, module, need):
    if module == 'any':
        return True
    return _LEVEL[ROLES.get(role, {}).get(module)] >= _LEVEL[need]


def _module_for(path):
    parts = path.split('/')
    # /api/<segment>/...; anything unknown is treated as admin-only.
    return MODULE_OF.get(parts[2] if len(parts) > 2 else '', 'admin')


def _password_version(user):
    return user.password_hash[-16:]


def _load_user():
    uid = session.get('uid')
    if not uid:
        return None
    user = db_session.get(User, uid)
    if (user is None or not user.is_active or user.company is None or not user.company.is_active
            or session.get('pv') != _password_version(user)):
        session.clear()
        return None
    g.user, g.company, g.company_id = user, user.company, user.company_id
    return user


def _guard():
    if request.method not in SAFE_METHODS and request.headers.get('X-Requested-With') != 'fetch':
        raise ApiError('Bad request', 400)
    user = _load_user()
    if request.endpoint in PUBLIC_ENDPOINTS:
        return
    if user is None:
        raise ApiError('Please log in.', 401)
    need = 'read' if request.method in SAFE_METHODS else 'write'
    if not allowed(user.role, _module_for(request.path), need):
        raise ApiError('You do not have permission to do this.', 403)


def _audit(response):
    """Record every successful change (who, what, when)."""
    try:
        user = g.get('user')
        if request.method not in SAFE_METHODS and response.status_code < 400 and user is not None:
            db_session.add(AuditLog(company_id=user.company_id, user_id=user.id, user_name=user.name,
                                    action=request.method, path=request.path[:200],
                                    status=response.status_code))
            db_session.commit()
    except Exception:
        db_session.rollback()
        log.exception('Could not write audit log')
    return response


def protect(bp):
    """Require login + permission on every route of a blueprint, and audit its changes."""
    bp.before_request(_guard)
    bp.after_request(_audit)
    bp.register_error_handler(Exception, _handle_error)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

_HITS = {}


def _client_ip():
    return (request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
            or request.remote_addr or '?')


def _limited(key, limit, window):
    now = time.time()
    if len(_HITS) > 10000:
        _HITS.clear()
    hits = [t for t in _HITS.get(key, []) if now - t < window]
    blocked = len(hits) >= limit
    if not blocked:
        hits.append(now)
    _HITS[key] = hits
    return blocked


def _text(data, key, limit, label=None, required=False):
    value = data.get(key)
    value = value.strip()[:limit] if isinstance(value, str) else ''
    if required and not value:
        raise ApiError(f'{label or key.capitalize()} is required.')
    return value


def _email(data):
    email = _text(data, 'email', 150, 'Email', required=True).lower()
    if not EMAIL_RE.match(email):
        raise ApiError('Please enter a valid email address.')
    return email


def _password(data, required=True):
    password = data.get('password')
    if not password and not required:
        return None
    if not isinstance(password, str) or len(password) < 8:
        raise ApiError('Password must be at least 8 characters.')
    if len(password) > 200:
        raise ApiError('Password is too long.')
    return password


def _has_logo(c):
    return bool(db_session.query(func.length(Company.logo)).filter(Company.id == c.id).scalar())


def _company_json(c):
    return {'id': c.id, 'name': c.name, 'phone': c.phone, 'email': c.email, 'address': c.address,
            'banking_details': c.banking_details, 'currency': c.currency or 'USD', 'has_logo': _has_logo(c)}


def _user_json(u):
    return {'id': u.id, 'name': u.name, 'email': u.email, 'role': u.role,
            'role_label': ROLE_LABELS.get(u.role, u.role), 'is_active': u.is_active,
            'date_created': u.date_created.isoformat() if u.date_created else None,
            'last_login': u.last_login.isoformat() if u.last_login else None}


def whatsapp_enabled(company_id):
    """The WhatsApp bot serves one company: the one whose id is in WHATSAPP_COMPANY_ID."""
    raw = os.environ.get('WHATSAPP_COMPANY_ID', '').strip()
    return raw.isdigit() and int(raw) == company_id


def _session_json(user):
    return {'user': _user_json(user), 'company': _company_json(user.company),
            'permissions': ROLES.get(user.role, {}),
            'features': {'whatsapp': whatsapp_enabled(user.company_id)},
            'roles': [{'value': k, 'label': v} for k, v in ROLE_LABELS.items()]}


def _start_session(user):
    session.clear()
    session.permanent = True
    session['uid'] = user.id
    session['pv'] = _password_version(user)
    user.last_login = datetime.utcnow()
    db_session.commit()
    g.user, g.company, g.company_id = user, user.company, user.company_id


# ---------------------------------------------------------------------------
# Sign-up, login, logout
# ---------------------------------------------------------------------------

@auth_bp.get('/auth/me')
def me():
    user = g.get('user')
    return jsonify(_session_json(user) if user else {'user': None})


@auth_bp.post('/auth/signup')
def signup():
    """Register a new solar company together with its owner account."""
    if _limited(f'signup:{_client_ip()}', 10, 3600):
        raise ApiError('Too many sign-ups from this connection. Please try again later.', 429)
    data = request.get_json(silent=True) or {}
    company_name = _text(data, 'company_name', 150, 'Company name', required=True)
    name = _text(data, 'name', 100, 'Your name', required=True)
    email = _email(data)
    password = _password(data)
    if db_session.query(User).filter_by(email=email).first():
        raise ApiError('An account with this email already exists. Please log in instead.')
    company = Company(name=company_name, phone=_text(data, 'phone', 100) or None, email=email)
    db_session.add(company)
    db_session.flush()
    user = User(company_id=company.id, name=name, email=email, role='owner',
                password_hash=generate_password_hash(password))
    db_session.add(user)
    db_session.flush()
    _start_session(user)
    return jsonify(_session_json(user)), 201


@auth_bp.post('/auth/login')
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()[:150]
    password = str(data.get('password') or '')[:200]
    if _limited(f'login:{_client_ip()}:{email}', 8, 600):
        raise ApiError('Too many attempts. Please wait 10 minutes and try again.', 429)
    user = db_session.query(User).filter_by(email=email).first()
    ok = user is not None and check_password_hash(user.password_hash, password)
    if not ok or not user.is_active or not user.company.is_active:
        raise ApiError('Wrong email or password.', 401)
    _start_session(user)
    return jsonify(_session_json(user))


@auth_bp.post('/auth/logout')
def logout():
    session.clear()
    return jsonify(ok=True)


@auth_bp.post('/auth/password')
def change_password():
    data = request.get_json(silent=True) or {}
    user = g.user
    if not check_password_hash(user.password_hash, str(data.get('current_password') or '')):
        raise ApiError('Your current password is wrong.')
    user.password_hash = generate_password_hash(_password(data))
    db_session.commit()
    session['pv'] = _password_version(user)  # keep this device logged in; others are logged out
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Company settings (owner / admin)
# ---------------------------------------------------------------------------

@auth_bp.get('/company')
def company_get():
    return jsonify(_company_json(g.company))


@auth_bp.put('/company')
def company_update():
    data = request.get_json(silent=True) or {}
    c = g.company
    c.name = _text(data, 'name', 150, 'Company name', required=True)
    c.phone = _text(data, 'phone', 100) or None
    c.email = _text(data, 'email', 150) or None
    c.address = _text(data, 'address', 300) or None
    c.banking_details = _text(data, 'banking_details', 500) or None
    c.currency = (_text(data, 'currency', 10) or 'USD').upper()
    db_session.commit()
    return jsonify(_company_json(c))


LOGO_TYPES = {bytes.fromhex('89504e470d0a1a0a'): 'image/png', bytes.fromhex('ffd8ff'): 'image/jpeg'}
MAX_LOGO_BYTES = 1_200_000


def _logo_mime(blob):
    return next((mime for magic, mime in LOGO_TYPES.items() if blob.startswith(magic)), None)


@auth_bp.get('/company/logo')
def company_logo():
    blob = g.company.logo
    if not blob:
        raise ApiError('This company has no logo yet.', 404)
    resp = Response(blob, mimetype=_logo_mime(blob) or 'image/png')
    resp.headers['Cache-Control'] = 'private, max-age=300'
    return resp


@auth_bp.put('/company/logo')
def company_logo_set():
    """Body: {"image": "<base64 or data: URL of a PNG/JPEG>"}. Printed on every document."""
    raw = (request.get_json(silent=True) or {}).get('image') or ''
    if raw.startswith('data:') and ',' in raw:
        raw = raw.split(',', 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError):
        raise ApiError('That is not a valid image.')
    if not _logo_mime(blob):
        raise ApiError('Please use a PNG or JPEG image.')
    if len(blob) > MAX_LOGO_BYTES:
        raise ApiError('The logo is too big (1 MB at most).')
    g.company.logo = blob
    db_session.commit()
    return jsonify(_company_json(g.company))


@auth_bp.delete('/company/logo')
def company_logo_remove():
    g.company.logo = None
    db_session.commit()
    return jsonify(_company_json(g.company))


# ---------------------------------------------------------------------------
# Team members (owner / admin)
# ---------------------------------------------------------------------------

def _team():
    return db_session.query(User).filter_by(company_id=g.company_id)


def _team_member(pk):
    user = _team().filter_by(id=pk).first()
    if user is None:
        raise ApiError('User not found', 404)
    return user


def _role(data, existing=None):
    role = data.get('role') or (existing.role if existing else None)
    if role not in ROLES:
        raise ApiError('Please choose a role.')
    touching_owner = role == 'owner' or (existing is not None and existing.role == 'owner')
    if touching_owner and g.user.role != 'owner':
        raise ApiError('Only a company owner can manage owner accounts.', 403)
    return role


def _other_active_owners(user):
    return _team().filter(User.role == 'owner', User.is_active.is_(True), User.id != user.id).count()


@auth_bp.get('/users')
def users_list():
    return jsonify([_user_json(u) for u in _team().order_by(User.name)])


@auth_bp.post('/users')
def users_create():
    data = request.get_json(silent=True) or {}
    email = _email(data)
    if db_session.query(User).filter_by(email=email).first():
        raise ApiError('That email address is already registered.')
    user = User(company_id=g.company_id, name=_text(data, 'name', 100, 'Name', required=True),
                email=email, role=_role(data), password_hash=generate_password_hash(_password(data)),
                is_active=data.get('is_active', True) is not False)
    db_session.add(user)
    db_session.commit()
    return jsonify(_user_json(user)), 201


@auth_bp.put('/users/<int:pk>')
def users_update(pk):
    user = _team_member(pk)
    data = request.get_json(silent=True) or {}
    role = _role(data, user)
    active = data.get('is_active', user.is_active) is not False
    if user.role == 'owner' and (role != 'owner' or not active) and not _other_active_owners(user):
        raise ApiError('A company must keep at least one active owner.')
    if user.id == g.user.id and not active:
        raise ApiError('You cannot deactivate your own account.')
    email = _email(data) if data.get('email') else user.email
    if email != user.email and db_session.query(User).filter_by(email=email).first():
        raise ApiError('That email address is already registered.')
    user.name = _text(data, 'name', 100) or user.name
    user.email, user.role, user.is_active = email, role, active
    password = _password(data, required=False)
    if password:
        user.password_hash = generate_password_hash(password)
        if user.id == g.user.id:
            session['pv'] = _password_version(user)
    db_session.commit()
    return jsonify(_user_json(user))


@auth_bp.delete('/users/<int:pk>')
def users_delete(pk):
    user = _team_member(pk)
    if user.id == g.user.id:
        raise ApiError('You cannot delete your own account.')
    if user.role == 'owner':
        if g.user.role != 'owner':
            raise ApiError('Only a company owner can manage owner accounts.', 403)
        if not _other_active_owners(user):
            raise ApiError('A company must keep at least one active owner.')
    db_session.query(AuditLog).filter_by(user_id=user.id).update({AuditLog.user_id: None})
    db_session.delete(user)
    db_session.commit()
    return jsonify(ok=True)


@auth_bp.get('/audit-log')
def audit_log():
    rows = db_session.query(AuditLog).filter_by(company_id=g.company_id) \
        .order_by(AuditLog.date_created.desc(), AuditLog.id.desc()).limit(300)
    return jsonify([{'id': r.id, 'user_name': r.user_name, 'action': r.action, 'path': r.path,
                     'date_created': r.date_created.isoformat() if r.date_created else None}
                    for r in rows])


protect(auth_bp)
