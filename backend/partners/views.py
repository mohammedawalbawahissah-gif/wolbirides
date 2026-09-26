from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from partners.models import Partner
from partners.services import PromoError, compute_discount, find_promo, partner_report


class PartnerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Partner
        fields = ["id", "name", "category", "zone", "lat", "lng", "address", "offer_text"]


class PartnerListView(APIView):
    """GET /api/partners?zone_id= — WR-24 partner venues riders can pick as destinations."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Partner.objects.filter(active=True).order_by("name")
        if request.query_params.get("zone_id"):
            qs = qs.filter(zone_id=request.query_params["zone_id"])
        return Response(PartnerSerializer(qs, many=True).data)


class PromoCheckView(APIView):
    """POST /api/promos/check {code, fare, destination_lat?, destination_lng?} — preview only, nothing is reserved."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            fare = Decimal(str(request.data.get("fare")))
        except (InvalidOperation, TypeError):
            return Response({"detail": "fare is required."}, status=400)
        dest = None
        if request.data.get("destination_lat") is not None and request.data.get("destination_lng") is not None:
            dest = (request.data["destination_lat"], request.data["destination_lng"])
        try:
            promo = find_promo(request.data.get("code"))
            discount = compute_discount(promo, request.user, fare, destination=dest)
        except PromoError as exc:
            return Response({"valid": False, "detail": str(exc)})
        return Response({"valid": True, "code": promo.code, "discount": str(discount),
                         "description": promo.description, "partner": promo.partner.name if promo.partner else None})


class AdminPartnerReportView(APIView):
    """GET /api/admin/partners/report?days=30"""

    permission_classes = [IsAdminRole]

    def get(self, request):
        days = min(int(request.query_params.get("days", 30)), 365)
        return Response({"days": days, "partners": partner_report(timezone.now() - timezone.timedelta(days=days))})


class PlacementSerializer(serializers.ModelSerializer):
    sponsored = serializers.SerializerMethodField()

    class Meta:
        from partners.models import SponsoredPlacement

        model = SponsoredPlacement
        fields = ["id", "zone", "partner", "title", "description", "image_url", "link_url", "sponsor_name",
                  "active_from", "active_to", "price_paid", "sponsored"]

    def get_sponsored(self, _):
        return True  # every placement is labelled "Sponsored", no exceptions (WR-24)


class ActivePlacementsView(APIView):
    """
    GET /api/placements/active?zone_id= — WR-24.

    Same answer for every rider in a zone: no per-user targeting, and nothing
    about the requesting user is read to choose what's shown.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.db.models import Q
        from partners.models import SponsoredPlacement

        now = timezone.now()
        qs = SponsoredPlacement.objects.filter(active_from__lte=now, active_to__gte=now)
        zone_id = request.query_params.get("zone_id")
        qs = qs.filter(Q(zone__isnull=True) | Q(zone_id=zone_id)) if zone_id else qs.filter(zone__isnull=True)
        data = PlacementSerializer(qs.order_by("active_from")[:3], many=True).data
        for d in data:
            d.pop("price_paid", None)  # commercial terms aren't riders' business
        return Response(data)


class AdminPlacementListView(APIView):
    """GET/POST /api/admin/placements — sold and set up manually by ops during the pilot."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        from partners.models import SponsoredPlacement

        return Response(PlacementSerializer(SponsoredPlacement.objects.all()[:200], many=True).data)

    def post(self, request):
        s = PlacementSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(PlacementSerializer(s.save()).data, status=201)


class AdminPlacementDetailView(APIView):
    """PATCH/DELETE /api/admin/placements/<id>"""

    permission_classes = [IsAdminRole]

    def patch(self, request, placement_id):
        from partners.models import SponsoredPlacement
        from rest_framework.generics import get_object_or_404

        p = get_object_or_404(SponsoredPlacement, id=placement_id)
        s = PlacementSerializer(p, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        return Response(PlacementSerializer(s.save()).data)

    def delete(self, request, placement_id):
        from partners.models import SponsoredPlacement

        SponsoredPlacement.objects.filter(id=placement_id).delete()
        return Response(status=204)
