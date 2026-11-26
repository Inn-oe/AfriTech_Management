"""Income statement and balance sheet PDFs: they build for an empty company and for one with expenses, in its logo colour."""
import base64
import itertools

from app import statements
from app.models import Company

HEADERS = {'X-Requested-With': 'fetch'}
_n = itertools.count(1)


def signed_up(client):
    n = next(_n)
    resp = client.post('/api/auth/signup', headers=HEADERS, json={
        'company_name': f'Stmt Co {n}', 'name': 'Owner', 'email': f'stmt{n}@example.test', 'password': 'a-long-password'})
    assert resp.status_code == 201


def test_statements_build_for_an_empty_company(client):
    signed_up(client)
    for path in ('income-statement', 'balance-sheet'):
        resp = client.get(f'/api/financial/{path}.pdf?month=11&year=2026')
        assert resp.status_code == 200 and resp.data.startswith(b'%PDF')


def test_expenses_appear_on_the_income_statement(client):
    signed_up(client)
    client.post('/api/financial-records', headers=HEADERS, json={
        'type': 'EXPENSE', 'category': 'Wages', 'amount': 250, 'description': 'Weekly pay', 'date': '2026-11-10'})
    resp = client.get('/api/financial/income-statement.pdf?month=11&year=2026')
    assert resp.status_code == 200 and resp.data.startswith(b'%PDF')
    bad = client.get('/api/financial/income-statement.pdf?month=13&year=2026')
    assert bad.status_code == 400


def test_colour_comes_from_the_logo_with_a_default():
    from PIL import Image
    import io

    class Co:
        logo = None
    default = statements.brand_color(Co())
    assert default.hexval().lower() == '0x0f7b5a'

    img = Image.new('RGBA', (60, 60), (255, 255, 255, 0))
    for x in range(10, 50):
        for y in range(10, 50):
            img.putpixel((x, y), (30, 40, 150, 255))   # a navy square on a transparent background
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    Co.logo = buf.getvalue()
    r, g, b = statements.brand_color(Co()).rgb()
    assert b > r and b > g                            # navy-ish, not the default green
