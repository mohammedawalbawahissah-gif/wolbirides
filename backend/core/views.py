import logging

from core.throttling import ActionRateThrottle
from django.conf import settings
from PIL import Image
from rest_framework import serializers
from rest_framework.generics import ListAPIView
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core import storage
from core.models import Notification

ALLOWED_KINDS = {"licence_document", "vehicle_registration_document", "vehicle_photo", "profile_photo",
                 "ghana_card_document", "union_card_document", "roadworthy_certificate"}
IMAGE_ONLY_KINDS = {"vehicle_photo", "profile_photo"}
DOCUMENT_KINDS = {"licence_document", "vehicle_registration_document",  # image or PDF
                  "ghana_card_document", "union_card_document", "roadworthy_certificate"}
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8MB — plenty for a phone photo of a document


def _looks_like_pdf(upload):
    """Checks the actual file bytes, not the client-supplied filename/Content-Type
    (both trivially spoofable) — genuine PDFs start with the %PDF- magic header."""
    upload.seek(0)
    header = upload.read(5)
    upload.seek(0)
    return header == b"%PDF-"


def _looks_like_valid_image(upload):
    """
    Actually attempts to parse the file as image data via Pillow, rather than
    trusting the extension or Content-Type header — a renamed .exe or .html
    file with a .jpg extension will fail this, where a naive extension check
    would have waved it through.
    """
    upload.seek(0)
    try:
        Image.open(upload).verify()
        valid = True
    except Exception:
        valid = False
    upload.seek(0)
    return valid


def _detected_type(upload, kind):
    """The file's real type from its bytes (a key of storage.CONTENT_TYPES), or None if not allowed."""
    if kind in DOCUMENT_KINDS and _looks_like_pdf(upload):
        return "PDF"
    upload.seek(0)
    try:
        fmt = Image.open(upload).format
    except Exception:
        fmt = None
    upload.seek(0)
    return fmt if fmt in storage.CONTENT_TYPES and fmt != "PDF" else None


class DocumentUploadView(APIView):
    """
    POST /api/uploads/document — multipart file upload stored in Cloudflare R2
    (WR-07.2 driver verification documents; also used for passenger/driver
    profile photos). The R2 keys stay on the backend rather than being handed
    to the client, which is worth the extra hop for anything tied to identity
    documents.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        if not storage.is_configured(request.data.get("kind", "")):
            return Response(
                {"detail": "File uploads aren't configured yet — set the R2_* settings (including R2_PRIVATE_BUCKET for documents) on the backend."},
                status=503,
            )

        kind = request.data.get("kind", "")
        if kind not in ALLOWED_KINDS:
            return Response({"detail": f"kind must be one of {sorted(ALLOWED_KINDS)}"}, status=400)

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "No file provided."}, status=400)
        if upload.size > MAX_UPLOAD_BYTES:
            return Response({"detail": "File is too large (max 8MB)."}, status=400)

        # Validate actual file content, not just the size/kind — previously
        # any file type was accepted as long as it was under the size limit,
        # which meant arbitrary files (not just images/PDFs) could be stored
        # in storage under identity-document folders.
        if kind in IMAGE_ONLY_KINDS:
            if not _looks_like_valid_image(upload):
                return Response({"detail": "That doesn't look like a valid image file."}, status=400)
        elif kind in DOCUMENT_KINDS:
            if not (_looks_like_pdf(upload) or _looks_like_valid_image(upload)):
                return Response({"detail": "Documents must be an image or PDF file."}, status=400)

        file_type = _detected_type(upload, kind)
        if file_type is None:  # unreachable after the checks above, but never store an unrecognised file
            return Response({"detail": "Unsupported file type."}, status=400)
        try:
            url = storage.upload(upload, kind, file_type)
        except Exception:
            logger.exception("R2 upload failed")
            return Response({"detail": "Upload failed — try again."}, status=502)

        return Response({"url": url, "kind": kind}, status=201)


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


class NotificationPreferencesView(APIView):
    """
    GET/PATCH /api/notifications/preferences — WR-16. Only ever lists
    categories that can actually be turned off (Notification.
    OPTIONAL_CATEGORIES) — functional categories (trip, payout, incident)
    aren't shown here at all, since there's no toggle to show.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from core.models import NotificationPreference

        existing = {
            p.category: p.enabled
            for p in NotificationPreference.objects.filter(
                user=request.user, category__in=Notification.OPTIONAL_CATEGORIES
            )
        }
        return Response([
            {"category": cat.value, "label": cat.label, "enabled": existing.get(cat.value, True)}
            for cat in Notification.OPTIONAL_CATEGORIES
        ])

    def patch(self, request):
        from core.models import NotificationPreference

        updates = request.data if isinstance(request.data, list) else request.data.get("preferences", [])
        valid_categories = {cat.value for cat in Notification.OPTIONAL_CATEGORIES}
        for item in updates:
            category = item.get("category")
            if category not in valid_categories:
                continue
            NotificationPreference.objects.update_or_create(
                user=request.user, category=category, defaults={"enabled": bool(item.get("enabled", True))}
            )
        return self.get(request)


