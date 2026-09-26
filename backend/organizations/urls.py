from django.urls import path

from organizations import views

urlpatterns = [
    path("admin/organizations", views.AdminOrganizationListView.as_view()),
    path("admin/organizations/<uuid:org_id>", views.AdminOrganizationDetailView.as_view()),
    path("admin/organizations/<uuid:org_id>/members", views.AdminOrganizationMembersView.as_view()),
    path("admin/organizations/<uuid:org_id>/members/<uuid:member_id>", views.AdminOrganizationMemberDetailView.as_view()),
    path("admin/invoices", views.AdminInvoiceListView.as_view()),
    path("vouchers/redeem", views.VoucherRedeemView.as_view()),
    path("admin/organizations/<uuid:org_id>/vouchers", views.AdminVoucherView.as_view()),
    path("admin/vouchers/<uuid:voucher_id>/void", views.AdminVoucherVoidView.as_view()),
    path("admin/organizations/<uuid:org_id>/top-up", views.AdminTopUpView.as_view()),
    path("admin/invoices/<uuid:invoice_id>/status", views.AdminInvoiceStatusView.as_view()),
]
