"""Every company starts with the full list of solar-business income and expense categories."""
import itertools

from app.database import db_session
from app.default_categories import EXPENSE_CATEGORIES, add_defaults_to_existing_companies
from app.models import Company, FinancialCategory, FinancialType

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def signed_up(client):
    n = next(_n)
    resp = client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Cat Co {n}', 'name': 'Owner', 'email': f'cat{n}@example.test', 'password': 'a-long-password'})
    assert resp.status_code == 201
    return resp.get_json()


def test_new_company_gets_the_standard_expense_categories(client):
    signed_up(client)
    rows = client.get('/api/financial-categories').get_json()
    expenses = {r['name'] for r in rows if r['type'] == 'EXPENSE'}
    for wanted in ('Wages', 'Salaries', 'Transport fees', 'Staff food and refreshments', 'Fuel',
                   'Vehicle repairs', 'Vehicle maintenance and servicing', 'Solar system maintenance', 'Rent'):
        assert wanted in expenses
    assert len(expenses) == len(EXPENSE_CATEGORIES)
    assert any(r['type'] == 'INCOME' for r in rows)


def test_an_expense_can_be_booked_with_a_standard_category(client):
    signed_up(client)
    resp = client.post('/api/financial-records', headers=HEADERS,
                       json={'type': 'EXPENSE', 'category': 'Wages', 'amount': 150, 'description': 'Weekly pay'})
    assert resp.status_code == 201


def test_existing_company_is_filled_once_and_edits_are_kept(app, client):
    with app.app_context():
        company = Company(name='Old Co', currency='USD')
        db_session.add(company)
        db_session.flush()
        db_session.add(FinancialCategory(company_id=company.id, name='fuel', type=FinancialType.EXPENSE))
        cid = company.id
        add_defaults_to_existing_companies(db_session)
        db_session.commit()
        names = [c.name for c in db_session.query(FinancialCategory).filter_by(company_id=cid, type=FinancialType.EXPENSE)]
        assert 'Wages' in names
        assert sum(n.lower() == 'fuel' for n in names) == 1      # the company's own "fuel" was not duplicated
        # the company deletes one; a later start-up must not bring it back
        db_session.query(FinancialCategory).filter_by(company_id=cid, name='Wages').delete()
        db_session.commit()
        add_defaults_to_existing_companies(db_session)
        db_session.commit()
        assert db_session.query(FinancialCategory).filter_by(company_id=cid, name='Wages').count() == 0
        db_session.remove()