# --- AI Assistant (role-aware, server-side key) -------------------------

# The three kinds of people, in the words the app uses everywhere. The model is told them outright so it
# never calls a rider a "driver" or a passenger a "rider".
ASSISTANT_TERMS = (
    "\n\nTerminology (use these words exactly, and never any others for these people): a PASSENGER books "
    "rides and deliveries; a RIDER is the person who carries them out (never call them a driver); an ADMIN is "
    "a member of the WolbiRides team."
)

ASSISTANT_SYSTEM_PROMPTS = {
    "passenger": (
        "You are the WolbiRides in-app assistant for a passenger using the "
        "UDS campus ride-hailing pilot. Help with booking a ride, understanding "
        "trip status, fares, and app features. Be brief and concrete. You "
        "cannot see live trip data yourself unless a specific trip's details "
        "are provided to you below — if no trip context is given and the "
        "passenger asks about a specific trip, tell them to check the trip "
        "screen or contact support, rather than guessing.\n\n"
        "IMPORTANT: you can never issue, promise, or apply a refund or fare "
        "adjustment yourself, even if a passenger's complaint seems clearly "
        "justified — fare/refund decisions are a human support action, not "
        "something you can do. Explain the charge as best you can from the "
        "trip data given, and if that doesn't resolve it, tell the passenger "
        "you're escalating to support and that they should also expect a "
        "human follow-up.\n\n"
        "If the passenger's message is a request to book a ride (e.g. \"book "
        "me a ride to the library\", \"take me home\", \"usual ride to "
        "campus\"), use the draft_ride_request tool rather than trying to "
        "confirm the booking yourself in text. Only use it when you can "
        "resolve both pickup and destination against the passenger's saved "
        "places listed below (or the trip context's pickup/destination when "
        "they say \"there again\" or similar) — if you can't confidently "
        "resolve a place, ask a brief clarifying question instead of "
        "guessing at coordinates."
    ),
    "driver": (
        "You are the WolbiRides in-app assistant for a founding rider on the "
        "UDS campus pilot. Help with going online/offline, understanding "
        "earnings (gross fare, not take-home pay yet), the verification process, "
        "and app features. Be brief and concrete."
    ),
    "admin": (
        "You are the WolbiRides ops-console assistant for an admin or support "
        "agent running the UDS pilot. Help interpret dashboard metrics, the "
        "rider verification workflow, incident severity levels (P0-P3), and "
        "general ops questions. Be brief and concrete."
    ),
}
ASSISTANT_SYSTEM_PROMPTS["support"] = ASSISTANT_SYSTEM_PROMPTS["admin"]
ASSISTANT_SYSTEM_PROMPTS = {role: prompt + ASSISTANT_TERMS for role, prompt in ASSISTANT_SYSTEM_PROMPTS.items()}

# WR-15: lets the assistant draft a bookable trip rather than just describing
# one in prose — the frontend renders a tool_use response as a confirmable
# card. The assistant never submits a trip itself; POST /api/trips still
# runs the same validation and server-side fare computation as any other
# request (WR-10's fare-manipulation fix applies identically here).
DRAFT_RIDE_TOOL = {
    "name": "draft_ride_request",
    "description": (
        "Propose a ride for the passenger to review and confirm. Only call "
        "this once you can resolve both pickup and destination to specific "
        "coordinates from the passenger's saved places or trip context "
        "given to you — never invent coordinates."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "pickup_label": {"type": "string"},
            "pickup_lat": {"type": "number"},
            "pickup_lng": {"type": "number"},
            "destination_label": {"type": "string"},
            "destination_lat": {"type": "number"},
            "destination_lng": {"type": "number"},
        },
        "required": ["pickup_label", "pickup_lat", "pickup_lng", "destination_label", "destination_lat", "destination_lng"],
    },
}


