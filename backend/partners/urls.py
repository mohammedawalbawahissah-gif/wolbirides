from django.urls import path

from partners import views

urlpatterns = [
    path("partners", views.PartnerListView.as_view()),
    path("promos/check", views.PromoCheckView.as_view()),
    path("admin/partners/report", views.AdminPartnerReportView.as_view()),
    path("placements/active", views.ActivePlacementsView.as_view()),
    path("admin/placements", views.AdminPlacementListView.as_view()),
    path("admin/placements/<uuid:placement_id>", views.AdminPlacementDetailView.as_view()),
]
