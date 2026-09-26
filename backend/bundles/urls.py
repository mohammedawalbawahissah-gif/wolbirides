from django.urls import path

from bundles import views

urlpatterns = [
    path("bundles/plans", views.PlanListView.as_view()),
    path("ride-bundles/purchase", views.PurchaseView.as_view()),
    path("bundles/<uuid:bundle_id>/payment-status", views.BundlePaymentStatusView.as_view()),
    path("passengers/me/ride-bundles", views.MyBundlesView.as_view()),
    path("admin/bundles", views.AdminBundleListView.as_view()),
    path("admin/bundles/<uuid:bundle_id>/activate", views.AdminBundleActivateView.as_view()),
]
