from rest_framework import status
from rest_framework.generics import ListCreateAPIView, DestroyAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import RecurringRideSchedule, SavedAddress
from accounts.serializers import (
    EmailLoginSerializer,
    EmailOTPRequestSerializer,
    EmailSignupSerializer,
    RecurringRideScheduleSerializer,
    SavedAddressSerializer,
    SuggestedRideSerializer,
    UserSerializer,
)
from accounts.services import (
    get_suggested_ride,
    login_with_email,
    request_email_otp,
    signup_with_email,
)
from core.throttling import (
    EmailLoginThrottle,
    EmailOTPRequestThrottle,
    SignupThrottle,
)


def _token_pair_response(user):
    refresh = RefreshToken.for_user(user)
    return Response({
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserSerializer(user).data,
    })


class EmailOTPRequestView(APIView):
    """POST /api/auth/email/otp/request — sends a signup verification code."""

    permission_classes = [AllowAny]
    throttle_classes = [EmailOTPRequestThrottle]

    def post(self, request):
        serializer = EmailOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_email_otp(serializer.validated_data["email"])
        return Response({"detail": "Verification code sent"}, status=status.HTTP_200_OK)


class SignupView(APIView):
    """POST /api/auth/signup — email+password+OTP account creation."""

    permission_classes = [AllowAny]
    throttle_classes = [SignupThrottle]

    def post(self, request):
        serializer = EmailSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = signup_with_email(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return _token_pair_response(user)


class LoginView(APIView):
    """
    POST /api/auth/login — email+password sign-in for the passenger apps.

    SECURITY: role-gated to "passenger" only. Before this check existed, this endpoint
    authenticated ANY account regardless of role — a rider (role="driver") or admin account
    could sign in here and receive a valid token pair, same as AdminLoginView already guarded
    against for its own portal but this one never did. Password is still checked first, so a
    wrong password always reads as "Incorrect email or password" for every role, same as before;
    only a *correct* password for a non-passenger account now gets turned away, with a plain
    explanation rather than being let through.
    """

    permission_classes = [AllowAny]
    throttle_classes = [EmailLoginThrottle]

    def post(self, request):
        serializer = EmailLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = login_with_email(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        if user.role != "passenger":
            return Response({"detail": "This account is not authorized for the passenger app"}, status=403)
        return _token_pair_response(user)


class DriverLoginView(APIView):
    """
    POST /api/drivers/auth/login — email+password sign-in for the rider (driver-role) apps.

    SECURITY: the counterpart to LoginView's new passenger gate — a passenger account must not
    be able to sign in to the rider portal either. Previously both passenger and rider apps
    shared the ungated /api/auth/login, so either account type could authenticate into either
    portal. See LoginView's docstring for the full explanation.
    """

    permission_classes = [AllowAny]
    throttle_classes = [EmailLoginThrottle]

    def post(self, request):
        serializer = EmailLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = login_with_email(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        if user.role != "driver":
            return Response({"detail": "This account is not authorized for the rider app"}, status=403)
        return _token_pair_response(user)


class AdminLoginView(APIView):
    """POST /api/admin/auth/login — same as LoginView but role-gated."""

    permission_classes = [AllowAny]
    throttle_classes = [EmailLoginThrottle]

    def post(self, request):
        serializer = EmailLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = login_with_email(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        if user.role not in ("admin", "support"):
            return Response({"detail": "This account is not authorized for the admin dashboard"}, status=403)
        return _token_pair_response(user)


class SavedAddressListView(ListCreateAPIView):
    """GET/POST /api/passengers/me/addresses"""

    # A person's own short list: every app expects a plain JSON array, and the
    # global 20-per-page pagination would silently hide anything past 20.
    pagination_class = None
    serializer_class = SavedAddressSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SavedAddress.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class SavedAddressDeleteView(DestroyAPIView):
    """DELETE /api/passengers/me/addresses/<id>"""

    serializer_class = SavedAddressSerializer
    permission_classes = [IsAuthenticated]
    lookup_url_kwarg = "address_id"

    def get_queryset(self):
        return SavedAddress.objects.filter(user=self.request.user)


class SuggestedRideView(APIView):
    """
    GET /api/passengers/me/suggested-ride — WR-13. Returns the passenger's
    most-repeated pickup/destination pair over the last 30 days, or a
    clear "not enough data yet" response rather than guessing from a
    single trip.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        suggestion = get_suggested_ride(request.user)
        if not suggestion:
            return Response(None)
        return Response(SuggestedRideSerializer(suggestion).data)


class RecurringRideScheduleListView(ListCreateAPIView):
    """GET/POST /api/passengers/me/recurring-rides"""

    # A person's own short list: every app expects a plain JSON array, and the
    # global 20-per-page pagination would silently hide anything past 20.
    pagination_class = None
    serializer_class = RecurringRideScheduleSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return RecurringRideSchedule.objects.filter(passenger=self.request.user).select_related("pickup", "destination")

    def perform_create(self, serializer):
        serializer.save(passenger=self.request.user)


class RecurringRideScheduleDetailView(RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/passengers/me/recurring-rides/<id>"""

    serializer_class = RecurringRideScheduleSerializer
    permission_classes = [IsAuthenticated]
    lookup_url_kwarg = "schedule_id"

    def get_queryset(self):
        return RecurringRideSchedule.objects.filter(passenger=self.request.user)


class MeView(APIView):
    """GET/PATCH /api/passengers/me — PRD Section 7."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PasswordResetRequestView(APIView):
    """POST /api/auth/password/reset/request {email} — always answers the same way (no account enumeration)."""

    permission_classes = [AllowAny]
    throttle_classes = [EmailOTPRequestThrottle]

    def post(self, request):
        from accounts.services import request_password_reset

        email = (request.data.get("email") or "").strip().lower()
        if "@" not in email:
            return Response({"detail": "Enter the email you signed up with."}, status=status.HTTP_400_BAD_REQUEST)
        request_password_reset(email)
        return Response({"detail": "If an account uses that email, we've sent it a reset code."})


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password/reset/confirm {email, code, new_password} — signs you in on success."""

    permission_classes = [AllowAny]
    throttle_classes = [EmailLoginThrottle]

    def post(self, request):
        from accounts.services import reset_password

        user, error = reset_password(
            (request.data.get("email") or "").strip().lower(),
            (request.data.get("code") or "").strip(),
            request.data.get("new_password") or "",
        )
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return _token_pair_response(user)
