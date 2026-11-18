# Read automatically by gunicorn when it starts from the repository root (the Render start command).
#
# Slow pages (the dashboard and quotation list take several seconds on the free plan) used to block the single
# worker, so Render's 5-second health check went unanswered, the instance was declared unhealthy and restarted,
# and people saw "502 Bad Gateway". Four threads in one worker keep /_health answering while a page loads;
# one worker keeps memory low (each request is mostly waiting for the database).
workers = 1
threads = 4

# Calls to the WhatsApp bot can take up to ~75 s when the free bot service is waking up; the default 30 s
# worker timeout killed those requests and the page showed an error.
timeout = 120
