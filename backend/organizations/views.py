from core.throttling import ActionRateThrottle
from datetime import date

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from core.permissions import IsAdminRole
from rest_framework.permissions import IsAuthenticated

from organizations.models import BalanceEntry, Invoice, Organization, OrganizationMember, RideVoucher
from organizations.services import (
    OrganizationBillingError, generate_invoice, issue_vouchers, member_allowance, redeem_voucher, top_up,
)


class OrganizationSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = ["id", "name", "billing_contact_name", "billing_email", "billing_phone", "monthly_budget",
                  "prepaid_balance", "active", "member_count", "created_at"]
        read_only_fields = ["id", "member_count", "prepaid_balance", "created_at"]

    def get_member_count(self, org):
        return org.members.filter(active=True).count()


class MemberSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.name", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    remaining_this_month = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationMember
        fields = ["id", "name", "email", "phone", "monthly_limit", "active", "remaining_this_month"]

    def get_remaining_this_month(self, m):
        allowance = member_allowance(m)
        return None if allowance is None else str(max(allowance, 0))


class InvoiceSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = Invoice
        fields = ["id", "organization", "organization_name", "period_start", "period_end", "total",
                  "line_items", "status", "paid_at", "created_at"]


class AdminOrganizationListView(APIView):
    """GET/POST /api/admin/organizations — WR-21."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response(OrganizationSerializer(Organization.objects.order_by("name"), many=True).data)

    def post(self, request):
        s = OrganizationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(OrganizationSerializer(s.save()).data, status=status.HTTP_201_CREATED)


class AdminOrganizationDetailView(APIView):
    """GET/PATCH /api/admin/organizations/<id> — includes members."""

    permission_classes = [IsAdminRole]

    def get(self, request, org_id):
        org = get_object_or_404(Organization, id=org_id)
        data = OrganizationSerializer(org).data
        data["members"] = MemberSerializer(org.members.select_related("user").order_by("-active", "user__name"), many=True).data
        return Response(data)

    def patch(self, request, org_id):
        org = get_object_or_404(Organization, id=org_id)
        s = OrganizationSerializer(org, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        return Response(OrganizationSerializer(s.save()).data)


class AdminOrganizationMembersView(APIView):
    """POST /api/admin/organizations/<id>/members {identifier: email or phone, monthly_limit?}"""

    permission_classes = [IsAdminRole]

    def post(self, request, org_id):
        from accounts.services import normalize_phone

        org = get_object_or_404(Organization, id=org_id)
        identifier = (request.data.get("identifier") or "").strip()
        if not identifier:
            return Response({"detail": "Enter the member's email or phone number."}, status=400)
        phone = normalize_phone(identifier) if "@" not in identifier else None
        user = User.objects.filter(Q(email__iexact=identifier) | Q(phone=phone or identifier)).first()
        if not user:
            return Response({"detail": "No WolbiRides account uses that email or phone. Ask them to sign up first."},
                            status=404)
        member, _ = OrganizationMember.objects.update_or_create(
            organization=org, user=user,
            defaults={"active": True, "monthly_limit": request.data.get("monthly_limit") or None},
        )
        from core.models import notify

        notify(user, f"You can bill rides to {org.name}", "Choose it as the payment option when you book.",
               category="system", link="/")
        return Response(MemberSerializer(member).data, status=status.HTTP_201_CREATED)


class AdminOrganizationMemberDetailView(APIView):
    """PATCH/DELETE /api/admin/organizations/<id>/members/<member_id> — DELETE deactivates."""

    permission_classes = [IsAdminRole]

    def patch(self, request, org_id, member_id):
        m = get_object_or_404(OrganizationMember, id=member_id, organization_id=org_id)
        if "monthly_limit" in request.data:
            m.monthly_limit = request.data["monthly_limit"] or None
        if "active" in request.data:
            m.active = bool(request.data["active"])
        m.save()
        return Response(MemberSerializer(m).data)

    def delete(self, request, org_id, member_id):
        OrganizationMember.objects.filter(id=member_id, organization_id=org_id).update(active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminInvoiceListView(APIView):
    """GET /api/admin/invoices?organization=<id> ; POST /api/admin/invoices {organization, period_start, period_end}"""

    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = Invoice.objects.select_related("organization")
        if request.query_params.get("organization"):
            qs = qs.filter(organization_id=request.query_params["organization"])
        return Response(InvoiceSerializer(qs[:200], many=True).data)

    def post(self, request):
        org = get_object_or_404(Organization, id=request.data.get("organization"))
        try:
            start = date.fromisoformat(request.data["period_start"])
            end = date.fromisoformat(request.data["period_end"])
        except (KeyError, ValueError):
            return Response({"detail": "period_start and period_end must be YYYY-MM-DD."}, status=400)
        return Response(InvoiceSerializer(generate_invoice(org, start, end)).data, status=201)


class AdminInvoiceStatusView(APIView):
    """POST /api/admin/invoices/<id>/status {status: sent|paid}"""

    permission_classes = [IsAdminRole]

    def post(self, request, invoice_id):
        inv = get_object_or_404(Invoice, id=invoice_id)
        new = request.data.get("status")
        if new not in (Invoice.Status.SENT, Invoice.Status.PAID):
            return Response({"detail": "status must be 'sent' or 'paid'."}, status=400)
        inv.status = new
        inv.paid_at = timezone.now() if new == Invoice.Status.PAID else None
        inv.save(update_fields=["status", "paid_at", "updated_at"])
        return Response(InvoiceSerializer(inv).data)


class VoucherSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    redeemed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RideVoucher
        fields = ["id", "organization", "organization_name", "code", "kind", "value", "value_remaining",
                  "ride_count", "rides_remaining", "redeemed_by_name", "redeemed_at", "expires_at", "voided",
                  "created_at"]

    def get_redeemed_by_name(self, v):
        return (v.redeemed_by.name or v.redeemed_by.phone) if v.redeemed_by else None


class VoucherRedeemView(APIView):
    """POST /api/vouchers/redeem {code} — WR-21. The voucher then shows as a way to pay."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ActionRateThrottle]
    throttle_scope = "voucher_redeem"

    def post(self, request):
        try:
            voucher = redeem_voucher(request.user, request.data.get("code"))
        except OrganizationBillingError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(VoucherSerializer(voucher).data)


