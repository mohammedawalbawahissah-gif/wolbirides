"""File storage on Cloudflare R2 (S3-compatible).

Uploads go through the backend so the R2 keys never reach a browser or phone. Two buckets:

* PUBLIC (R2_BUCKET): profile and vehicle photos. Random file names, served from R2_PUBLIC_BASE_URL
  (a custom domain on the bucket, or its r2.dev address).
* PRIVATE (R2_PRIVATE_BUCKET): identity and compliance documents (licence, Ghana Card, vehicle
  registration, union card, roadworthy certificate). No public access of any kind. The database keeps the
  plain bucket address (useless without credentials) and every API response that returns one swaps in a
  short-lived signed link (R2_SIGNED_URL_SECONDS, default 10 minutes) via `sign()`.
"""
import uuid

from django.conf import settings

# What we store, keyed by what the file's bytes actually are (never by client-supplied names).
CONTENT_TYPES = {
    "JPEG": ("image/jpeg", "jpg"),
    "MPO": ("image/jpeg", "jpg"),  # multi-picture JPEG, which some phone cameras write
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
    "GIF": ("image/gif", "gif"),
    "HEIF": ("image/heic", "heic"),
    "PDF": ("application/pdf", "pdf"),
}

# Kinds stored in the private bucket (everything in core.views.DOCUMENT_KINDS).
PRIVATE_KINDS = {"licence_document", "vehicle_registration_document", "ghana_card_document",
                 "union_card_document", "roadworthy_certificate"}

_client = None


def is_private(kind):
    return kind in PRIVATE_KINDS


def is_configured(kind=None):
    """Whether uploads of `kind` (or, with no kind, both kinds) can be stored."""
    base = all([settings.R2_ACCOUNT_ID, settings.R2_ACCESS_KEY_ID, settings.R2_SECRET_ACCESS_KEY])
    public = all([settings.R2_BUCKET, settings.R2_PUBLIC_BASE_URL])
    private = bool(settings.R2_PRIVATE_BUCKET)
    if kind is None:
        return base and public and private
    return base and (private if is_private(kind) else public)


def _endpoint():
    return f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"


def _private_prefix():
    """The address every private object starts with, or "" when the private bucket isn't configured."""
    if not (settings.R2_ACCOUNT_ID and settings.R2_PRIVATE_BUCKET):
        return ""
    return f"{_endpoint()}/{settings.R2_PRIVATE_BUCKET}/"


def canonicalize(value):
    """What to store: a signed link to a private object is reduced to its plain, unsigned address, so
    sending back a link the API gave you (a form re-save) never saves an expiring URL."""
    prefix = _private_prefix()
    if prefix and isinstance(value, str) and value.startswith(prefix):
        return value.split("?", 1)[0]
    return value


def sign(value):
    """For API output: a private object's stored address becomes a short-lived signed link.
    Anything else (blank, public photo URLs, older links) is returned unchanged."""
    prefix = _private_prefix()
    if not (prefix and isinstance(value, str) and value.startswith(prefix)):
        return value
    key = value[len(prefix):].split("?", 1)[0]
    return _get_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.R2_PRIVATE_BUCKET, "Key": key},
        ExpiresIn=settings.R2_SIGNED_URL_SECONDS,
    )


def _get_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=_endpoint(),
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}, connect_timeout=5, read_timeout=30),
        )
    return _client


def upload(fileobj, kind, file_type):
    """Store `fileobj` and return a URL the uploader can show right away: the public address for photos,
    a short-lived signed link for private documents. `file_type` is a key of CONTENT_TYPES."""
    content_type, ext = CONTENT_TYPES[file_type]
    key = f"wolbirides/{kind}/{uuid.uuid4()}.{ext}"
    fileobj.seek(0)
    if is_private(kind):
        _get_client().upload_fileobj(
            fileobj,
            settings.R2_PRIVATE_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type, "CacheControl": "private, no-store"},
        )
        return sign(f"{_private_prefix()}{key}")
    _get_client().upload_fileobj(
        fileobj,
        settings.R2_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"},
    )
    return f"{settings.R2_PUBLIC_BASE_URL.rstrip('/')}/{key}"
