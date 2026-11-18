"""Copying the original Giebee installation into a company, using a small SQLite file shaped like the original."""
import itertools
import os
import tempfile

import pytest
from sqlalchemy import create_engine, text

from app import giebee_import
from app.database import db_session
from app.models import Company, Customer, FinancialRecord, Invoice, Payment, quotation, quotationItem

LEGACY = """
CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT, contact_person TEXT, phone TEXT, email TEXT, address TEXT,
  payment_terms TEXT, currency TEXT, notes TEXT, date_created TEXT);
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, identification_number TEXT, citizenship TEXT, address TEXT,
  phone TEXT, email TEXT, date_created TEXT, surname TEXT);
CREATE TABLE inventory (id INTEGER PRIMARY KEY, name TEXT, brand TEXT, category TEXT, specifications TEXT, quantity INTEGER,
  unit_price REAL, supplier_id INTEGER, minimum_stock_level INTEGER, notes TEXT, date_created TEXT, date_updated TEXT,
  cost_price REAL);
CREATE TABLE stock_transactions (id INTEGER PRIMARY KEY, inventory_id INTEGER, transaction_type TEXT, quantity INTEGER,
  unit_price REAL, total_value REAL, currency TEXT, reason TEXT, reference_id INTEGER, reference_type TEXT,
  customer_name TEXT, notes TEXT, created_by TEXT, date_created TEXT);
CREATE TABLE activity_types (id INTEGER PRIMARY KEY, name TEXT, description TEXT, is_active INTEGER, date_created TEXT);
CREATE TABLE activities (id INTEGER PRIMARY KEY, customer_id TEXT, activity_type_id INTEGER, description TEXT, status TEXT,
  date TEXT, completed_date TEXT, technician TEXT, equipment_used TEXT, labor_hours REAL, labor_cost REAL,
  material_cost REAL, total_cost REAL, currency TEXT, notes TEXT, date_created TEXT);
CREATE TABLE quotations (id INTEGER PRIMARY KEY, total_amount REAL, tax_amount REAL, discount_amount REAL, status TEXT,
  due_date TEXT, paid_date TEXT, notes TEXT, date_created TEXT, customer_id TEXT, quotation_number TEXT);
CREATE TABLE quotation_items (id INTEGER PRIMARY KEY, quotation_id INTEGER, inventory_id INTEGER, quantity INTEGER,
  unit_price REAL, description TEXT, item_code TEXT);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, quotation_id INTEGER, total_amount REAL, paid_amount REAL, balance_due REAL,
  status TEXT, due_date TEXT, notes TEXT, date_created TEXT, customer_id TEXT, activity_type_id INTEGER,
  invoice_number TEXT);
CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, inventory_id INTEGER, item_code TEXT,
  description TEXT, quantity INTEGER, unit_price REAL, amount REAL, cost_price REAL);
CREATE TABLE payments (id INTEGER PRIMARY KEY, invoice_id INTEGER, amount REAL, payment_date TEXT, payment_method TEXT,
  payer_name TEXT, reference_number TEXT, notes TEXT, date_created TEXT, transaction_id TEXT);
CREATE TABLE financial_records (id INTEGER PRIMARY KEY, type TEXT, category TEXT, description TEXT, amount REAL, date TEXT,
  receipt_number TEXT, vendor_supplier TEXT, reference_id INTEGER, notes TEXT, date_created TEXT);

INSERT INTO suppliers VALUES (1, 'Solar Wholesale', 'Tino', '0771', NULL, 'Harare', 'Net 30', 'USD', NULL, NULL);
INSERT INTO customers VALUES (1, 'Rudo', '12345', 'Zimbabwean', 'Harare', '0772000000', NULL, NULL, 'Moyo');
INSERT INTO customers VALUES (2, 'Tendai', '', 'Zimbabwean', 'Bulawayo', '0773', NULL, NULL, NULL);
INSERT INTO inventory VALUES (1, 'Lithium battery', 'Svolt', 'Battery', '24v', 5, 350, 1, 5, NULL, NULL, NULL, 300);
INSERT INTO stock_transactions VALUES (1, 1, 'STOCK_IN', 5, 300, 1500, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO activity_types VALUES (1, 'Solar install', NULL, 1, NULL);
INSERT INTO activities VALUES (1, '12345', 1, 'System', 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'USD',
  NULL, NULL);
INSERT INTO quotations VALUES (1, 700, 0, 0, 'PROCESSED', NULL, NULL, NULL, NULL, '12345', 'Q-1');
INSERT INTO quotations VALUES (2, 100, 0, 0, 'PENDING', NULL, NULL, NULL, NULL, '12345', 'Q-1');
INSERT INTO quotation_items VALUES (1, 1, 1, 2, 350, 'Battery', NULL);
INSERT INTO quotation_items VALUES (2, 99, 1, 1, 10, 'Orphan', NULL);
INSERT INTO invoices VALUES (1, 1, 700, 200, 500, 'PARTIAL', NULL, NULL, NULL, '12345', 1, 'INV-1');
INSERT INTO invoice_items VALUES (1, 1, 1, NULL, 'Battery', 2, 350, 700, 300);
INSERT INTO payments VALUES (1, 1, 200, NULL, 'CASH', 'Rudo', NULL, NULL, NULL, 'TX-1');
INSERT INTO financial_records VALUES (1, 'INCOME', 'Sales', 'Sold battery', 200, NULL, NULL, NULL, 1, NULL, NULL);
"""


