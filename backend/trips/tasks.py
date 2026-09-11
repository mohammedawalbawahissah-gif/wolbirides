from celery import shared_task


@shared_task
def check_dispatch_offer_timeout(trip_id, offered_driver_id):
    """
    Scheduled with a countdown of DISPATCH_OFFER_TIMEOUT_SECONDS when an
    offer goes out (trips/services.py::_offer_to_driver). If the trip is
    still MATCHING and no driver has accepted by the time this fires, cascade
    to the next candidate. If the driver already accepted or the trip was
    cancelled in the meantime, this is a no-op.
    """
    from trips.models import Trip
    from trips.services import decline_or_timeout

    try:
        trip = Trip.objects.get(id=trip_id)
    except Trip.DoesNotExist:
        return
    if trip.status == Trip.Status.MATCHING:
        decline_or_timeout(trip, offered_driver_id)
