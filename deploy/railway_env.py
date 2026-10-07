#!/usr/bin/env python3
"""Builds the variable blocks you paste into Railway.

    python3 deploy/railway_env.py              full setup (first time)
    python3 deploy/railway_env.py --hosts-only  later, when your addresses change (custom domains): prints just the
                                                4 variables to update, and keeps your secret key and admin path

Asks for your values (secrets typed hidden, never printed), generates the Django secret key and private admin path,
and writes two files you paste into Railway's "Raw Editor" (service > Variables):

    deploy/.env.railway.backend   for the backend, worker and beat services (same block in all three)
    deploy/.env.railway.web       for passenger-web, rider-web and admin-web (same block in all three)

Both files are git-ignored and owner-only. Delete them once pasted. See deploy/RAILWAY.md for the whole walkthrough.
"""
import os
import secrets
import sys

import setup_env as base  # same folder: reuse the prompts and validators

BACKEND_OUT = os.path.join(base.ROOT, "deploy", ".env.railway.backend")
WEB_OUT = os.path.join(base.ROOT, "deploy", ".env.railway.web")
PHONE_RE = __import__("re").compile(r"^\+233\d{9}$")


def phone_check(v):
    return None if PHONE_RE.match(v) else "Use the international form, like +233201234567."


def password_check(v):
    if len(v) < 10:
        return "Use at least 10 characters."
    if any(c in v for c in "\"'\\$ \t"):
        return "Avoid spaces and the characters  \" ' \\ $  (they get mangled when pasted)."
    return None


def ask_hosts():
    passenger = base.ask("Passenger web address", check=base.host_check, hint="Example: app.example.com (no https://)")
    rider = base.ask("Rider web address", check=base.host_check)
    admin = base.ask("Admin (ops) web address", check=base.host_check)
    backend_host = base.ask("Backend address (only for Django's own admin page)", required=False, check=base.host_check,
                            hint="Leave blank to skip Django admin.")
    hosts = [h for h in (passenger, rider, admin, backend_host) if h]
    if len(set(hosts)) != len(hosts):
        sys.exit("Every address must be different.")
    return passenger, rider, admin, backend_host, hosts


def host_lines(passenger, hosts):
    origins = ",".join(f"https://{h}" for h in hosts)
    return [
        f"DJANGO_ALLOWED_HOSTS={','.join(hosts)}",
        f"DJANGO_CSRF_TRUSTED_ORIGINS={origins}",
        f"CORS_ALLOWED_ORIGINS={origins}",
        f"PASSENGER_WEB_URL=https://{passenger}",
    ]


def hosts_only():
    print("Update the four address variables only. Your secret key and admin path are untouched.")
    passenger, _rider, _admin, _backend, hosts = ask_hosts()
    print("\nIn Railway, in backend, worker AND beat > Variables > Raw Editor, REPLACE these four lines (nothing else), then redeploy:\n")
    print("\n".join(host_lines(passenger, hosts)))
    print("\nThese contain no secrets. Nothing was written to disk.")


