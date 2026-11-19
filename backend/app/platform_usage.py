"""Platform usage report: how much each company uses the software every day, for the person who runs the platform
(and sells it to solar companies) to price it from real consumption. Only emails listed in PLATFORM_ADMIN_EMAILS
can open it.

Sources, all read-only:
  usage_daily / usage_users   API calls and active users (counted by usage.py)
  business tables             new records per day and records stored, per company
  messages (WhatsApp bot)     messages and conversations per day, for the company in WHATSAPP_COMPANY_ID
  the database itself         total size (PostgreSQL)
"""
import os
from datetime import datetime, timedelta

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text

from . import usage
from .auth import ApiError, is_operator, protect
from .database import db_session, engine

platform_bp = Blueprint('platform', __name__, url_prefix='/api/platform')

# one row per thing a company creates (item tables are left out of "new records" but counted as stored)
CREATED = ('customers', 'suppliers', 'inventory', 'stock_transactions', 'activities', 'quotations', 'invoices',
           'payments', 'financial_records', 'fuel_records', 'mileage_records', 'journey_records')
STORED = CREATED + ('quotation_items', 'invoice_items', 'activity_types', 'locations', 'pricing', 'financial_categories')


def _day(value):
    return str(value)[:10]


def _rows(sql, **params):
    return db_session.execute(text(sql), params).all()


def _whatsapp_company_id():
    raw = os.environ.get('WHATSAPP_COMPANY_ID', '').strip()
    return int(raw) if raw.isdigit() else None


def _whatsapp_by_day(since):
    """{day: (messages, conversations)} from the bot's messages table, or {} when there is none."""
    try:
        rows = _rows(
            'SELECT date(created) AS d, COUNT(*) AS n, COUNT(DISTINCT who) AS people FROM messages '
            'WHERE created >= :since GROUP BY date(created)', since=since)
    except Exception:
        db_session.rollback()
        return {}
    return {_day(d): (int(n), int(people)) for d, n, people in rows}


def _database_bytes():
    if engine.dialect.name != 'postgresql':
        return None
    try:
        return int(_rows('SELECT pg_database_size(current_database())')[0][0])
    except Exception:
        db_session.rollback()
        return None


@platform_bp.get('/usage')
def usage_report():
    if not is_operator(g.user):
        raise ApiError('Only the platform operator can see this.', 403)
    try:
        days = max(1, min(int(request.args.get('days', 30)), 180))
    except ValueError:
        days = 30
    usage.flush()                                    # include what is still waiting in memory
    today = datetime.utcnow().date()
    start = today - timedelta(days=days - 1)
    labels = [str(start + timedelta(days=i)) for i in range(days)]
    since = datetime.combine(start, datetime.min.time())

    companies = {r.id: {'id': r.id, 'name': r.name, 'active': bool(r.is_active), 'created': _day(r.date_created),
                        'users': 0, 'series': {d: {'requests': 0, 'writes': 0, 'active_users': 0,
                                                    'new_records': 0, 'whatsapp_messages': 0,
                                                    'whatsapp_conversations': 0} for d in labels},
                        'stored_records': 0}
                 for r in _rows('SELECT id, name, is_active, date_created FROM companies ORDER BY id')}
    for company_id, n in _rows('SELECT company_id, COUNT(*) FROM users WHERE is_active = :a GROUP BY company_id', a=True):
        if company_id in companies:
            companies[company_id]['users'] = n

    for company_id, day, requests, writes in _rows(
            'SELECT company_id, day, requests, writes FROM usage_daily WHERE day >= :s', s=start):
        row = companies.get(company_id, {}).get('series', {}).get(_day(day))
        if row is not None:
            row['requests'], row['writes'] = requests, writes
    for company_id, day, n in _rows(
            'SELECT company_id, day, COUNT(*) FROM usage_users WHERE day >= :s GROUP BY company_id, day', s=start):
        row = companies.get(company_id, {}).get('series', {}).get(_day(day))
        if row is not None:
            row['active_users'] = n

    for table in CREATED:
        for company_id, day, n in _rows(
                f'SELECT company_id, date(date_created) AS d, COUNT(*) FROM {table} '    # table names are fixed above
                'WHERE company_id IS NOT NULL AND date_created >= :since GROUP BY company_id, date(date_created)',
                since=since):
            row = companies.get(company_id, {}).get('series', {}).get(_day(day))
            if row is not None:
                row['new_records'] += n
    for table in STORED:
        for company_id, n in _rows(f'SELECT company_id, COUNT(*) FROM {table} WHERE company_id IS NOT NULL '
                                   'GROUP BY company_id'):
            if company_id in companies:
                companies[company_id]['stored_records'] += n

    wa_company = _whatsapp_company_id()
    if wa_company in companies:
        for day, (messages, people) in _whatsapp_by_day(since).items():
            row = companies[wa_company]['series'].get(day)
            if row is not None:
                row['whatsapp_messages'], row['whatsapp_conversations'] = messages, people

    out = []
    for c in companies.values():
        series = [{'day': d, **c['series'][d]} for d in labels]
        total = {k: sum(r[k] for r in series) for k in ('requests', 'writes', 'active_users', 'new_records',
                                                        'whatsapp_messages', 'whatsapp_conversations')}
        used_days = sum(1 for r in series if r['requests'] > 0)
        out.append({
            'id': c['id'], 'name': c['name'], 'active': c['active'], 'created': c['created'], 'users': c['users'],
            'stored_records': c['stored_records'], 'whatsapp': c['id'] == wa_company,
            'totals': total, 'days_used': used_days,
            'per_day': {k: round(v / days, 1) for k, v in total.items()},
            'series': series,
        })
    out.sort(key=lambda c: c['totals']['requests'], reverse=True)
    grand = {k: sum(c['totals'][k] for c in out) for k in out[0]['totals']} if out else {}
    return jsonify({'days': days, 'from': labels[0], 'to': labels[-1], 'companies': out, 'totals': grand,
                    'database_bytes': _database_bytes(), 'operator': g.user.email})


protect(platform_bp)
