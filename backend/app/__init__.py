"""Solar company management platform — Flask application package.

Use ``create_app()`` (see wsgi.py). Serves the JSON REST API under /api and the compiled React app (frontend/dist)
for every other path. Each solar company that signs up gets its own isolated data.
"""
import logging
import os
import secrets
import time
from datetime import timedelta

from flask import Flask, g, jsonify, request, send_from_directory
from sqlalchemy import LargeBinary, inspect, text
from sqlalchemy.orm import configure_mappers
from werkzeug.security import generate_password_hash
from whitenoise import WhiteNoise

from .database import Base, db_session, engine, init_db
from . import giebee_import
from .platform_usage import platform_bp
from .auth import auth_bp
from .api import bp as api_bp
from .whatsapp import bp as whatsapp_bp
from .models import Company, User

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
log = logging.getLogger('erp')

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIST = os.path.join(os.path.dirname(BACKEND_DIR), 'frontend', 'dist')
ON_SERVER = bool(os.environ.get('RENDER') or os.environ.get('VERCEL'))
SLOW_REQUEST_MS = 1000     # calls slower than this are written to the log

# Keys that were once committed to the public repository must never sign a login cookie.
_LEAKED_KEYS = {'solar_company_secret_key', '8dcd80847a420f609fe3c8aaf6a61d09'}


def _secret_key():
    key = os.environ.get('FLASK_SECRET_KEY')
    if key and key not in _LEAKED_KEYS:
        return key
    path = os.path.join(BACKEND_DIR, 'instance', 'secret_key')
    try:
        if os.path.exists(path):
            with open(path, encoding='utf-8') as fh:
                saved = fh.read().strip()
            if saved:
                return saved
        os.makedirs(os.path.dirname(path), exist_ok=True)
        key = secrets.token_hex(32)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(key)
        return key
    except OSError:
        log.warning('FLASK_SECRET_KEY is not set; users will be logged out on every restart.')
        return secrets.token_hex(32)


def _adopt_legacy_rows(conn, tenant_tables):
    """Rows created before companies existed are given to one company (the original installation)."""
    orphans = [t for t in tenant_tables
               if conn.execute(text(f'SELECT 1 FROM {t} WHERE company_id IS NULL LIMIT 1')).first()]
    if not orphans:
        return
    name = os.environ.get('LEGACY_COMPANY_NAME', 'Giebee Engineering')
    company_id = conn.execute(text('SELECT id FROM companies WHERE name = :n ORDER BY id LIMIT 1'),
                              {'n': name}).scalar()
    if company_id is None:
        conn.execute(Company.__table__.insert().values(name=name, currency='USD', is_active=True))
        company_id = conn.execute(text('SELECT id FROM companies WHERE name = :n ORDER BY id LIMIT 1'),
                                  {'n': name}).scalar()
    for t in orphans:
        conn.execute(text(f'UPDATE {t} SET company_id = :c WHERE company_id IS NULL'), {'c': company_id})
    log.info('Assigned existing records in %d tables to company "%s"', len(orphans), name)

    # Optional: create the owner login for that company from environment variables.
    email = (os.environ.get('BOOTSTRAP_OWNER_EMAIL') or '').strip().lower()
    password = os.environ.get('BOOTSTRAP_OWNER_PASSWORD') or ''
    has_users = conn.execute(text('SELECT 1 FROM users WHERE company_id = :c LIMIT 1'), {'c': company_id}).first()
    if email and len(password) >= 8 and not has_users:
        conn.execute(User.__table__.insert().values(
            company_id=company_id, name='Owner', email=email, role='owner', is_active=True,
            password_hash=generate_password_hash(password)))
        log.info('Created owner login %s for "%s"', email, name)


def ensure_schema():
    """Create tables and add columns introduced after the first deployments."""
    init_db()
    insp = inspect(engine)
    tenant_tables = [t.name for t in Base.metadata.sorted_tables
                     if 'company_id' in t.c and t.name not in ('users', 'audit_logs')]
    additions = {
        'payments': [('payer_name', 'VARCHAR(100)')],
        'invoices': [('quotation_id', 'INTEGER REFERENCES quotations(id)')],
        'companies': [('logo', str(LargeBinary().compile(dialect=engine.dialect)))],
    }
    for t in tenant_tables:
        additions.setdefault(t, []).append(('company_id', 'INTEGER REFERENCES companies(id)'))
    with engine.begin() as conn:
        for table, columns in additions.items():
            existing = {c['name'] for c in insp.get_columns(table)}
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}'))
                    log.info("Added column '%s' to '%s'", name, table)
        for t in tenant_tables:
            conn.execute(text(f'CREATE INDEX IF NOT EXISTS ix_{t}_company_id ON {t} (company_id)'))
        # Older rows stored lowercase quotation statuses.
        conn.execute(text(
            "UPDATE quotations SET status = UPPER(status) "
            "WHERE status IS NOT NULL AND status <> UPPER(status)"))
        _adopt_legacy_rows(conn, tenant_tables)


def create_app():
    """Build and configure the Flask application."""
    app = Flask(__name__, static_folder=None)
    app.secret_key = _secret_key()
    app.json.sort_keys = False
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=ON_SERVER,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    )

    # Serve hashed JS/CSS bundles efficiently in production.
    if os.path.isdir(FRONTEND_DIST):
        app.wsgi_app = WhiteNoise(app.wsgi_app, root=FRONTEND_DIST)

    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(whatsapp_bp)
    app.register_blueprint(platform_bp)

    # Finish SQLAlchemy's model set-up now, on this one thread, before any other thread can run a query. Left to
    # the first query, a background thread (the Giebee import) and the first web request could start it at the
    # same moment; on the server that sometimes ended in "RecursionError: maximum recursion depth exceeded" and
    # every page failed until the next restart.
    configure_mappers()

    try:
        ensure_schema()
    except Exception:  # keep the app bootable so /_health can report the problem
        log.exception('Database initialisation failed')
    else:
        giebee_import.start_in_background()   # no-op unless GIEBEE_IMPORT_SOURCE_URL is set

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        db_session.remove()


    @app.before_request
    def start_timer():
        g.started = time.perf_counter()

    @app.after_request
    def time_the_request(resp):
        """Server-Timing header for every call, and a log line when one is slow (so slowness shows up in the logs)."""
        started = g.get('started')
        if started is not None:
            ms = (time.perf_counter() - started) * 1000
            resp.headers['Server-Timing'] = f'app;dur={ms:.0f}'
            if ms >= SLOW_REQUEST_MS and not request.path.startswith('/assets/'):
                log.warning('Slow request: %s %s took %.1f s (status %s)', request.method, request.path, ms / 1000,
                            resp.status_code)
        return resp

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
        resp.headers.setdefault('X-Frame-Options', 'DENY')
        resp.headers.setdefault('Referrer-Policy', 'same-origin')
        return resp


    @app.route('/_health')
    def health_check():
        try:
            db_session.execute(text('SELECT 1'))
            return jsonify(status='healthy', database='connected'), 200
        except Exception:
            log.exception('Health check failed')
            return jsonify(status='unhealthy'), 500


    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def spa(path):
        """Serve the React single-page app; client-side routing handles the rest."""
        if path.startswith('api/'):
            return jsonify(error='Not found'), 404
        index = os.path.join(FRONTEND_DIST, 'index.html')
        if not os.path.exists(index):
            return ('Frontend not built. Run "npm install && npm run build" inside the '
                    'frontend/ folder, or use "npm run dev" for development.'), 503
        file_path = os.path.join(FRONTEND_DIST, path)
        if path and os.path.isfile(file_path):
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, 'index.html')

    return app
