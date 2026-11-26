"""Reset a user's password (the ERP has no "forgot password" page).

Run it on your own computer against the live database. The new password is typed here, hidden, and never stored
anywhere except as the app's normal password hash.

    1. Render dashboard -> giebee-db -> Connections -> copy the "External Database URL".
    2. PowerShell, in the backend folder:
           pip install sqlalchemy werkzeug pg8000          (once)
           $env:DATABASE_URL = "postgresql://..."
           python reset_password.py giebeeengineering@gmail.com
    3. Type the new password twice. Then sign in with it.

Everyone signed in as that user is signed out (the app ties sessions to the password).
"""
import getpass
import os
import sys

import sqlalchemy as sa
from werkzeug.security import generate_password_hash


def engine_for(url):
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        try:
            import psycopg2  # noqa: F401
        except Exception:
            # no working psycopg2 on this computer: use the pure-Python driver (Render needs SSL)
            return sa.create_engine("postgresql+pg8000://" + url[len("postgresql://"):],
                                    connect_args={"ssl_context": True})
    return sa.create_engine(url)


def main():
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        sys.exit(__doc__)
    email = sys.argv[1].strip().lower()
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        sys.exit("Set DATABASE_URL first (see the instructions at the top of this file).")
    engine = engine_for(url)
    with engine.begin() as conn:
        user = conn.execute(sa.text(
            "SELECT u.id, u.name, u.role, u.is_active, c.name AS company FROM users u JOIN companies c "
            "ON c.id = u.company_id WHERE lower(u.email) = :e"), {"e": email}).mappings().first()
        if not user:
            sys.exit(f"No user with the email {email}.")
        print(f"User: {user['name']} ({user['role']}) at {user['company']}"
              f"{'' if user['is_active'] else '  [DEACTIVATED]'}")
        if input("Reset this user's password? type yes: ").strip().lower() != "yes":
            sys.exit("Nothing changed.")
        password = getpass.getpass("New password (at least 8 characters): ")
        if len(password) < 8 or len(password) > 200:
            sys.exit("The password must be 8 to 200 characters. Nothing changed.")
        if getpass.getpass("Type it again: ") != password:
            sys.exit("The two passwords differ. Nothing changed.")
        conn.execute(sa.text("UPDATE users SET password_hash = :h WHERE id = :i"),
                     {"h": generate_password_hash(password), "i": user["id"]})
    print("Done. Sign in with the new password.")


if __name__ == "__main__":
    main()
