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

from . import lead_rules
from .auth import ApiError, protect, whatsapp_enabled
from .database import db_session, engine
from .models import Customer

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


def _bot_call(path, payload=None, timeout=75):
    """POST to the bot's internal API (it holds the language model) and return its JSON answer."""
    url, key = _bot()
    if not url:
        raise ApiError('The bot is not connected yet (WHATSAPP_BOT_URL / WHATSAPP_INTERNAL_KEY).', 503)
    req = urllib.request.Request(
        f'{url}{path}', method='POST', data=json.dumps(payload or {}).encode(),
        headers={'Content-Type': 'application/json', 'X-Internal-Key': key})
    try:
        # the free bot service may be asleep; waking it can take close to a minute
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read() or b'{}').get('error')
        except ValueError:
            message = None
        raise ApiError(message or f'The bot refused the request ({exc.code}).', 400 if exc.code < 500 else 502)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ApiError('Could not reach the WhatsApp bot. Try again in a minute.', 502)


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


# ---------------------------------------------------------------------------
# Enquiries: what each customer wants (purchase / enquiry / maintenance) with a priority
# ---------------------------------------------------------------------------
PRIORITIES = ('low', 'medium', 'high', 'urgent')
CATEGORIES = ('purchase', 'enquiry', 'maintenance')
ENQUIRY_COLUMNS = ('id, who, name, category, intent, priority, reasons, status, summary, last_text, '
                   'message_count, created, updated, handled_by')


def _has(table):
    return sa.inspect(engine).has_table(table)


def _digits_tail(value):
    """Last 9 digits of a phone number, so +263 77 123 4567 matches 0771234567."""
    digits = re.sub(r'\D', '', value or '')
    return digits[-9:] if len(digits) >= 9 else ''


def _customer_phones():
    """{last-9-digits: customer name} for this company's customers."""
    out = {}
    for name, surname, phone in db_session.query(Customer.name, Customer.surname, Customer.phone):
        key = _digits_tail(phone)
        if key:
            out[key] = ' '.join(x for x in (name, surname) if x)
    return out


def _bump(priority):
    return PRIORITIES[min(PRIORITIES.index(priority) + 1, len(PRIORITIES) - 1)]


def _enquiry_json(row, contacts, customers):
    m = row._mapping
    try:
        reasons = json.loads(m['reasons'] or '[]')
    except ValueError:
        reasons = []
    who = m['who']
    contact = contacts.get(who, {})
    phone = (contact.get('signals') or {}).get('contact') or ('' if who.startswith('web:') else who)
    existing = customers.get(_digits_tail(phone) or _digits_tail(who))
    priority = m['priority'] if m['priority'] in PRIORITIES else 'medium'
    # an existing customer's fault matters more: they already trust and pay us
    if existing and m['category'] == 'maintenance' and priority in ('medium', 'high'):
        priority = _bump(priority)
        reasons = reasons + ['Existing customer']
    return {'id': m['id'], 'who': who, 'name': m['name'] or contact.get('name') or '',
            'phone': phone.lstrip('+'), 'is_whatsapp': not who.startswith('web:'),
            'category': m['category'], 'intent': m['intent'] or '',
            'priority': priority, 'reasons': reasons, 'status': m['status'], 'summary': m['summary'] or '',
            'last_text': m['last_text'] or '', 'message_count': m['message_count'] or 0,
            'created': _iso(m['created']), 'updated': _iso(m['updated']), 'handled_by': m['handled_by'] or '',
            'existing_customer': existing or '', 'stage': contact.get('stage', 'new'),
            'bot_paused': bool(contact.get('bot_paused')), 'last_inbound': _iso(contact.get('last_inbound'))}


@bp.get('/enquiries')
def enquiries():
    if not whatsapp_enabled(g.company_id):
        raise ApiError('WhatsApp is not connected for this company.', 404)
    if not _has('enquiries'):
        return jsonify(enquiries=[], counts={}, connected=False, priorities=list(PRIORITIES),
                       categories=list(CATEGORIES))
    status = request.args.get('status', 'open')
    where, params = '', {}
    if status in ('open', 'handled'):
        where, params = 'WHERE status = :s', {'s': status}
    rows = db_session.execute(sa.text(f'SELECT {ENQUIRY_COLUMNS} FROM enquiries {where} '
                                      'ORDER BY updated DESC LIMIT 500'), params).fetchall()
    contacts = {}
    if _has('contacts'):
        contacts = {r.who: _contact(r) for r in db_session.execute(
            sa.text(f'SELECT {CONTACT_COLUMNS} FROM contacts')).fetchall()}
    customers = _customer_phones()
    out = [_enquiry_json(r, contacts, customers) for r in rows]
    # most urgent first; within a priority, the most recently active first
    out.sort(key=lambda e: e['updated'] or '', reverse=True)
    out.sort(key=lambda e: -PRIORITIES.index(e['priority']))
    counts = {'total': len(out)}
    for e in out:
        counts[e['category']] = counts.get(e['category'], 0) + 1
        counts[e['priority']] = counts.get(e['priority'], 0) + 1
    return jsonify(enquiries=out, counts=counts, connected=True, priorities=list(PRIORITIES),
                   categories=list(CATEGORIES))


