from django.urls import path

from adminapi.delivery_views import (
    AdminDeliveryAssignExternalView,
    AdminDeliveryAssignView,
    AdminDeliveryCancelView,
    AdminDeliveryCashView,
    AdminDeliveryConfirmDropoffView,
    AdminDeliveryConfirmPickupView,
    AdminDeliveryCouriersView,
    AdminDeliveryListView,
    AdminDeliveryUnassignView,
)
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
    AdminSupportTicketUpdateView,
)

urlpatterns = [
    path("admin/zones", AdminZoneListView.as_view(), name="admin-zones"),
    path("admin/zones/<uuid:zone_id>", AdminZoneDetailView.as_view(), name="admin-zone-detail"),
    path("admin/drivers", AdminDriverListView.as_view(), name="admin-drivers"),
    path("admin/drivers/pending", AdminPendingDriversView.as_view(), name="admin-drivers-pending"),
    path("admin/drivers/<uuid:driver_id>/verify", AdminDriverVerifyView.as_view(), name="admin-driver-verify"),
    path("admin/trips", AdminTripSearchView.as_view(), name="admin-trips"),
    path("admin/deliveries", AdminDeliveryListView.as_view(), name="admin-deliveries"),
    path("admin/deliveries/<uuid:trip_id>/couriers", AdminDeliveryCouriersView.as_view(), name="admin-delivery-couriers"),
    path("admin/deliveries/<uuid:trip_id>/assign", AdminDeliveryAssignView.as_view(), name="admin-delivery-assign"),
    path("admin/deliveries/<uuid:trip_id>/assign-external", AdminDeliveryAssignExternalView.as_view(), name="admin-delivery-assign-external"),
    path("admin/deliveries/<uuid:trip_id>/unassign", AdminDeliveryUnassignView.as_view(), name="admin-delivery-unassign"),
    path("admin/deliveries/<uuid:trip_id>/confirm-pickup", AdminDeliveryConfirmPickupView.as_view(), name="admin-delivery-pickup"),
    path("admin/deliveries/<uuid:trip_id>/confirm-dropoff", AdminDeliveryConfirmDropoffView.as_view(), name="admin-delivery-dropoff"),
    path("admin/deliveries/<uuid:trip_id>/cash-received", AdminDeliveryCashView.as_view(), name="admin-delivery-cash"),
    path("admin/deliveries/<uuid:trip_id>/cancel", AdminDeliveryCancelView.as_view(), name="admin-delivery-cancel"),
    path("admin/incidents", AdminIncidentListView.as_view(), name="admin-incidents"),
    path("admin/support/tickets", AdminSupportTicketListView.as_view(), name="admin-support-tickets"),
    path("admin/support/tickets/<uuid:ticket_id>", AdminSupportTicketUpdateView.as_view(), name="admin-support-ticket-update"),
    path("admin/dashboard/summary", AdminDashboardSummaryView.as_view(), name="admin-dashboard-summary"),
    path("admin/dashboard/trends", AdminDashboardTrendsView.as_view(), name="admin-dashboard-trends"),
]
