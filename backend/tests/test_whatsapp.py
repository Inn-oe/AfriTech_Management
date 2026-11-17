"""Enquiries and bot-training endpoints, against the tables the WhatsApp bot creates in the shared database."""
import uuid

import pytest
import sqlalchemy as sa

from app.database import engine

BOT_TABLES = [
    """CREATE TABLE IF NOT EXISTS contacts (who VARCHAR(80) PRIMARY KEY, name VARCHAR(200), first_seen TIMESTAMP,
       last_inbound TIMESTAMP, last_outbound TIMESTAMP, inbound_count INTEGER, signals TEXT, stage VARCHAR(20),
       notes TEXT, follow_up VARCHAR(10), assigned VARCHAR(100), bot_paused BOOLEAN)""",
    """CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, who VARCHAR(80), name VARCHAR(200),
       category VARCHAR(20), intent VARCHAR(60), priority VARCHAR(10), reasons TEXT, status VARCHAR(12), summary TEXT,
       last_text TEXT, message_count INTEGER, confidence FLOAT, created TIMESTAMP, updated TIMESTAMP,
       handled_by VARCHAR(100))""",
    """CREATE TABLE IF NOT EXISTS nlu_intents (name VARCHAR(60) PRIMARY KEY, category VARCHAR(20), priority VARCHAR(10),
       handler VARCHAR(20), replies TEXT, enabled BOOLEAN, updated TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS nlu_examples (id INTEGER PRIMARY KEY AUTOINCREMENT, intent VARCHAR(60), text VARCHAR(500),
       source VARCHAR(12), created TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS nlu_unmatched (id INTEGER PRIMARY KEY AUTOINCREMENT, who VARCHAR(80), text VARCHAR(500),
       guess VARCHAR(60), confidence FLOAT, status VARCHAR(12), label VARCHAR(60), created TIMESTAMP)""",
]


@pytest.fixture()
def wa(client, monkeypatch):
    """A logged-in owner whose company is the one served by the bot, with the bot's tables in place."""
    r = client.post('/api/auth/signup', json={'company_name': 'Sun Co', 'name': 'Ann Owner',
                                              'email': f'ann-{uuid.uuid4().hex[:8]}@example.com', 'password': 'a-long-password'},
                    headers={'X-Requested-With': 'fetch'})
    assert r.status_code == 201, r.get_json()
    monkeypatch.setenv('WHATSAPP_COMPANY_ID', str(r.get_json()['company']['id']))
    with engine.begin() as conn:
        for ddl in BOT_TABLES:
            conn.execute(sa.text(ddl))
        for t in ('contacts', 'enquiries', 'nlu_intents', 'nlu_examples', 'nlu_unmatched'):
            conn.execute(sa.text(f'DELETE FROM {t}'))
    return client


H = {'X-Requested-With': 'fetch'}


