import os
import tempfile

import pytest

# Must be set before the app package is imported: use a throwaway SQLite database.
_tmp = tempfile.mkdtemp()
os.environ['DATABASE_URL'] = 'sqlite:///' + os.path.join(_tmp, 'test.db').replace(os.sep, '/')
os.environ['FLASK_SECRET_KEY'] = 'test-secret-key-not-for-production'

from app import create_app  # noqa: E402


@pytest.fixture(scope='session')
def app():
    return create_app()


@pytest.fixture()
def client(app):
    return app.test_client()
