from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from rest_framework import serializers

from trips.matching import get_driver_location_sync
from trips.models import FareQuote, Rating, Trip


class CoordinateField(serializers.DecimalField):
    """
    A raw browser geolocation/map-click reading carries full double-precision
    noise (15+ significant digits) — enough to blow past max_digits before
    DRF's own decimal-places rounding ever kicks in, since DRF's max_digits
    check runs on the un-rounded value. Rounding to 6 decimal places first
    (~11cm of precision, plenty for ride-hailing) is a safety net here so
    this can't 400 regardless of which client sends the request.
    """

    def to_internal_value(self, data):
        return super().to_internal_value(self._rounded(data))

    @staticmethod
    def _rounded(data):
        try:
            return Decimal(str(data)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        except (InvalidOperation, TypeError, ValueError):
            return data  # not a number: the field's own validation reports it properly


class FareQuoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = FareQuote
        fields = ["distance_km", "base_fare", "per_km_charge", "surcharge", "discount", "discount_reason", "total", "expires_at"]


class TripVehicleBriefSerializer(serializers.Serializer):
    """Minimal vehicle info for display on the passenger's trip screen."""

    plate_number = serializers.CharField()
    vehicle_type = serializers.CharField()
    photo = serializers.CharField(allow_blank=True)


class TripDriverBriefSerializer(serializers.Serializer):
    """
    Read-only, passenger-facing snapshot of the matched driver — deliberately
    thin (name, rating, active vehicle) rather than exposing the full Driver
    record, since this rides alongside the Trip payload on every poll/socket
    update.
    """

    id = serializers.UUIDField()
    name = serializers.CharField(source="user.name")
    phone = serializers.CharField(source="user.phone")
    profile_photo = serializers.CharField(source="user.profile_photo", allow_blank=True)
    rating = serializers.DecimalField(max_digits=4, decimal_places=2, source="quality_score")
    verification_status = serializers.CharField()
    vehicle = serializers.SerializerMethodField()
    current_lat = serializers.SerializerMethodField()
    current_lng = serializers.SerializerMethodField()

    def get_vehicle(self, driver):
        # Lists pre-fetch active vehicles (trips.services.trip_list_queryset); single trips fall back to a query.
        prefetched = getattr(driver, "active_vehicles", None)
        vehicle = prefetched[0] if prefetched else (None if prefetched is not None else driver.vehicles.filter(active=True).first())
        if not vehicle:
            return None
        return TripVehicleBriefSerializer(vehicle).data

    def _live_location(self, driver):
        if not self.context.get("include_live_location", True):
            return None  # finished trips: no Redis lookup for a position nobody will see
        # Cache the Redis lookup on the instance for the duration of this
        # serialization pass so get_current_lat/get_current_lng (both
        # called for every driver on every request) don't double the
        # Redis round-trips. Driver location was previously read from
        # driver.current_lat/current_lng on the model — those fields are
        # never written anywhere (location only ever lands in Redis, per
        # PRD Section 8), so this always serialized as null. Fixed by
        # reading the same Redis key the websocket hot path writes to,
        # keyed by the driver's *user* id (see matching.py's docstring on
        # get_driver_location_sync for why that distinction matters).
        cache_attr = "_wolbirides_live_location_cache"
        cached = getattr(driver, cache_attr, "unset")
        if cached == "unset":
            try:
                cached = get_driver_location_sync(str(driver.user_id))
            except Exception:
                # A Redis blip should hide the live dot, not break the trip screen.
                cached = None
            setattr(driver, cache_attr, cached)
        return cached

    def get_current_lat(self, driver):
        location = self._live_location(driver)
        return location["lat"] if location else None

    def get_current_lng(self, driver):
        location = self._live_location(driver)
        return location["lng"] if location else None


class TripRequestSerializer(serializers.Serializer):
    """Input for POST /api/trips — PRD Section 7."""

    zone_id = serializers.UUIDField()
    pickup_lat = CoordinateField(max_digits=9, decimal_places=6)
    pickup_lng = CoordinateField(max_digits=9, decimal_places=6)
    pickup_label = serializers.CharField(required=False, allow_blank=True)
    destination_lat = CoordinateField(max_digits=9, decimal_places=6)
    destination_lng = CoordinateField(max_digits=9, decimal_places=6)
    destination_label = serializers.CharField(required=False, allow_blank=True)
    # Kept for backward compatibility with existing clients that still send
    # it, and for anti-fraud comparison logging — but the server always
    # computes the authoritative billed distance itself from the
    # pickup/destination coordinates (see services.request_trip). This is
    # deliberately optional now: a client that stops sending it entirely
    # loses nothing.
    distance_km = serializers.DecimalField(max_digits=6, decimal_places=2, required=False)
    # WR-13: optional — if the passenger picked a saved place from their
    # list rather than dropping a fresh pin, passing its id lets the
    # backend track real usage (SavedAddress.usage_count/last_used_at)
    # without guessing from raw coordinates.
    pickup_saved_address_id = serializers.UUIDField(required=False, allow_null=True)
    destination_saved_address_id = serializers.UUIDField(required=False, allow_null=True)

    # Growth PRD options (all optional; see services.request_trip)
    trip_type = serializers.ChoiceField(choices=["ride", "delivery"], required=False)
    kind = serializers.ChoiceField(choices=["ride", "delivery"], required=False)  # legacy alias
    recipient_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    recipient_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    package_description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    package_size = serializers.ChoiceField(choices=["small", "medium", "large"], required=False)
    no_prohibited_items = serializers.BooleanField(required=False, default=False)
    preferences = serializers.DictField(required=False, allow_null=True)
    shareable = serializers.BooleanField(required=False)
    is_pool = serializers.BooleanField(required=False)  # legacy alias
    seats = serializers.IntegerField(required=False)  # ignored: PRD pools are 1 seat per rider
    payment_method = serializers.ChoiceField(
        choices=["cash", "momo", "organization", "voucher", "bundle"], required=False, allow_null=True
    )
    organization_id = serializers.UUIDField(required=False, allow_null=True)
    voucher_id = serializers.UUIDField(required=False, allow_null=True)
    bundle_id = serializers.UUIDField(required=False, allow_null=True)
    promo_code = serializers.CharField(max_length=30, required=False, allow_blank=True)

    def validate(self, attrs):
        if (attrs.get("trip_type") or attrs.get("kind")) == "delivery" and not attrs.get("no_prohibited_items"):
            raise serializers.ValidationError(
                {"no_prohibited_items": "Confirm the package has no prohibited items (cash, weapons, drugs, animals)."}
            )
        return attrs


class TripSerializer(serializers.ModelSerializer):
    fare_quote = FareQuoteSerializer(read_only=True)
    driver_detail = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source="organization.name", read_only=True, default=None)
    pool_info = serializers.SerializerMethodField()
    rated_by_me = serializers.SerializerMethodField()

    def get_rated_by_me(self, trip):
        if hasattr(trip, "rated_by_me_annotated"):
            return trip.rated_by_me_annotated  # lists annotate this in the same query
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return trip.ratings.filter(rater=request.user).exists()

    class Meta:
        model = Trip
        fields = [
            "id", "passenger", "driver", "driver_detail", "zone", "status",
            "pickup_lat", "pickup_lng", "pickup_label",
            "destination_lat", "destination_lng", "destination_label",
            "fare_quote", "fare_final", "cancel_reason", "cancelled_by",
            "requested_at", "matched_at", "started_at", "completed_at",
            "trip_type", "payment_method", "organization_name", "preferences", "preference_status",
            "shareable", "pool_seat_fare", "pool_info", "shared_with_contact", "rated_by_me",
        ]
        read_only_fields = fields

    def _viewer(self, trip):
        request = self.context.get("request")
        user = request.user if request else None
        if not user:
            return "anonymous"
        if user.id == trip.passenger_id:
            return "passenger"
        if trip.driver and trip.driver.user_id == user.id:
            return "driver"
        return "admin" if getattr(user, "role", "") in ("admin", "support") else "other"

    def get_pool_info(self, trip):
        from trips.pooling import pool_summary

        # Riders only learn that the ride is shared; the stop sequence is for the driver.
        return pool_summary(trip, for_driver=self._viewer(trip) in ("driver", "admin"))

    def to_representation(self, trip):
        data = super().to_representation(trip)
        viewer = self._viewer(trip)
        # WR-19 guardrail: preferences go to the matching engine only. Drivers never see them.
        if viewer not in ("passenger", "admin"):
            data["preferences"] = None
            data["preference_status"] = ""
        data["kind"] = data["trip_type"]  # legacy alias for older app builds
        data["is_pool"] = data["shareable"]  # legacy alias

        delivery = getattr(trip, "delivery", None) if trip.trip_type == Trip.Kind.DELIVERY else None
        data["delivery"] = None
        for legacy in ("recipient_name", "recipient_phone", "package_description", "delivery_code"):
            data[legacy] = None
        if delivery:
            is_sender = viewer == "passenger"
            data["delivery"] = {
                "recipient_name": delivery.recipient_name,
                "recipient_phone": delivery.recipient_phone,
                "package_description": delivery.package_description,
                "package_size": delivery.package_size,
                "picked_up_at": delivery.picked_up_at,
                # Codes belong to the sender (pickup) and recipient (drop-off). The driver
                # must be *given* each one in person, so their API never returns them.
                "pickup_code": delivery.pickup_code if is_sender else None,
                "dropoff_code": delivery.dropoff_code if is_sender else None,
            }
            data.update({
                "recipient_name": delivery.recipient_name,
                "recipient_phone": delivery.recipient_phone,
                "package_description": delivery.package_description,
                "delivery_code": delivery.dropoff_code if is_sender else None,
            })
        return data

    def get_driver_detail(self, trip):
        """Nested driver+vehicle snapshot for trust signals on the trip screen — None until matched."""
        if not trip.driver_id:
            return None
        live = trip.status in ("matched", "driver_arriving", "in_progress")
        return TripDriverBriefSerializer(trip.driver, context={"include_live_location": live}).data


class TripCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class RatingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rating
        fields = ["id", "trip", "rater", "rated", "score", "issue_tags", "comment", "created_at"]
        read_only_fields = ["id", "rater", "created_at"]
