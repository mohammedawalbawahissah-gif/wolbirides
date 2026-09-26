from core.throttling import ActionRateThrottle
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from support.models import SupportTicket
from support.serializers import SupportTicketSerializer


class SupportTicketCreateView(APIView):
    """POST /api/support/tickets {category, subject, description, trip?} ; GET = my tickets (PRD Section 7)."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ActionRateThrottle]
    throttle_scope = "support_ticket"

    def get(self, request):
        tickets = SupportTicket.objects.filter(user=request.user).order_by("-created_at")[:50]
        return Response(SupportTicketSerializer(tickets, many=True).data)

    def post(self, request):
        serializer = SupportTicketSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        ticket = serializer.save(user=request.user)
        from core.models import notify

        notify(request.user, "We've got your message",
               "Our support team will get back to you here. You can see its status under Help & support.",
               category="system")
        return Response(SupportTicketSerializer(ticket).data, status=status.HTTP_201_CREATED)