@pytest.fixture()
def legacy_url():
    path = os.path.join(tempfile.mkdtemp(), 'legacy.db')
    engine = create_engine('sqlite:///' + path.replace(os.sep, '/'))
    with engine.begin() as conn:
        for statement in LEGACY.split(';\n'):
            if statement.strip():
                conn.execute(text(statement))
    engine.dispose()
    return 'sqlite:///' + path.replace(os.sep, '/')


_counter = itertools.count(1)


@pytest.fixture()
def company(app):
    """A fresh company with its own name (the test database is shared by the whole session)."""
    with app.app_context():
        c = Company(name=f'Giebee Test {next(_counter)}')
        db_session.add(c)
        db_session.commit()
        yield c.id
        db_session.remove()


def test_copies_everything_and_links_it_together(app, company, legacy_url):
    with app.app_context():
        # a record of another company that already uses the same numbers
        other = Company(name='Other Co')
        db_session.add(other)
        db_session.flush()
        db_session.add(Customer(identification_number='12345', name='Existing', company_id=other.id))
        db_session.add(quotation(quotation_number='Q-1', total_amount=1, company_id=other.id))
        db_session.commit()

        counts = giebee_import.import_company_data(legacy_url, company_id=company)
        assert counts['customers'] == 2 and counts['quotations'] == 2 and counts['quotation_items'] == 1  # orphan skipped
        assert counts['invoices'] == 1 and counts['payments'] == 1 and counts['financial_records'] == 1

        customers = db_session.query(Customer).filter_by(company_id=company).all()
        ids = {c.name: c.identification_number for c in customers}
        assert ids['Tendai'].startswith('G') and ids['Rudo'] != '12345'          # clash and blank id renumbered
        assert db_session.query(Customer).filter_by(identification_number='12345').one().name == 'Existing'

        numbers = sorted(q.quotation_number for q in db_session.query(quotation).filter_by(company_id=company))
        assert numbers == ['Q-1-G1', 'Q-1-G2']                                    # unique across companies

        inv = db_session.query(Invoice).filter_by(company_id=company).one()
        assert inv.customer_id == ids['Rudo'] and inv.status.name == 'PARTIAL' and inv.quotation_id is not None
        assert len(inv.items) == 1 and inv.items[0].amount == 700 and len(inv.payments) == 1
        assert inv.payments[0].company_id == company
        assert db_session.query(FinancialRecord).filter_by(company_id=company).one().reference_id == inv.id
        item = db_session.query(quotationItem).filter_by(company_id=company).one()
        assert item.quotation.company_id == company and item.inventory.company_id == company


def test_running_it_twice_changes_nothing(app, company, legacy_url):
    with app.app_context():
        assert giebee_import.import_company_data(legacy_url, company_id=company)
        assert giebee_import.import_company_data(legacy_url, company_id=company) == {}
        assert db_session.query(Payment).filter_by(company_id=company).count() == 1


def test_needs_the_company_to_exist(app, legacy_url):
    with app.app_context():
        with pytest.raises(giebee_import.ImportProblem):
            giebee_import.import_company_data(legacy_url, 'No Such Company')