def _build_trip_context_block(trip):
    """Plain-language fare/trip breakdown handed to the assistant as context —
    never the raw model objects, so the model can't accidentally leak fields
    beyond what's relevant to explaining a fare."""
    fare = trip.fare_quote
    lines = [
        f"Trip status: {trip.status}",
        f"Pickup: {trip.pickup_label or 'Pickup'}",
        f"Destination: {trip.destination_label or 'Destination'}",
    ]
    if fare:
        lines += [
            f"Distance: {fare.distance_km} km",
            f"Base fare: GHS {fare.base_fare}",
            f"Per-km charge: GHS {fare.per_km_charge}",
            f"Quoted total: GHS {fare.total}",
        ]
    if trip.fare_final:
        lines.append(f"Final charged fare: GHS {trip.fare_final}")
    if trip.cancel_reason:
        lines.append(f"Cancellation reason: {trip.cancel_reason} (cancelled by {trip.cancelled_by})")
    return "\n".join(lines)


def _build_saved_places_block(user):
    from accounts.models import SavedAddress

    places = SavedAddress.objects.filter(user=user).order_by("-usage_count")[:10]
    if not places:
        return "The passenger has no saved places yet."
    return "\n".join(f"- {p.label}: lat={p.lat}, lng={p.lng}" for p in places)


class _HistoryTurnSerializer(serializers.Serializer):
    """One earlier chat turn sent back by the app. Bounded so a client can't inflate
    what we send to the (paid) model, or forge a system prompt."""

    role = serializers.ChoiceField(choices=["user", "assistant"])
    content = serializers.CharField(max_length=2000, allow_blank=True)


class AssistantChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)
    history = serializers.ListField(child=_HistoryTurnSerializer(), required=False, default=list, max_length=10)
    trip_id = serializers.UUIDField(required=False, allow_null=True)


class AssistantChatView(APIView):
    """
    POST /api/assistant/chat — role-aware AI assistant, one endpoint shared
    by all three frontends. The system prompt is chosen from the caller's
    own role, so the same UI component works everywhere.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ActionRateThrottle]
    throttle_scope = "assistant"

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

        trip = None
        trip_id = serializer.validated_data.get("trip_id")
        if trip_id:
            from trips.models import Trip
            from trips.services import user_can_access_trip

            trip = Trip.objects.filter(id=trip_id).select_related("fare_quote").first()
            if not trip or not user_can_access_trip(request.user, trip):
                return Response({"detail": "Trip not found."}, status=404)
            system_prompt += "\n\n--- Trip context (use this to answer, never invent figures) ---\n"
            system_prompt += _build_trip_context_block(trip)

        tools = []
        if role == "passenger":
            system_prompt += "\n\n--- Passenger's saved places ---\n" + _build_saved_places_block(request.user)
            tools = [DRAFT_RIDE_TOOL]

        messages = list(serializer.validated_data.get("history", []))[-10:]
        messages.append({"role": "user", "content": serializer.validated_data["message"]})

        try:
            client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            response = client.messages.create(
                model="claude-sonnet-5",
                max_tokens=500,
                system=system_prompt,
                messages=messages,
                tools=tools or None,
            )
        except Exception:
            return Response({"detail": "The assistant couldn't respond right now — try again shortly."}, status=502)

        reply_text = "".join(block.text for block in response.content if block.type == "text")
        draft_trip = None
        for block in response.content:
            if block.type == "tool_use" and block.name == "draft_ride_request":
                draft_trip = block.input

        if trip_id:
            # WR-15 guardrail: log every assistant interaction that
            # references a specific trip, same anti-fraud visibility
            # principle already applied to distance-mismatch events.
            from trips.models import TripEvent

            TripEvent.objects.create(
                trip=trip,
                event_type="assistant_interaction",
                payload={"user_message": serializer.validated_data["message"][:500], "role": role},
            )

        result = {"reply": reply_text}
        if draft_trip:
            result["draft_trip"] = draft_trip
        return Response(result)


class DeviceTokenView(APIView):
    """POST /api/devices {token, platform, app} registers a phone for push; DELETE {token} on sign-out."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from core.models import DeviceToken

        token = (request.data.get("token") or "").strip()
        if not token.startswith("ExponentPushToken[") and not token.startswith("ExpoPushToken["):
            return Response({"detail": "Not an Expo push token."}, status=400)
        DeviceToken.objects.update_or_create(token=token, defaults={
            "user": request.user, "platform": (request.data.get("platform") or "")[:10],
            "app": (request.data.get("app") or "")[:20]})
        return Response({"registered": True})

    def delete(self, request):
        from core.models import DeviceToken

        DeviceToken.objects.filter(user=request.user, token=request.data.get("token", "")).delete()
        return Response(status=204)
