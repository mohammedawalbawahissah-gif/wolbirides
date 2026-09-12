from rest_framework import status
from rest_framework.generics import ListCreateAPIView, DestroyAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import SavedAddress
from accounts.serializers import (
    EmailLoginSerializer,
    EmailOTPRequestSerializer,
    EmailSignupSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    SavedAddressSerializer,
    UserSerializer,
)
from accounts.services import (
    login_with_email,
    request_email_otp,
    request_otp,
    signup_with_email,
    verify_otp,
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

    def post(self, request):
        serializer = EmailOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_email_otp(serializer.validated_data["email"])
        return Response({"detail": "Verification code sent"}, status=status.HTTP_200_OK)


class SignupView(APIView):
    """POST /api/auth/signup — email+password+OTP account creation."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = EmailSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = signup_with_email(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return _token_pair_response(user)


class LoginView(APIView):
    """POST /api/auth/login — email+password sign-in."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = EmailLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = login_with_email(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return _token_pair_response(user)


class AdminLoginView(APIView):
    """POST /api/admin/auth/login — same as LoginView but role-gated."""

    permission_classes = [AllowAny]

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


class OTPRequestView(APIView):
    """POST /api/auth/otp/request  — PRD Section 7."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_otp(serializer.validated_data["phone"])
        return Response({"detail": "OTP sent"}, status=status.HTTP_200_OK)


class OTPVerifyView(APIView):
    """POST /api/auth/otp/verify — returns JWT pair on success."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = verify_otp(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        refresh = RefreshToken.for_user(user)
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        })


class AdminOTPVerifyView(APIView):
    """
    POST /api/admin/auth/otp/verify — same OTP flow as the passenger/driver
    apps, but refuses to issue a token unless the account's role is admin
    or support. Keeps the admin dashboard from silently working for a
    passenger account that guesses the endpoint.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, error = verify_otp(**serializer.validated_data)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        if user.role not in ("admin", "support"):
            return Response({"detail": "This account is not authorized for the admin dashboard"}, status=403)
        refresh = RefreshToken.for_user(user)
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        })


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