def main():
    print("WolbiRides on Railway: variable builder. Press Enter to accept a [default]. Secrets are typed hidden.")
    print("Have your six Railway addresses ready (the generated *.up.railway.app ones are fine to start with).")

    print("\n=== 1. Your public addresses ===")
    passenger, rider, admin, backend_host, hosts = ask_hosts()

    print("\n=== 2. First admin account (created automatically on the first start) ===")
    adm_phone = base.ask("Admin phone", check=phone_check, hint="Used to identify the account. Example: +233201234567")
    adm_email = base.ask("Admin email (you sign in to the ops app with this)", check=base.email_check)
    adm_pass = base.ask("Admin password", secret=True, check=password_check, hint="You will delete this variable from Railway after your first sign-in.")

    print("\n=== 3. Email (Resend) ===")
    resend_key = base.ask("Resend API key", secret=True, check=base.no_space, hint="Starts with re_")
    from_addr = base.ask("Send emails from", hint="Must be on a domain verified in Resend. Example: WolbiRides <no-reply@wolbiroyal.com>")

    print("\n=== 4. Cloudflare R2 (file storage) ===")
    r2_account = base.ask("R2 Account ID", check=base.no_space)
    r2_key = base.ask("R2 Access Key ID", secret=True, check=base.no_space)
    r2_secret = base.ask("R2 Secret Access Key", secret=True, check=base.no_space)
    pub_bucket = base.ask("Public bucket name", "wolbirides-public-media", check=base.bucket_check)
    priv_bucket = base.ask("Private bucket name", "wolbirides-private-media", check=base.bucket_check)
    if pub_bucket == priv_bucket:
        sys.exit("The public and private buckets must be two different buckets.")
    pub_url = base.ask("Public files address", check=base.url_check,
                       hint="The custom domain (or r2.dev address) of the PUBLIC bucket, e.g. https://files.example.com")

    print("\n=== 5. SMS (Africa's Talking) ===")
    at_user = base.ask("Africa's Talking username", required=False, check=base.no_space, hint="Your live app username, not 'sandbox'. Blank = no phone codes.")
    at_key = base.ask("Africa's Talking API key", secret=True, required=False, check=base.no_space) if at_user else ""

    print("\n=== 6. AI assistant (optional) ===")
    anthropic = base.ask("Anthropic API key", secret=True, required=False, check=base.no_space, hint="Blank switches the assistant off.")

    backend_lines = [
        "# Paste into Railway > backend, worker AND beat > Variables > Raw Editor.",
        "DATABASE_URL=${{Postgres.DATABASE_URL}}",
        "REDIS_URL=${{Redis.REDIS_URL}}",
        "PORT=8000",
        "BIND_HOST=::",
        "DJANGO_DEBUG=False",
        f"DJANGO_SECRET_KEY={secrets.token_urlsafe(64)}",
        f"DJANGO_ADMIN_PATH=ops-{secrets.token_hex(5)}",
        *host_lines(passenger, hosts),
        f"DJANGO_SUPERUSER_PHONE={adm_phone}",
        f"DJANGO_SUPERUSER_EMAIL={adm_email}",
        f"DJANGO_SUPERUSER_PASSWORD={adm_pass}",
        f"RESEND_API_KEY={resend_key}",
        f"DEFAULT_FROM_EMAIL={from_addr}",
        f"R2_ACCOUNT_ID={r2_account}",
        f"R2_ACCESS_KEY_ID={r2_key}",
        f"R2_SECRET_ACCESS_KEY={r2_secret}",
        f"R2_BUCKET={pub_bucket}",
        f"R2_PUBLIC_BASE_URL={pub_url}",
        f"R2_PRIVATE_BUCKET={priv_bucket}",
        "R2_SIGNED_URL_SECONDS=600",
        f"AFRICASTALKING_USERNAME={at_user}",
        f"AFRICASTALKING_API_KEY={at_key}",
        f"ANTHROPIC_API_KEY={anthropic}",
        "MOMO_DEV_AUTO_APPROVE=False",
        "HUBTEL_DEV_AUTO_APPROVE=False",
    ]
    web_lines = [
        "# Paste into Railway > passenger-web, rider-web AND admin-web > Variables > Raw Editor.",
        "BACKEND_ORIGIN=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}",
        "NGINX_RESOLVER=[fd12::10] ipv6=on",
    ]

    print("\n=== Writing files ===")
    base.backup(BACKEND_OUT)
    base.backup(WEB_OUT)
    base.write_private(BACKEND_OUT, "\n".join(backend_lines) + "\n")
    base.write_private(WEB_OUT, "\n".join(web_lines) + "\n")
    print("  wrote deploy/.env.railway.backend and deploy/.env.railway.web (owner-only, git-ignored)")
    print("""
Done. Nothing secret was printed. Next (details in deploy/RAILWAY.md, step 5):
  1. Open deploy/.env.railway.backend, copy ALL of it, and paste it into the Raw Editor of backend, worker and beat.
  2. Open deploy/.env.railway.web the same way for passenger-web, rider-web and admin-web.
  3. Delete both files from your computer once pasted (they hold your keys), keeping a copy in a password manager.
""")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        hosts_only() if "--hosts-only" in sys.argv else main()
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nCancelled. Nothing was written.")
