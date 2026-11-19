"""Daily usage counters: how much each company uses the platform, for pricing the software.

Every API call by a logged-in user is counted per company and day (and whether it changed anything), and each
active user is noted once per day. Counting is done in memory and written to the database in small batches, so it
adds no database work to a request. If the server restarts, at most the last ~30 seconds of counts are lost,
which is irrelevant for pricing.
"""
import logging
import threading
import time
from datetime import datetime

from sqlalchemy import text

from .database import engine

log = logging.getLogger('erp.usage')

FLUSH_EVERY_SECONDS = 30
FLUSH_AFTER_CALLS = 500

_lock = threading.Lock()
_counts = {}        # (company_id, day) -> [requests, writes]
_users = set()      # (company_id, day, user_id)
_pending = 0
_last_flush = time.time()


def record(company_id, user_id, is_write):
    """Count one API call. Never raises."""
    global _pending
    try:
        day = datetime.utcnow().date()
        with _lock:
            row = _counts.setdefault((company_id, day), [0, 0])
            row[0] += 1
            row[1] += 1 if is_write else 0
            if user_id is not None:
                _users.add((company_id, day, user_id))
            _pending += 1
            due = _pending >= FLUSH_AFTER_CALLS or time.time() - _last_flush >= FLUSH_EVERY_SECONDS
        if due:
            flush()
    except Exception:
        log.exception('Could not count a request')


def flush():
    """Write the counts collected so far. Safe to call at any time (also used by tests)."""
    global _counts, _users, _pending, _last_flush
    with _lock:
        counts, users = _counts, _users
        _counts, _users, _pending, _last_flush = {}, set(), 0, time.time()
    if not counts and not users:
        return
    try:
        with engine.begin() as conn:
            for (company_id, day), (requests, writes) in counts.items():
                conn.execute(text(
                    'INSERT INTO usage_daily (company_id, day, requests, writes) VALUES (:c, :d, :r, :w) '
                    'ON CONFLICT (company_id, day) DO UPDATE SET requests = usage_daily.requests + :r, '
                    'writes = usage_daily.writes + :w'), {'c': company_id, 'd': day, 'r': requests, 'w': writes})
            for company_id, day, user_id in users:
                conn.execute(text(
                    'INSERT INTO usage_users (company_id, day, user_id) VALUES (:c, :d, :u) '
                    'ON CONFLICT (company_id, day, user_id) DO NOTHING'), {'c': company_id, 'd': day, 'u': user_id})
    except Exception:
        log.exception('Could not save usage counts; they are dropped')
