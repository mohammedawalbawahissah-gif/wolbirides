from django.urls import path

from core.views import (
    AssistantChatView,
    DocumentUploadView,
    NotificationListView,
    NotificationMarkAllReadView,
    NotificationMarkReadView,
)

urlpatterns = [
    path("uploads/document", DocumentUploadView.as_view(), name="document-upload"),
    path("notifications", NotificationListView.as_view(), name="notification-list"),
    path("notifications/read-all", NotificationMarkAllReadView.as_view(), name="notification-read-all"),
    path("notifications/<uuid:notification_id>/read", NotificationMarkReadView.as_view(), name="notification-read"),
    path("assistant/chat", AssistantChatView.as_view(), name="assistant-chat"),
]
