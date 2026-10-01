"""
WR-26: the ops delivery desk. Errands and vendor orders (and any parcel no driver took) wait here as
"awaiting_assignment"; staff hand each to an online driver or to an external courier, then, for an
external courier who has no app, record pickup and drop-off on their behalf.
"""
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.services import normalize_phone
from core.permissions import IsStaffRole
from drivers.models import Driver
from trips import services
from trips.models import ExternalCourier, Trip
from trips.serializers import TripSerializer

ACTIVE = ("matched", "driver_arriving", "in_progress")


def _delivery(trip_id):
    return get_object_or_404(Trip.objects.filter(trip_type=Trip.Kind.DELIVERY), id=trip_id)


def _out(trip, request):
    trip = services.trip_list_queryset().get(id=trip.id)
    return Response(TripSerializer(trip, context={"request": request}).data)


def _guard(fn):
    """Turns the service errors into the plain-text responses the desk shows."""
    try:
        return fn(), None
    except services.AssignmentError as exc:
        return None, Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    except services.TripFlowError as exc:
        return None, Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    except services.DeliveryCodeError as exc:
        return None, Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class AdminDeliveryListView(APIView):
    """GET /api/admin/deliveries?view=queue|active|recent"""

    permission_classes = [IsStaffRole]

    def get(self, request):
        view = request.query_params.get("view", "queue")
        qs = services.trip_list_queryset().filter(trip_type=Trip.Kind.DELIVERY)
        if view == "active":
            qs = qs.filter(status__in=ACTIVE).order_by("requested_at")
        elif view == "recent":
            qs = qs.filter(status__in=("completed", "cancelled"),
                           requested_at__gte=timezone.now() - timedelta(days=7)).order_by("-requested_at")
        else:
            # A delivery ops offered to a driver stays visible here — "matching" status, not gone
            # from the queue — until it's accepted (moves to "active"), declined, or times out
            # (both return it here as "awaiting_assignment"). Excludes a parcel's own brief organic
            # dispatch window, which is also "matching" but was never an admin offer.
            from django.db.models import Q

            qs = qs.filter(
                Q(status=Trip.Status.AWAITING_ASSIGNMENT)
                | Q(status=Trip.Status.MATCHING, events__event_type="offered_to_driver", events__payload__admin_offer=True)
            ).distinct().order_by("requested_at")
        return Response(TripSerializer(qs[:100], many=True, context={"request": request}).data)


class AdminDeliveryCouriersView(APIView):
    """GET /api/admin/deliveries/:id/couriers — who this delivery can be handed to right now."""

    permission_classes = [IsStaffRole]

    def get(self, request, trip_id):
        trip = _delivery(trip_id)
        return Response({
            "drivers": services.delivery_couriers_for(trip),
            "external": list(ExternalCourier.objects.filter(active=True).values("id", "name", "phone", "notes")),
        })


class AdminDeliveryAssignView(APIView):
    """POST /api/admin/deliveries/:id/assign {driver_id} — offers it to that driver (they still have
    to accept; see admin_offer_to_driver), not an instant match."""

    permission_classes = [IsStaffRole]

    def post(self, request, trip_id):
        trip = _delivery(trip_id)
        driver = get_object_or_404(Driver.objects.select_related("user"), id=request.data.get("driver_id"))
        _, err = _guard(lambda: services.admin_offer_to_driver(trip, driver, request.user))
        return err or _out(trip, request)


class AdminDeliveryAssignExternalView(APIView):
    """POST /api/admin/deliveries/:id/assign-external {courier_id} or {name, phone, notes?} for a new courier."""

    permission_classes = [IsStaffRole]

    def post(self, request, trip_id):
        trip = _delivery(trip_id)
        courier_id = request.data.get("courier_id")
        if courier_id:
            courier = get_object_or_404(ExternalCourier, id=courier_id)
        else:
            name = (request.data.get("name") or "").strip()
            phone = normalize_phone(request.data.get("phone") or "")
            if not name or not phone:
                return Response({"detail": "Give the courier's name and phone number."}, status=status.HTTP_400_BAD_REQUEST)
            courier, _ = ExternalCourier.objects.get_or_create(
                phone=phone, defaults={"name": name, "notes": (request.data.get("notes") or "").strip()})
        _, err = _guard(lambda: services.assign_delivery_to_external(trip, courier, request.user))
        return err or _out(trip, request)


class AdminDeliveryUnassignView(APIView):
    """POST /api/admin/deliveries/:id/unassign — take it off its courier and back into the queue."""

    permission_classes = [IsStaffRole]

    def post(self, request, trip_id):
        trip = _delivery(trip_id)
        _, err = _guard(lambda: services.unassign_delivery(trip, request.user))
        return err or _out(trip, request)


class _AdminConfirmView(APIView):
    permission_classes = [IsStaffRole]
    action = None

    def post(self, request, trip_id):
        trip = _delivery(trip_id)
        _, err = _guard(lambda: self.action(trip, request.user, code=request.data.get("code", ""),
                                            by_phone=bool(request.data.get("by_phone"))))
        return err or _out(trip, request)


class AdminDeliveryConfirmPickupView(_AdminConfirmView):
    """POST /api/admin/deliveries/:id/confirm-pickup {code?, by_phone?}"""

    action = staticmethod(services.admin_confirm_pickup)


class AdminDeliveryConfirmDropoffView(_AdminConfirmView):
    """POST /api/admin/deliveries/:id/confirm-dropoff {code?, by_phone?}"""

    action = staticmethod(services.admin_confirm_dropoff)


class AdminDeliveryCashView(APIView):
    """POST /api/admin/deliveries/:id/cash-received — an external courier handed over the cash the passenger paid."""

    permission_classes = [IsStaffRole]

    def post(self, request, trip_id):
        from payments.services import PaymentError, record_cash_payment

        trip = _delivery(trip_id)
        if not trip.delivery.external_courier_id:
            return Response({"detail": "Riders confirm their own cash in the app."}, status=status.HTTP_409_CONFLICT)
        try:
            record_cash_payment(trip, confirmed_by="admin")
        except PaymentError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return _out(trip, request)


class AdminDeliveryCancelView(APIView):
    """POST /api/admin/deliveries/:id/cancel {reason}"""

    permission_classes = [IsStaffRole]

    def post(self, request, trip_id):
        trip = _delivery(trip_id)
        if trip.status in (Trip.Status.COMPLETED, Trip.Status.CANCELLED):
            return Response({"detail": "This delivery is already finished."}, status=status.HTTP_409_CONFLICT)
        services.cancel_trip(trip, "admin", (request.data.get("reason") or "Cancelled by our team.").strip())
        return _out(trip, request)
