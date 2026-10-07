#!/usr/bin/env python3
"""Guided setup of the two production env files.

    python3 deploy/setup_env.py

Asks for each value, generates the secrets itself, and writes:
  deploy/.env.prod   hostnames, certificate email, database password, Django secret key, admin path
  backend/.env       Resend, Cloudflare R2, SMS and other service keys (built from backend/.env.example)

Existing files are backed up first. Secret answers are typed hidden and are never printed back.
Run deploy/check_env.py afterwards (deploy.sh does it for you) to verify the result.
"""
import getpass
import os
import re
import secrets
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROD = os.path.join(ROOT, "deploy", ".env.prod")
BACKEND = os.path.join(ROOT, "backend", ".env")
EXAMPLE = os.path.join(ROOT, "backend", ".env.example")

HOST_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ask(label, default="", secret=False, required=True, check=None, hint=""):
    while True:
        shown = f" [{default}]" if default and not secret else ""
        print(f"\n{label}{shown}")
        if hint:
            print(f"  {hint}")
        raw = (getpass.getpass("  > ") if secret else input("  > ")).strip()
        value = raw or default
        if not value and required:
            print("  This one is required.")
            continue
        if value and check:
            problem = check(value)
            if problem:
                print(f"  {problem}")
                continue
        return value


def host_check(v):
    return None if HOST_RE.match(v) else "Enter just the hostname, like app.example.com (no https://, no slash)."


def email_check(v):
    return None if EMAIL_RE.match(v) else "That doesn't look like an email address."


def url_check(v):
    if not v.startswith("https://"):
        return "Must start with https://"
    if v.endswith("/") or " " in v:
        return "No trailing slash and no spaces."
    return None


def no_space(v):
    return "No spaces allowed." if re.search(r"\s", v) else None


def bucket_check(v):
    return None if re.match(r"^[a-z0-9][a-z0-9-]{2,62}$", v) else "Lowercase letters, numbers and hyphens only (3-63 chars)."


def backup(path):
    if os.path.exists(path):
        dest = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, dest)
        os.chmod(dest, 0o600)
        print(f"  (existing {os.path.relpath(path, ROOT)} saved as {os.path.basename(dest)})")


def write_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
    os.chmod(path, 0o600)


def build_backend_env(values):
    """Start from .env.example (keeps every comment and default), then set only the keys we collected."""
    remaining = dict(values)
    out = []
    with open(EXAMPLE) as fh:
        for line in fh:
            m = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
            if m and m.group(1) in remaining:
                out.append(f"{m.group(1)}={remaining.pop(m.group(1))}\n")
            else:
                out.append(line)
    if remaining:  # keys not in the example file
        out.append("\n# --- Added by deploy/setup_env.py ---\n")
        out += [f"{k}={v}\n" for k, v in remaining.items()]
    return "".join(out)


