"""Invoices are numbered like quotations, from the customer's name and ID; ones that came in without a number get one."""
from app.api import assign_missing_invoice_numbers
from app.database import db_session
from app.models import Invoice

H = {'X-Requested-With': 'fetch'}


def test_invoices_without_a_number_get_one_from_the_customer(app):
    c = app.test_client()
    assert c.post('/api/auth/signup', headers=H, json={'company_name': 'Numbers Co', 'name': 'Owner',
                  'email': 'owner@numbers.test', 'password': 'a-long-password'}).status_code == 201
    cust = c.post('/api/customers', headers=H, json={'name': 'Mr Mabani', 'phone': '0771111111'}).get_json()
    inv = c.post('/api/invoices', headers=H, json={'customer_id': cust['id'], 'items': [
        {'description': 'Solar stand', 'quantity': 1, 'unit_price': 220}]}).get_json()
    assert inv['invoice_number'].startswith('MR' + cust['id'])

    with app.app_context():
        db_session.query(Invoice).filter_by(id=inv['id']).update({Invoice.invoice_number: None})
        db_session.commit()
        assert assign_missing_invoice_numbers() >= 1
        number = db_session.get(Invoice, inv['id']).invoice_number
        db_session.remove()
    assert number.startswith('MR' + cust['id']) and 'INV' not in number
    pdf = c.get(f"/api/invoices/{inv['id']}/pdf")
    assert pdf.status_code == 200 and number in pdf.headers.get('Content-Disposition', '')