def _add_enquiry(who, category, priority, summary, name=''):
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO enquiries (who, name, category, intent, priority, reasons, status, summary, last_text, "
            "message_count, confidence, created, updated) VALUES (:w, :n, :c, 'x', :p, '[]', 'open', :s, :s, 1, 0.9, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {'w': who, 'n': name, 'c': category, 'p': priority, 's': summary})


def test_enquiries_are_sorted_by_priority_and_counted(wa):
    _add_enquiry('263771111111', 'enquiry', 'low', 'How long do panels last?', 'Low Larry')
    _add_enquiry('263772222222', 'maintenance', 'urgent', 'Inverter smoking', 'Urgent Una')
    _add_enquiry('263773333333', 'purchase', 'high', '5kVA system in Harare', 'Buyer Bob')
    body = wa.get('/api/whatsapp/enquiries').get_json()
    assert [e['priority'] for e in body['enquiries']] == ['urgent', 'high', 'low']
    assert body['counts']['maintenance'] == 1 and body['counts']['purchase'] == 1 and body['counts']['urgent'] == 1


def test_existing_customer_fault_is_bumped(wa):
    r = wa.post('/api/customers', json={'identification_number': 'ID-1', 'name': 'Known', 'surname': 'Client',
                                        'phone': '0773 333 333'}, headers=H)
    assert r.status_code in (200, 201), r.get_json()
    _add_enquiry('263773333333', 'maintenance', 'medium', 'Needs a service')
    e = wa.get('/api/whatsapp/enquiries').get_json()['enquiries'][0]
    assert e['priority'] == 'high' and e['existing_customer'] == 'Known Client'


def test_mark_enquiry_handled(wa):
    _add_enquiry('263771111111', 'purchase', 'high', 'Wants solar')
    eid = wa.get('/api/whatsapp/enquiries').get_json()['enquiries'][0]['id']
    assert wa.patch(f'/api/whatsapp/enquiries/{eid}', json={'status': 'handled'}, headers=H).status_code == 200
    assert wa.get('/api/whatsapp/enquiries').get_json()['enquiries'] == []
    assert len(wa.get('/api/whatsapp/enquiries?status=handled').get_json()['enquiries']) == 1
    assert wa.patch(f'/api/whatsapp/enquiries/{eid}', json={'priority': 'nope'}, headers=H).status_code == 400


def test_training_intent_and_examples_roundtrip(wa):
    put = wa.put('/api/whatsapp/training/intents/battery_question', headers=H,
                 json={'category': 'enquiry', 'priority': 'low', 'handler': 'reply',
                       'replies': ['Lithium lasts longer.', 'Gel is cheaper.']})
    assert put.status_code == 200
    assert wa.put('/api/whatsapp/training/intents/Bad Name', headers=H, json={}).status_code in (400, 404)
    assert wa.put('/api/whatsapp/training/intents/no_reply', headers=H, json={'handler': 'reply'}).status_code == 400

    add = wa.post('/api/whatsapp/training/examples', headers=H,
                  json={'intent': 'battery_question', 'text': 'which battery is best\nlithium or gel\nwhich battery is best'})
    assert add.get_json() == {'added': 2, 'skipped': 0}
    listing = wa.get('/api/whatsapp/training').get_json()
    row = next(i for i in listing['intents'] if i['name'] == 'battery_question')
    assert row['examples'] == 2 and row['replies'] == ['Lithium lasts longer.', 'Gel is cheaper.']
    ex = wa.get('/api/whatsapp/training/intents/battery_question/examples').get_json()['examples']
    assert wa.delete(f"/api/whatsapp/training/examples/{ex[0]['id']}", headers=H).status_code == 200
    assert wa.delete('/api/whatsapp/training/intents/battery_question', headers=H).status_code == 200
    assert wa.get('/api/whatsapp/training').get_json()['intents'] == []


def test_unmatched_message_becomes_an_example(wa):
    wa.put('/api/whatsapp/training/intents/greeting', headers=H,
           json={'category': 'other', 'priority': 'low', 'handler': 'greeting', 'replies': ['Hi']})
    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO nlu_unmatched (who, text, guess, confidence, status, created) "
                             "VALUES ('263770000000', 'howzit boss', '', 0.1, 'new', CURRENT_TIMESTAMP)"))
    item = wa.get('/api/whatsapp/training/unmatched').get_json()['items'][0]
    assert wa.post(f"/api/whatsapp/training/unmatched/{item['id']}", headers=H, json={'intent': 'greeting'}).status_code == 200
    assert wa.get('/api/whatsapp/training/unmatched').get_json()['items'] == []
    ex = wa.get('/api/whatsapp/training/intents/greeting/examples').get_json()['examples']
    assert [e['text'] for e in ex] == ['howzit boss']


def test_whatsapp_is_hidden_from_other_companies(client, monkeypatch):
    client.post('/api/auth/signup', json={'company_name': 'Other', 'name': 'Olu', 'email': f'olu-{uuid.uuid4().hex[:8]}@example.com',
                                          'password': 'a-long-password'}, headers=H)
    monkeypatch.setenv('WHATSAPP_COMPANY_ID', '99999')
    assert client.get('/api/whatsapp/enquiries').status_code == 404
    assert client.get('/api/whatsapp/training').status_code == 404
