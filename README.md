# Solar Business Manager

A business management platform for solar companies: customers, inventory, quotations, invoices,
payments, financial reporting and fleet tracking. Any solar company can sign up; each company has
its own users and sees only its own data (Giebee Engineering is the example company).

## Accounts, companies and roles

- **Sign up** at `/signup` creates a company and its owner. The owner adds team members under
  *Team & Roles* and edits letterhead and banking details under *Company Profile*.
- **Roles:** owner, admin, manager, salesperson, inventory manager, accountant, technician, customer
  support. Permissions are enforced on the server for every `/api` request ([auth.py](auth.py)).
- **Isolation:** every business table has a `company_id`. Queries are filtered and new rows stamped
  automatically for the logged-in user's company, so one company cannot read or change another's.
- **Activity log:** every successful change is recorded with who made it and when.
- **Existing data:** rows created before companies existed are assigned on start-up to the company
  named by `LEGACY_COMPANY_NAME` (default `Giebee Engineering`). Set `BOOTSTRAP_OWNER_EMAIL` and
  `BOOTSTRAP_OWNER_PASSWORD` once to create that company's owner login.
- **Known limit:** customer IDs and document numbers are unique across the whole platform, so two
  companies cannot use the same customer ID.

- **Frontend:** React 18 + React Router + Bootstrap 5 + Chart.js (Vite), in [`frontend/`](frontend/)
- **Backend:** Flask JSON API + SQLAlchemy (SQLite locally, PostgreSQL in production)
- **PDFs:** quotations, invoices, payment receipts, income statement and balance sheet (ReportLab)

## Project layout

```
main.py          Flask app: serves /api and the built React app (frontend/dist)
auth.py          Sign-up, login, roles, company isolation, audit log
api.py           REST API (all business logic: stock movements, invoice balances, reports)
pdfs.py          PDF documents
models.py        SQLAlchemy models
database.py      DB engine/session (DATABASE_URL, defaults to sqlite:///instance/database.db)
desktop_app.py   Optional desktop window launcher (requires `pip install pywebview`)
frontend/        React app (src/pages, src/components)
```

## Running locally

Requirements: Python 3.10+ and Node.js 18+.

```bash
# 1. Backend
pip install -r requirements.txt
python main.py                 # API on http://localhost:5000

# 2. Frontend (second terminal) — hot reload, proxies /api to Flask
cd frontend
npm install
npm run dev                    # open http://localhost:5173
```

To serve everything from Flask instead (production-style), build once and open http://localhost:5000:

```bash
cd frontend && npm run build
```

## Deployment

The build must install Python deps **and** build the frontend:

```bash
pip install -r requirements.txt && cd frontend && npm ci && npm run build
```

Start command: `gunicorn --bind 0.0.0.0:$PORT main:app`

- **Render:** `render.yaml` is already configured (web service + PostgreSQL, generated secret key).
- **Vercel:** `vercel.json` builds the frontend statically and routes `/api` to Flask.
  Use an external PostgreSQL `DATABASE_URL`; SQLite does not persist on Vercel.

Environment variables:

| Variable           | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `DATABASE_URL`     | PostgreSQL connection string (SQLite if unset)      |
| `FLASK_SECRET_KEY` | Signs login cookies; set a long random value        |
| `FLASK_DEBUG`      | `true`/`false` for `python main.py`                 |

Tables are created automatically on start-up, and columns added since the first release are migrated
automatically.

## API overview

All endpoints are JSON under `/api`:

| Resource | Endpoints |
| --- | --- |
| Customers | `GET/POST /customers`, `GET/PUT/DELETE /customers/<id>` |
| Inventory | `GET/POST /inventory`, `GET/PUT/DELETE /inventory/<id>`, `POST /inventory/<id>/stock-in`, `POST /inventory/<id>/stock-out` |
| Quotations | `GET/POST /quotations`, `GET/PUT/DELETE /quotations/<id>`, `POST /quotations/<id>/convert`, `GET /quotations/<id>/pdf` |
| Invoices | `GET/POST /invoices`, `GET/PUT/DELETE /invoices/<id>`, `POST /invoices/<id>/status`, `POST /invoices/<id>/payments`, `GET /invoices/<id>/pdf` |
| Payments | `GET /payments`, `GET/PUT/DELETE /payments/<id>`, `GET /payments/<id>/pdf` |
| Financial | `GET /financial/summary?month=&year=`, `GET /financial/income-statement.pdf`, `GET /financial/balance-sheet.pdf`, `/financial-records`, `/financial-categories` |
| Other CRUD | `/suppliers`, `/activities`, `/activity-types`, `/fuel-records`, `/mileage-records`, `/journeys`, `/locations`, `/pricing` |
| Accounts | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`, `/users`, `GET/PUT /company`, `GET /audit-log` |
| Misc | `GET /dashboard`, `GET /meta`, `GET /_health` |
