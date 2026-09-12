import uuid

import cloudinary.uploader
from django.conf import settings
from rest_framework import serializers
from rest_framework.generics import ListAPIView
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Notification

ALLOWED_KINDS = {"licence_document", "vehicle_registration_document", "vehicle_photo", "profile_photo"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8MB — plenty for a phone photo of a document


class DocumentUploadView(APIView):
    """
    POST /api/uploads/document — multipart file upload proxied straight to
    Cloudinary (WR-07.2 driver verification documents; also used for
    passenger/driver profile photos). Keeping the Cloudinary secret on the
    backend, rather than exposing an unsigned upload preset to the client,
    is worth the extra hop for anything tied to identity documents.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        kind = request.data.get("kind", "")
        if kind not in ALLOWED_KINDS:
            return Response({"detail": f"kind must be one of {sorted(ALLOWED_KINDS)}"}, status=400)

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "No file provided."}, status=400)
        if upload.size > MAX_UPLOAD_BYTES:
            return Response({"detail": "File is too large (max 8MB)."}, status=400)

        try:
            result = cloudinary.uploader.upload(
                upload,
                folder=f"wolbirides/{kind}",
                public_id=str(uuid.uuid4()),
                resource_type="auto",
            )
        except Exception:
            return Response({"detail": "Upload failed — try again."}, status=502)

        return Response({"url": result["secure_url"], "kind": kind}, status=201)


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "category", "title", "body", "link", "read", "created_at"]
        read_only_fields = fields


class NotificationListView(ListAPIView):
    """GET /api/notifications — newest first, capped to the last 50."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)[:50]


class NotificationMarkReadView(APIView):
    """POST /api/notifications/<id>/read"""

    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id):
        updated = Notification.objects.filter(id=notification_id, user=request.user).update(read=True)
        if not updated:
            return Response({"detail": "Not found"}, status=404)
        return Response({"detail": "ok"})


class NotificationMarkAllReadView(APIView):
    """POST /api/notifications/read-all"""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        Notification.objects.filter(user=request.user, read=False).update(read=True)
        return Response({"detail": "ok"})


# --- AI Assistant (role-aware, server-side key) -------------------------

ASSISTANT_SYSTEM_PROMPTS = {
    "passenger": (
        "You are the WolbiRides in-app assistant for a passenger using the "
        "UDS campus ride-hailing pilot. Help with booking a ride, understanding "
        "trip status, fares, and app features. Be brief and concrete. You "
        "cannot see live trip data yourself — if the passenger asks about a "
        "specific trip's status, tell them to check the trip screen or contact "
        "support, rather than guessing."
    ),
    "driver": (
        "You are the WolbiRides in-app assistant for a founding driver on the "
        "UDS campus pilot. Help with going online/offline, understanding "
        "earnings (gross fare, not take-home pay yet), the verification process, "
        "and app features. Be brief and concrete."
    ),
    "admin": (
        "You are the WolbiRides ops-console assistant for an admin or support "
        "agent running the UDS pilot. Help interpret dashboard metrics, the "
        "driver verification workflow, incident severity levels (P0-P3), and "
        "general ops questions. Be brief and concrete."
    ),
}
ASSISTANT_SYSTEM_PROMPTS["support"] = ASSISTANT_SYSTEM_PROMPTS["admin"]


class AssistantChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)
    history = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class AssistantChatView(APIView):
    """
    POST /api/assistant/chat — role-aware AI assistant, one endpoint shared
    by all three frontends. The system prompt is chosen from the caller's
    own role, so the same UI component works everywhere.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not settings.ANTHROPIC_API_KEY:
            return Response(
                {"detail": "The AI assistant isn't configured yet — set ANTHROPIC_API_KEY on the backend."},
                status=503,
            )

        serializer = AssistantChatSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            import anthropic
        except ImportError:
            return Response({"detail": "The anthropic package isn't installed on the server."}, status=503)

        role = getattr(request.user, "role", "passenger")
        system_prompt = ASSISTANT_SYSTEM_PROMPTS.get(role, ASSISTANT_SYSTEM_PROMPTS["passenger"])

        messages = list(serializer.validated_data.get("history", []))[-10:]
        messages.append({"role": "user", "content": serializer.validated_data["message"]})

        try:
            client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            response = client.messages.create(
                model="claude-sonnet-5",
                max_tokens=500,
                system=system_prompt,
                messages=messages,
            )
            reply_text = "".join(block.text for block in response.content if block.type == "text")
        except Exception:
            return Response({"detail": "The assistant couldn't respond right now — try again shortly."}, status=502)

        return Response({"reply": reply_text})
