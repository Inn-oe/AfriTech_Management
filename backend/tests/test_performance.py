"""List pages must load their related rows together, not one query per row (this made the live system slow:
the quotation list used 532 queries for 296 quotations)."""
import itertools
from datetime import datetime, timedelta

from sqlalchemy import event

from app.database import db_session, engine
from app.models import (Customer, Invoice, InvoiceItem, InvoiceStatus, Payment, quotation, quotationItem)

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def company_with_data(app, rows=40):
    n = next(_n)
    client = app.test_client()
    resp = client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Perf Co {n}', 'name': 'Owner', 'email': f'perf{n}@example.test', 'password': 'a-long-password'})
    assert resp.status_code == 201
    cid = resp.get_json()['company']['id']
    now = datetime.utcnow()
    with app.app_context():
        customers = [Customer(identification_number=f'PF{n}{i:04d}', name=f'N{i}', company_id=cid) for i in range(rows)]
        db_session.add_all(customers)
        db_session.flush()
        for i in range(rows):
            q = quotation(customer_id=customers[i].identification_number, total_amount=100, company_id=cid,
                          quotation_number=f'PQ{n}-{i}', date_created=now - timedelta(days=i))
            q.items = [quotationItem(quantity=1, unit_price=10, description='part', company_id=cid) for _ in range(5)]
            inv = Invoice(customer_id=customers[i].identification_number, total_amount=100, paid_amount=50, balance_due=50,
                          status=InvoiceStatus.PARTIAL, invoice_number=f'PI{n}-{i}', date_created=now - timedelta(days=i),
                          company_id=cid)
            inv.items = [InvoiceItem(quantity=1, unit_price=10, amount=10, description='part', company_id=cid) for _ in range(5)]
            db_session.add_all([q, inv])
            db_session.flush()
            db_session.add(Payment(invoice_id=inv.id, amount=50, payment_date=now, transaction_id=f'PT{n}-{i}', company_id=cid))
        db_session.commit()
    return client


def count_queries(client, path):
    seen = []

    def on_execute(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)
    event.listen(engine, 'before_cursor_execute', on_execute)
    try:
        resp = client.get(path)
    finally:
        event.remove(engine, 'before_cursor_execute', on_execute)
    assert resp.status_code == 200
    return len(seen), resp.get_json()


def test_list_pages_use_a_fixed_number_of_queries(app):
    client = company_with_data(app, rows=40)
    for path, rows_expected in (('/api/quotations', 40), ('/api/invoices', 40), ('/api/payments', 40)):
        queries, data = count_queries(client, path)
        assert len(data) == rows_expected
        assert queries <= 12, f'{path} made {queries} queries for {rows_expected} rows'


def test_the_lists_still_carry_their_related_data(app):
    client = company_with_data(app, rows=3)
    quotes = client.get('/api/quotations').get_json()
    assert all(q['customer'] and q['item_count'] == 5 for q in quotes)
    invoices = client.get('/api/invoices').get_json()
    assert all(i['customer'] and i['invoice_number'] for i in invoices)
    payments = client.get('/api/payments').get_json()
    assert all(p['invoice_number'] and p['customer'] for p in payments)


def test_every_call_reports_how_long_the_server_took(app):
    resp = app.test_client().get('/_health')
    assert resp.headers['Server-Timing'].startswith('app;dur=')
