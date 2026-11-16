"""WhatsApp sales desk: shows the people who chatted with the company's WhatsApp bot.

The bot (a separate service) stores contacts, messages and quote requests in tables of the same
database. This module reads them, scores them with the same rules as the bot (lead_rules.py) and lets
staff update the sales stage, notes, follow-up date, owner and the "pause the bot" switch.
Only the company named in WHATSAPP_COMPANY_ID can use it, because one bot serves one company.
"""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone

import sqlalchemy as sa
from flask import Blueprint, g, jsonify, request

import lead_rules
from auth import ApiError, protect, whatsapp_enabled
from database import db_session, engine

bp = Blueprint('whatsapp', __name__, url_prefix='/api/whatsapp')

CONTACT_COLUMNS = ('who, name, first_seen, last_inbound, last_outbound, inbound_count, signals, '
                   'stage, notes, follow_up, assigned, bot_paused')


def _need_whatsapp():
    if not whatsapp_enabled(g.company_id):
        raise ApiError('WhatsApp is not connected for this company.', 404)
    if not sa.inspect(engine).has_table('contacts'):
        return False  # the bot has not stored anything yet
    return True


def _when(value):
    """Datetime from either a database datetime or an ISO string, always timezone-aware."""
    if value is None or value == '':
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value):
    value = _when(value)
    return value.isoformat() if value else None


def _contact(row):
    m = row._mapping
    try:
        signals = json.loads(m['signals'] or '{}')
    except ValueError:
        signals = {}
    return {'who': m['who'], 'name': m['name'] or '', 'first_seen': _when(m['first_seen']),
            'last_inbound': _when(m['last_inbound']), 'last_outbound': _when(m['last_outbound']),
            'inbound_count': m['inbound_count'] or 0, 'signals': signals, 'stage': m['stage'] or 'new',
            'notes': m['notes'] or '', 'follow_up': m['follow_up'] or '', 'assigned': m['assigned'] or '',
            'bot_paused': bool(m['bot_paused'])}


def _client_json(contact):
    out = dict(contact)
    for key in ('first_seen', 'last_inbound', 'last_outbound'):
        out[key] = _iso(contact[key])
    return out | lead_rules.analyse(contact)


@bp.get('/clients')
def clients():
    if not _need_whatsapp():
        return jsonify(clients=[], stages=list(lead_rules.STAGES), connected=False)
    rows = db_session.execute(sa.text(f'SELECT {CONTACT_COLUMNS} FROM contacts')).fetchall()
    out = [_client_json(_contact(r)) for r in rows]
    out.sort(key=lambda c: (not c['follow_up_due'], c['stage'] in ('won', 'lost'), -c['score'],
                            c['last_inbound'] or ''))
    return jsonify(clients=out, stages=list(lead_rules.STAGES), connected=True)


def _find(who):
    row = db_session.execute(sa.text(f'SELECT {CONTACT_COLUMNS} FROM contacts WHERE who = :w'),
                             {'w': who}).first()
    if row is None:
        raise ApiError('Contact not found', 404)
    return _contact(row)


@bp.get('/clients/<path:who>')
def client(who):
    if not _need_whatsapp():
        raise ApiError('No WhatsApp chats yet.', 404)
    contact = _find(who)
    messages = db_session.execute(
        sa.text('SELECT created, direction, sender, text FROM messages WHERE who = :w '
                'ORDER BY created DESC LIMIT 300'), {'w': who}).fetchall()
    phone = contact['signals'].get('contact', '')
    requests = db_session.execute(
        sa.text('SELECT created, kind, need, location, suggested FROM leads '
                'WHERE phone = :w OR (:p <> \'\' AND phone = :p) ORDER BY created DESC LIMIT 50'),
        {'w': who, 'p': phone}).fetchall()
    return jsonify(
        client=_client_json(contact),
        messages=[{'created': _iso(r.created), 'direction': r.direction, 'sender': r.sender or '',
                   'text': r.text} for r in reversed(messages)],
        requests=[{'created': _iso(r.created), 'kind': r.kind, 'need': r.need, 'location': r.location,
                   'suggested': r.suggested} for r in requests])


@bp.patch('/clients/<path:who>')
def client_update(who):
    if not _need_whatsapp():
        raise ApiError('No WhatsApp chats yet.', 404)
    _find(who)
    data = request.get_json(silent=True) or {}
    changes = {}
    if 'stage' in data:
        if data['stage'] not in lead_rules.STAGES:
            raise ApiError('Unknown stage.')
        changes['stage'] = data['stage']
    if 'follow_up' in data:
        value = str(data['follow_up'] or '')
        if value and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ApiError('Follow-up date must be YYYY-MM-DD.')
        changes['follow_up'] = value
    if 'notes' in data:
        changes['notes'] = str(data['notes'] or '').strip()[:2000]
    if 'assigned' in data:
        changes['assigned'] = str(data['assigned'] or '').strip()[:100]
    if 'bot_paused' in data:
        changes['bot_paused'] = bool(data['bot_paused'])
    if changes:
        assignments = ', '.join(f'{k} = :{k}' for k in changes)  # keys are fixed names above
        db_session.execute(sa.text(f'UPDATE contacts SET {assignments} WHERE who = :who'),
                           {**changes, 'who': who})
        db_session.commit()
    return jsonify(client=_client_json(_find(who)))


def _bot():
    """Bot address and shared key; replies go through the bot because it holds the WhatsApp token."""
    url = os.getenv('WHATSAPP_BOT_URL', '').rstrip('/')
    key = os.getenv('WHATSAPP_INTERNAL_KEY', '')
    return (url, key) if url and key else (None, None)


@bp.post('/clients/<path:who>/reply')
def client_reply(who):
    if not _need_whatsapp():
        raise ApiError('No WhatsApp chats yet.', 404)
    _find(who)
    text = str((request.get_json(silent=True) or {}).get('text') or '').strip()[:1000]
    if not text:
        raise ApiError('Type a message first.')
    url, key = _bot()
    if not url:
        raise ApiError('Replying from here is not set up yet (WHATSAPP_BOT_URL / WHATSAPP_INTERNAL_KEY).', 503)
    req = urllib.request.Request(
        f'{url}/internal/reply', method='POST',
        data=json.dumps({'who': who, 'text': text, 'by': g.user.name}).encode(),
        headers={'Content-Type': 'application/json', 'X-Internal-Key': key})
    try:
        # the free bot service may be asleep; waking it can take close to a minute
        with urllib.request.urlopen(req, timeout=75) as resp:
            json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read() or b'{}').get('error')
        except ValueError:
            message = None
        raise ApiError(message or f'The WhatsApp bot refused the message ({exc.code}).',
                       400 if exc.code < 500 else 502)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ApiError('Could not reach the WhatsApp bot. Try again in a minute.', 502)
    db_session.expire_all()  # the bot updated the contact; read fresh values
    return jsonify(client=_client_json(_find(who)))


protect(bp)
