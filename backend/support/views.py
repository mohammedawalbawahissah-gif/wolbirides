from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from support.serializers import SupportTicketSerializer


class SupportTicketCreateView(APIView):
    """POST /api/support/tickets — PRD Section 7."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = SupportTicketSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.save(user=request.user)
        return Response(SupportTicketSerializer(ticket).data, status=status.HTTP_201_CREATED)