class AdminVoucherView(APIView):
    """GET /api/admin/organizations/<id>/vouchers ; POST {count, kind, value?, ride_count?, expires_at?}"""

    permission_classes = [IsAdminRole]

    def get(self, request, org_id):
        qs = RideVoucher.objects.filter(organization_id=org_id).select_related("organization", "redeemed_by")
        return Response(VoucherSerializer(qs[:500], many=True).data)

    def post(self, request, org_id):
        from django.utils.dateparse import parse_datetime, parse_date

        org = get_object_or_404(Organization, id=org_id)
        expires = request.data.get("expires_at")
        expires_at = None
        if expires:
            expires_at = parse_datetime(expires)
            if expires_at is None and parse_date(expires):
                expires_at = timezone.make_aware(timezone.datetime.combine(parse_date(expires), timezone.datetime.max.time()))
        try:
            created = issue_vouchers(org, request.data.get("count") or 1, request.data.get("kind"),
                                     value=request.data.get("value") or None,
                                     ride_count=request.data.get("ride_count") or None, expires_at=expires_at)
        except OrganizationBillingError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(VoucherSerializer(created, many=True).data, status=201)


class AdminVoucherVoidView(APIView):
    """POST /api/admin/vouchers/<id>/void"""

    permission_classes = [IsAdminRole]

    def post(self, request, voucher_id):
        RideVoucher.objects.filter(id=voucher_id).update(voided=True)
        return Response(status=204)


class AdminTopUpView(APIView):
    """POST /api/admin/organizations/<id>/top-up {amount, reference} ; GET = balance history"""

    permission_classes = [IsAdminRole]

    def get(self, request, org_id):
        entries = BalanceEntry.objects.filter(organization_id=org_id)[:200]
        return Response([{"amount": str(e.amount), "reason": e.reason, "reference": e.reference,
                          "trip_id": str(e.trip_id) if e.trip_id else None, "created_at": e.created_at}
                         for e in entries])

    def post(self, request, org_id):
        org = get_object_or_404(Organization, id=org_id)
        try:
            org = top_up(org, request.data.get("amount") or 0, request.data.get("reference", ""))
        except (OrganizationBillingError, ArithmeticError, ValueError) as exc:
            return Response({"detail": str(exc) or "Enter a valid amount."}, status=400)
        return Response(OrganizationSerializer(org).data)