def main():
    if not os.path.exists(EXAMPLE):
        sys.exit("Run this from the project (backend/.env.example not found).")
    print("WolbiRides production setup. Press Enter to accept a [default]. Secrets are typed hidden.")

    print("\n=== 1. Your domain ===")
    domain = ask("Base domain you own", check=host_check, hint="Example: wolbirides.com")
    passenger = ask("Passenger web address", f"app.{domain}", check=host_check)
    rider = ask("Rider web address", f"rider.{domain}", check=host_check)
    admin = ask("Admin (ops) web address", f"ops.{domain}", check=host_check)
    if len({passenger, rider, admin}) != 3:
        sys.exit("The three addresses must all be different.")
    acme = ask("Email for HTTPS certificate notices", check=email_check)

    print("\n=== 2. Email (Resend) ===")
    resend_key = ask("Resend API key", secret=True, check=no_space, hint="Starts with re_ . Resend dashboard > API Keys.")
    from_default = f"WolbiRides <no-reply@{domain}>"
    from_addr = ask("Send emails from", from_default,
                    hint="Must be on a domain you've VERIFIED in Resend, or every email is rejected.")

    print("\n=== 3. Cloudflare R2 (file storage) ===")
    r2_account = ask("R2 Account ID", check=no_space, hint="Cloudflare dashboard > R2 Object Storage (right-hand side).")
    r2_key = ask("R2 Access Key ID", secret=True, check=no_space)
    r2_secret = ask("R2 Secret Access Key", secret=True, check=no_space)
    pub_bucket = ask("Public bucket name", "wolbirides-public-media", check=bucket_check)
    priv_bucket = ask("Private bucket name", "wolbirides-private-media", check=bucket_check)
    if pub_bucket == priv_bucket:
        sys.exit("The public and private buckets must be two different buckets.")
    pub_url = ask("Public files address", f"https://files.{domain}", check=url_check,
                  hint="The custom domain connected to the PUBLIC bucket. The private bucket must have none.")

    print("\n=== 4. SMS (Africa's Talking) ===")
    at_user = ask("Africa's Talking username", required=False, check=no_space,
                  hint="Your live app username (not 'sandbox'). Leave blank to skip: phone codes then won't send.")
    at_key = ask("Africa's Talking API key", secret=True, required=False, check=no_space) if at_user else ""

    print("\n=== 5. AI assistant (optional) ===")
    anthropic = ask("Anthropic API key", secret=True, required=False, check=no_space, hint="Leave blank to switch the assistant off.")

    prod = (
        "# Production settings. Written by deploy/setup_env.py. Never commit this file.\n"
        f"PASSENGER_HOST={passenger}\nDRIVER_HOST={rider}\nADMIN_HOST={admin}\nACME_EMAIL={acme}\n"
        f"POSTGRES_PASSWORD={secrets.token_urlsafe(24)}\n"
        f"DJANGO_SECRET_KEY={secrets.token_urlsafe(64)}\n"
        f"DJANGO_ADMIN_PATH=ops-{secrets.token_hex(5)}\n"
        "DJANGO_SECURE_HSTS_SECONDS=2592000\n"
    )
    backend = build_backend_env({
        "DJANGO_DEBUG": "False",
        "DJANGO_SECRET_KEY": "",  # set in deploy/.env.prod
        "DJANGO_ALLOWED_HOSTS": "",  # set by docker-compose.prod.yml from the three addresses
        "RESEND_API_KEY": resend_key,
        "DEFAULT_FROM_EMAIL": from_addr,
        "R2_ACCOUNT_ID": r2_account,
        "R2_ACCESS_KEY_ID": r2_key,
        "R2_SECRET_ACCESS_KEY": r2_secret,
        "R2_BUCKET": pub_bucket,
        "R2_PUBLIC_BASE_URL": pub_url,
        "R2_PRIVATE_BUCKET": priv_bucket,
        "AFRICASTALKING_USERNAME": at_user,
        "AFRICASTALKING_API_KEY": at_key,
        "ANTHROPIC_API_KEY": anthropic,
        "MOMO_DEV_AUTO_APPROVE": "False",
        "HUBTEL_DEV_AUTO_APPROVE": "False",
        "PASSENGER_WEB_URL": f"https://{passenger}",
    })

    print("\n=== Writing files ===")
    backup(PROD)
    backup(BACKEND)
    write_private(PROD, prod)
    write_private(BACKEND, backend)
    print("  wrote deploy/.env.prod and backend/.env (owner-only permissions)")

    print(f"""
Done. Nothing secret was printed. Next:

  1. DNS: create three A records pointing at this server's public IP:
       {passenger}   {rider}   {admin}
     plus {urlparse_host(pub_url)} connected to the PUBLIC R2 bucket (Cloudflare handles that one).
  2. Resend: confirm {from_addr.split('@')[-1].rstrip('>')} shows "Verified" in Resend > Domains.
  3. R2: confirm the PRIVATE bucket has no custom domain and r2.dev access is off.
  4. Run:  ./deploy/deploy.sh      (it checks everything first and refuses to start if anything is wrong)
  5. Back up deploy/.env.prod somewhere safe (a password manager). If you lose the database password
     or secret key you cannot recover them.
""")


def urlparse_host(url):
    return url.replace("https://", "").split("/")[0]


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nCancelled. Nothing was written.")
