# Solar Business Manager

Multi-company management platform for solar installers: customers, quotations, invoices, payments,
inventory, projects, finances, reports and a WhatsApp leads tab. Each company that signs up gets its
own isolated data.

**Stack:** React 18 + Vite (frontend) · Flask + SQLAlchemy (backend API) · PostgreSQL in production,
SQLite locally.

## Layout

```
backend/            Flask API (Python)
  app/              application package (create_app factory)
    api.py          REST endpoints under /api
    auth.py         login, sessions, tenant isolation
    models.py       SQLAlchemy models
    database.py     engine / session / SQLite backups
    pdfs.py         invoice & quotation PDFs
    whatsapp.py     WhatsApp section: enquiries (priority), potential clients, bot training
    lead_rules.py   hot / warm / cold lead scoring
  tests/            pytest suite
  wsgi.py           entry point (gunicorn wsgi:app)
frontend/           React app (Vite) -> builds to frontend/dist
render.yaml         Render blueprint (web service + WhatsApp bot)
```

In production Flask serves the built React app and the API from one service.

## WhatsApp bot

A separate service (`solar-whatsapp-bot`) chats with customers in plain language using a trained NLP model
and shares this platform's database. The **WhatsApp** section shows:

* **Enquiries**: each customer with what they want (buy / enquiry / maintenance) and a priority, plus the chat and replies.
* **Potential clients**: lead scoring and sales stages.
* **Train the bot**: add example phrases and replies, review messages it was unsure about, test, and retrain.

Needs `WHATSAPP_COMPANY_ID`, `WHATSAPP_BOT_URL` and `WHATSAPP_INTERNAL_KEY` (same value as the bot's `INTERNAL_KEY`).

## Local development

Two terminals:

```bash
# 1. API on http://127.0.0.1:5000
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env
python wsgi.py

# 2. UI on http://localhost:5173 (proxies /api to Flask)
cd frontend
npm install
npm run dev
```

Tests: `cd backend && pytest`. Production build check: `cd frontend && npm run build`.

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `FLASK_SECRET_KEY` | Signs login cookies (required in production) |
| `DATABASE_URL` | PostgreSQL URL; unset = local SQLite at `backend/instance/database.db` |
| `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` | Optional first owner login for pre-existing data |
| `LEGACY_COMPANY_NAME` | Company that adopts records created before multi-company support |

## Deployment

`render.yaml` builds the frontend, installs `backend/requirements.txt` and runs
`gunicorn --chdir backend wsgi:app`. Health check: `/_health`.
