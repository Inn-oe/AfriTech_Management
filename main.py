"""Root entry point so `gunicorn main:app` works on hosts that start from the repository root.

The application itself lives in backend/ (see backend/wsgi.py).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend'))

from wsgi import app  # noqa: E402,F401
