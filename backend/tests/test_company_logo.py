"""Company logo: upload, download, and printing it on the invoice PDF."""
import base64
import itertools
from datetime import datetime

from app import pdfs
from app.database import db_session
from app.models import Company, Customer, Invoice, InvoiceItem, InvoiceStatus

# a valid 1x1 PNG
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def signed_up(client):
    n = next(_n)
    resp = client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Logo Co {n}', 'name': 'Owner', 'email': f'logo{n}@example.test', 'password': 'a-long-password'})
    assert resp.status_code == 201
    return resp.get_json()


def test_upload_download_and_remove(client):
    assert signed_up(client)['company']['has_logo'] is False
    assert client.get('/api/company/logo').status_code == 404

    ok = client.put('/api/company/logo', headers=HEADERS, json={'image': 'data:image/png;base64,' + base64.b64encode(PNG).decode()})
    assert ok.status_code == 200 and ok.get_json()['has_logo'] is True
    got = client.get('/api/company/logo')
    assert got.status_code == 200 and got.mimetype == 'image/png' and got.data == PNG
    assert client.get('/api/auth/me').get_json()['company']['has_logo'] is True

    assert client.put('/api/company/logo', headers=HEADERS, json={'image': base64.b64encode(b'not an image').decode()}).status_code == 400
    assert client.put('/api/company/logo', headers=HEADERS, json={'image': '%%%'}).status_code == 400
    assert client.delete('/api/company/logo', headers=HEADERS).get_json()['has_logo'] is False


def test_logo_is_private_to_its_company(client, app):
    signed_up(client)
    client.put('/api/company/logo', headers=HEADERS, json={'image': base64.b64encode(PNG).decode()})
    other = app.test_client()
    assert other.get('/api/company/logo').status_code in (401, 403)


def _invoice(company_id):
    customer = Customer(identification_number=f'LG{company_id}', name='Rudo', surname='Moyo', company_id=company_id)
    invoice = Invoice(customer=customer, total_amount=100, paid_amount=40, balance_due=60, status=InvoiceStatus.PARTIAL,
                      invoice_number=f'LG-{company_id}', date_created=datetime(2026, 11, 1), company_id=company_id)
    invoice.items = [InvoiceItem(description='Battery', item_code='B1', quantity=1, unit_price=100, amount=100,
                                 company_id=company_id)]
    db_session.add_all([customer, invoice])
    db_session.commit()
    return invoice


def test_invoice_pdf_prints_the_logo(app):
    with app.app_context():
        with_logo = Company(name='GieBee Test (Pvt) Ltd', phone='+263 1\n+263 2', address='1 Road\nHarare', logo=PNG)
        without = Company(name='Plain Co')
        db_session.add_all([with_logo, without])
        db_session.commit()
        a, _ = pdfs.invoice_pdf(with_logo, _invoice(with_logo.id))
        b, _ = pdfs.invoice_pdf(without, _invoice(without.id))
        assert a.getvalue().startswith(b'%PDF') and b.getvalue().startswith(b'%PDF')
        assert b'/Subtype /Image' in a.getvalue() and b'/Subtype /Image' not in b.getvalue()


def test_a_broken_logo_file_does_not_break_the_pdf(app):
    with app.app_context():
        company = Company(name='Bad Logo Co', logo=b'garbage')
        db_session.add(company)
        db_session.commit()
        buf, name = pdfs.invoice_pdf(company, _invoice(company.id))
        assert buf.getvalue().startswith(b'%PDF') and name.startswith('Invoice_')
