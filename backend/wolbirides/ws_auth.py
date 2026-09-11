"""
Websocket connections can't send an Authorization header from most mobile
websocket clients, so the JWT access token is passed as a query param
(?token=...) and validated here before the connection is handed to Django's
normal auth machinery. This mirrors the REST API's SimpleJWT setup so both
transports trust the same tokens.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def get_user_from_token(token):
    from accounts.models import User

    try:
        validated = AccessToken(token)
        return User.objects.get(id=validated["user_id"])
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query_string = parse_qs(scope.get("query_string", b"").decode())
        token = query_string.get("token", [None])[0]
        scope["user"] = await get_user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)
