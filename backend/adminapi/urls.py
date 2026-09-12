from django.urls import path

from adminapi.views import (
    AdminDashboardSummaryView,
    AdminDashboardTrendsView,
    AdminDriverListView,
    AdminDriverVerifyView,
    AdminIncidentListView,
    AdminPendingDriversView,
    AdminSupportTicketListView,
    AdminTripSearchView,
    AdminZoneDetailView,
    AdminZoneListView,
)

urlpatterns = [
    path("admin/zones", AdminZoneListView.as_view(), name="admin-zones"),
    path("admin/zones/<uuid:zone_id>", AdminZoneDetailView.as_view(), name="admin-zone-detail"),
    path("admin/drivers", AdminDriverListView.as_view(), name="admin-drivers"),
    path("admin/drivers/pending", AdminPendingDriversView.as_view(), name="admin-drivers-pending"),
    path("admin/drivers/<uuid:driver_id>/verify", AdminDriverVerifyView.as_view(), name="admin-driver-verify"),
    path("admin/trips", AdminTripSearchView.as_view(), name="admin-trips"),
    path("admin/incidents", AdminIncidentListView.as_view(), name="admin-incidents"),
    path("admin/support/tickets", AdminSupportTicketListView.as_view(), name="admin-support-tickets"),
    path("admin/dashboard/summary", AdminDashboardSummaryView.as_view(), name="admin-dashboard-summary"),
    path("admin/dashboard/trends", AdminDashboardTrendsView.as_view(), name="admin-dashboard-trends"),
]
