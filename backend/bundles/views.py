from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bundles.models import BundlePlan, PassengerBundle
from bundles.services import BundleError, activate, start_purchase
from core.permissions import IsAdminRole


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = BundlePlan
        fields = ["id", "name", "ride_count", "price", "max_fare_per_ride", "valid_days", "active",
                  "expires_before_term", "per_ride_price"]

    expires_before_term = serializers.SerializerMethodField()
    per_ride_price = serializers.SerializerMethodField()

    def get_expires_before_term(self, plan):
        from bundles.services import expires_before_term

        return expires_before_term(plan)

    def get_per_ride_price(self, plan):
        return str((plan.price / plan.ride_count).quantize(__import__("decimal").Decimal("0.01")))


class BundleSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True)
    owner = serializers.SerializerMethodField()

    class Meta:
        model = PassengerBundle
        fields = ["id", "plan", "plan_name", "rides_total", "rides_remaining", "price_paid", "max_fare_per_ride",
                  "status", "payment_method", "payment_reference", "activated_at", "expires_at", "created_at", "owner"]

    def get_owner(self, b):
        return {"name": b.user.name, "phone": b.user.phone, "email": b.user.email}


class PlanListView(APIView):
    """GET /api/bundles/plans — WR-22."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(PlanSerializer(BundlePlan.objects.filter(active=True).order_by("price"), many=True).data)


class PurchaseView(APIView):
    """
    POST /api/bundles/purchase {plan_id, payment_method: "momo"|"office"}
    Creates the bundle awaiting payment. MoMo collection plugs in here once a
    licensed provider is live; until then ops confirms payment in the admin
    dashboard (founder-run ops, WR-06.1).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        plan = get_object_or_404(BundlePlan, id=request.data.get("plan_id"), active=True)
        method = request.data.get("payment_method") or "office"
        if method not in ("momo", "office"):
            return Response({"detail": "payment_method must be 'momo' or 'office'."}, status=400)
        try:
            bundle = start_purchase(request.user, plan, payment_method=method,
                                    acknowledged_short_expiry=bool(request.data.get("acknowledge_expiry")))
        except BundleError as exc:
            return Response({"detail": str(exc), "requires_expiry_acknowledgement": True}, status=400)
        if method == "momo":
            from payments.momo import MoMoError
            from payments.services import start_bundle_momo_payment

            phone = request.data.get("phone") or request.user.phone
            try:
                bundle = start_bundle_momo_payment(bundle, phone)
            except MoMoError:
                return Response({"detail": "MoMo couldn't start the payment. Check the number and try again.",
                                 "bundle": BundleSerializer(bundle).data}, status=502)
        return Response(BundleSerializer(bundle).data, status=status.HTTP_201_CREATED)


class BundlePaymentStatusView(APIView):
    """GET /api/bundles/<id>/payment-status — polls MoMo; the bundle switches on when the payment lands."""

    permission_classes = [IsAuthenticated]

    def get(self, request, bundle_id):
        from payments.services import refresh_bundle_payment

        bundle = get_object_or_404(PassengerBundle, id=bundle_id, user=request.user)
        return Response(BundleSerializer(refresh_bundle_payment(bundle)).data)


class MyBundlesView(APIView):
    """GET /api/passengers/me/bundles"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(BundleSerializer(PassengerBundle.objects.filter(user=request.user).select_related("plan", "user")[:50], many=True).data)


class AdminBundleListView(APIView):
    """GET /api/admin/bundles?status=pending_payment"""

    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = PassengerBundle.objects.select_related("plan", "user")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return Response(BundleSerializer(qs[:200], many=True).data)


class AdminBundleActivateView(APIView):
    """POST /api/admin/bundles/<id>/activate {reference} — ops confirms the money arrived."""

    permission_classes = [IsAdminRole]

    def post(self, request, bundle_id):
        bundle = get_object_or_404(PassengerBundle, id=bundle_id)
        try:
            bundle = activate(bundle, payment_reference=(request.data.get("reference") or "").strip())
        except BundleError as exc:
            return Response({"detail": str(exc)}, status=409)
        return Response(BundleSerializer(bundle).data)
