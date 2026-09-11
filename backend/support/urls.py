from django.urls import path

from support.views import SupportTicketCreateView

urlpatterns = [
    path("support/tickets", SupportTicketCreateView.as_view(), name="support-ticket-create"),
]