@bp.patch('/enquiries/<int:enquiry_id>')
def enquiry_update(enquiry_id):
    if not _has('enquiries'):
        raise ApiError('No enquiries yet.', 404)
    data = request.get_json(silent=True) or {}
    changes = {}
    if 'status' in data:
        if data['status'] not in ('open', 'handled'):
            raise ApiError('Unknown status.')
        changes['status'] = data['status']
        changes['handled_by'] = g.user.name if data['status'] == 'handled' else ''
    if 'priority' in data:
        if data['priority'] not in PRIORITIES:
            raise ApiError('Unknown priority.')
        changes['priority'] = data['priority']
    if 'category' in data:
        if data['category'] not in CATEGORIES:
            raise ApiError('Unknown category.')
        changes['category'] = data['category']
    if not changes:
        raise ApiError('Nothing to change.')
    assignments = ', '.join(f'{k} = :{k}' for k in changes)  # keys are fixed names above
    result = db_session.execute(sa.text(f'UPDATE enquiries SET {assignments} WHERE id = :id'),
                                {**changes, 'id': enquiry_id})
    if not result.rowcount:
        raise ApiError('Enquiry not found.', 404)
    db_session.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Training the bot: intents, example phrases, unmatched messages (owners, admins and managers only)
# ---------------------------------------------------------------------------
HANDLERS = {'reply': 'Answer with the reply text', 'purchase': 'Start a quotation',
            'maintenance': 'Start a maintenance request', 'packages': 'Show packages and prices',
            'sizing': 'Recommend a system size', 'human': 'Hand over to a person',
            'contact': 'Give contact details and hours', 'greeting': 'Greet', 'thanks': 'Say you are welcome',
            'answer_team': 'Answer, collect details, hand to the team', 'answer_alert': 'Answer and alert the team now',
            'goodbye': 'Say goodbye', 'affirm': 'Treat as "yes"', 'deny': 'Treat as "no"'}
ALL_CATEGORIES = ('purchase', 'enquiry', 'maintenance', 'other')


def _need_trainer():
    if not whatsapp_enabled(g.company_id):
        raise ApiError('WhatsApp is not connected for this company.', 404)
    if request.method != 'GET' and g.user.role not in ('owner', 'admin', 'manager'):
        raise ApiError('Only owners, admins and managers can train the bot.', 403)
    if not _has('nlu_intents'):
        raise ApiError('The bot has not set up its language model yet. Open the bot service once so it can '
                       'create its tables, then reload this page.', 409)


@bp.get('/training')
def training():
    _need_trainer()
    intents = db_session.execute(sa.text(
        'SELECT i.name, i.category, i.priority, i.handler, i.replies, i.enabled, '
        '(SELECT COUNT(*) FROM nlu_examples e WHERE e.intent = i.name) AS examples '
        'FROM nlu_intents i ORDER BY i.category, i.name')).fetchall()
    out = []
    for r in intents:
        try:
            replies = json.loads(r.replies or '[]')
        except ValueError:
            replies = []
        out.append({'name': r.name, 'category': r.category, 'priority': r.priority, 'handler': r.handler,
                    'replies': replies, 'enabled': bool(r.enabled), 'examples': r.examples})
    unmatched = db_session.execute(sa.text("SELECT COUNT(*) FROM nlu_unmatched WHERE status = 'new'")).scalar() or 0
    return jsonify(intents=out, unmatched=unmatched, handlers=HANDLERS, categories=list(ALL_CATEGORIES),
                   priorities=list(PRIORITIES))


@bp.get('/training/intents/<name>/examples')
def training_examples(name):
    _need_trainer()
    rows = db_session.execute(sa.text('SELECT id, text, source FROM nlu_examples WHERE intent = :n ORDER BY id DESC'),
                              {'n': name}).fetchall()
    return jsonify(examples=[{'id': r.id, 'text': r.text, 'source': r.source} for r in rows])


_NAME = re.compile(r'[a-z][a-z0-9_]{1,58}')


@bp.put('/training/intents/<name>')
def training_intent_save(name):
    _need_trainer()
    if not _NAME.fullmatch(name):
        raise ApiError('Use a short name with lowercase letters, numbers and underscores, e.g. battery_question.')
    d = request.get_json(silent=True) or {}
    category = d.get('category', 'enquiry')
    priority = d.get('priority', 'medium')
    handler = d.get('handler', 'reply')
    if category not in ALL_CATEGORIES or priority not in PRIORITIES or handler not in HANDLERS:
        raise ApiError('Unknown category, priority or action.')
    replies = [str(x).strip()[:1000] for x in (d.get('replies') or []) if str(x).strip()][:10]
    if handler == 'reply' and not replies:
        raise ApiError('Add at least one reply for the bot to say.')
    params = {'n': name, 'c': category, 'p': priority, 'h': handler, 'r': json.dumps(replies),
              'e': bool(d.get('enabled', True)), 'u': datetime.now(timezone.utc)}
    if db_session.execute(sa.text('SELECT 1 FROM nlu_intents WHERE name = :n'), {'n': name}).first():
        db_session.execute(sa.text('UPDATE nlu_intents SET category=:c, priority=:p, handler=:h, replies=:r, '
                                   'enabled=:e, updated=:u WHERE name=:n'), params)
    else:
        db_session.execute(sa.text('INSERT INTO nlu_intents (name, category, priority, handler, replies, enabled, '
                                   'updated) VALUES (:n, :c, :p, :h, :r, :e, :u)'), params)
    db_session.commit()
    return jsonify(ok=True)


