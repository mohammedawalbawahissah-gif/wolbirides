"""File storage on Cloudflare R2 (S3-compatible).

Uploads go through the backend so the R2 keys never reach a browser or phone. Files are stored
under an unguessable random name and served from R2_PUBLIC_BASE_URL (a custom domain on the
bucket, or the bucket's r2.dev address).
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

_client = None


def is_configured():
    return all(
        [
            settings.R2_ACCOUNT_ID,
            settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY,
            settings.R2_BUCKET,
            settings.R2_PUBLIC_BASE_URL,
        ]
    )


def _get_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}, connect_timeout=5, read_timeout=30),
        )
    return _client


def upload(fileobj, kind, file_type):
    """Store `fileobj` and return its public URL. `file_type` is a key of CONTENT_TYPES."""
    content_type, ext = CONTENT_TYPES[file_type]
    key = f"wolbirides/{kind}/{uuid.uuid4()}.{ext}"
    fileobj.seek(0)
    _get_client().upload_fileobj(
        fileobj,
        settings.R2_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=31536000, immutable"},
    )
    return f"{settings.R2_PUBLIC_BASE_URL.rstrip('/')}/{key}"
