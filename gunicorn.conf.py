# Read automatically by gunicorn when it starts from the repository root (the Render start command).
# Calls to the WhatsApp bot can take up to ~75 s when the free bot service is waking up; the default
# 30 s worker timeout killed those requests and the page showed an error.
timeout = 120