@bp.delete('/training/intents/<name>')
def training_intent_delete(name):
    _need_trainer()
    db_session.execute(sa.text('DELETE FROM nlu_examples WHERE intent = :n'), {'n': name})
    db_session.execute(sa.text('DELETE FROM nlu_intents WHERE name = :n'), {'n': name})
    db_session.commit()
    return jsonify(ok=True)


def _insert_example(intent, text, source):
    db_session.execute(sa.text('INSERT INTO nlu_examples (intent, text, source, created) VALUES (:i, :t, :s, :c)'),
                       {'i': intent, 't': text, 's': source, 'c': datetime.now(timezone.utc)})


@bp.post('/training/examples')
def training_examples_add():
    """Add one or many example phrases (one per line) to an intent."""
    _need_trainer()
    d = request.get_json(silent=True) or {}
    intent = str(d.get('intent') or '')
    if not db_session.execute(sa.text('SELECT 1 FROM nlu_intents WHERE name = :n'), {'n': intent}).first():
        raise ApiError('Choose an intent first.')
    lines = [' '.join(x.split())[:500] for x in str(d.get('text') or '').splitlines()]
    lines = list(dict.fromkeys(x for x in lines if x))[:200]
    if not lines:
        raise ApiError('Type at least one example phrase.')
    have = {r.text for r in db_session.execute(sa.text('SELECT text FROM nlu_examples WHERE intent = :n'),
                                               {'n': intent})}
    added = 0
    for text in lines:
        if text not in have:
            _insert_example(intent, text, 'staff')
            added += 1
    db_session.commit()
    return jsonify(added=added, skipped=len(lines) - added)


@bp.delete('/training/examples/<int:example_id>')
def training_example_delete(example_id):
    _need_trainer()
    db_session.execute(sa.text('DELETE FROM nlu_examples WHERE id = :i'), {'i': example_id})
    db_session.commit()
    return jsonify(ok=True)


@bp.get('/training/unmatched')
def training_unmatched():
    _need_trainer()
    rows = db_session.execute(sa.text(
        "SELECT id, text, guess, confidence, created FROM nlu_unmatched WHERE status = 'new' "
        'ORDER BY created DESC LIMIT 200')).fetchall()
    return jsonify(items=[{'id': r.id, 'text': r.text, 'guess': r.guess or '', 'confidence': r.confidence or 0,
                           'created': _iso(r.created)} for r in rows])


@bp.post('/training/unmatched/<int:item_id>')
def training_unmatched_label(item_id):
    """Say what a message really meant ('ignore' dismisses it); it then becomes a training example."""
    _need_trainer()
    intent = str((request.get_json(silent=True) or {}).get('intent') or '')
    row = db_session.execute(sa.text('SELECT text FROM nlu_unmatched WHERE id = :i'), {'i': item_id}).first()
    if row is None:
        raise ApiError('Message not found.', 404)
    if intent != 'ignore':
        if not db_session.execute(sa.text('SELECT 1 FROM nlu_intents WHERE name = :n'), {'n': intent}).first():
            raise ApiError('Choose an intent.')
        if not db_session.execute(sa.text('SELECT 1 FROM nlu_examples WHERE intent = :n AND text = :t'),
                                  {'n': intent, 't': row.text}).first():
            _insert_example(intent, row.text, 'chat')
    db_session.execute(sa.text('UPDATE nlu_unmatched SET status = :s, label = :l WHERE id = :i'),
                       {'s': 'ignored' if intent == 'ignore' else 'labelled',
                        'l': '' if intent == 'ignore' else intent, 'i': item_id})
    db_session.commit()
    return jsonify(ok=True)


@bp.post('/training/test')
def training_test():
    _need_trainer()
    text = str((request.get_json(silent=True) or {}).get('text') or '').strip()[:500]
    if not text:
        raise ApiError('Type a message to test.')
    return jsonify(_bot_call('/internal/nlu/test', {'text': text}))


@bp.get('/training/status')
def training_status():
    _need_trainer()
    url, key = _bot()
    if not url:
        return jsonify(connected=False)
    req = urllib.request.Request(f'{url}/internal/nlu/status', headers={'X-Internal-Key': key})
    try:
        with urllib.request.urlopen(req, timeout=75) as resp:
            return jsonify(connected=True, **json.loads(resp.read() or b'{}'))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return jsonify(connected=False)


protect(bp)
