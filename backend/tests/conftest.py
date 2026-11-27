import os
import tempfile

import pytest

# Must be set before the app package is imported: use a throwaway SQLite database.
_tmp = tempfile.mkdtemp()
os.environ['DATABASE_URL'] = 'sqlite:///' + os.path.join(_tmp, 'test.db').replace(os.sep, '/')
os.environ['FLASK_SECRET_KEY'] = 'test-secret-key-not-for-production'
os.environ['SHOP_AUTO_SYNC'] = '0'      # the shop never reads real websites during tests

from app import create_app  # noqa: E402


@pytest.fixture(scope='session')
def app():
    return create_app()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """Sign-ups and logins are rate limited per connection; every test starts with a clean slate."""
    from app import auth
    auth._HITS.clear()
    yield
