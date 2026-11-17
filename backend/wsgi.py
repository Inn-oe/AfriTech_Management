"""WSGI entry point: `gunicorn wsgi:app` (production) or `python wsgi.py` (development)."""
import os

from app import create_app

app = create_app()

if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG', 'true').lower() == 'true',
            host='127.0.0.1', port=int(os.environ.get('PORT', 5000)))
