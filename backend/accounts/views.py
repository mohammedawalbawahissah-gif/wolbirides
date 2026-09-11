from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.serializers import OTPRequestSerializer, OTPVerifySerializer, UserSerializer
from accounts.services import request_otp, verify_otp


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
