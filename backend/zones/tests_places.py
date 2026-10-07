import os
import tempfile
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from zones import places
from zones.models import PickupPoint, Place, ServiceZone

BOX = {"min_lat": 9.30, "max_lat": 9.50, "min_lng": -1.00, "max_lng": -0.70}


def fake_response(payload, status=200):
    r = mock.Mock()
    r.status_code = status
    r.json.return_value = payload
    r.raise_for_status.side_effect = None if status < 400 else RuntimeError(f"HTTP {status}")
    return r


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.zone = ServiceZone.objects.create(name="UDS", boundary=BOX, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        self.other = ServiceZone.objects.create(name="Elsewhere", boundary=BOX, base_fare=Decimal("5"), per_km_rate=Decimal("2"))

    def place(self, name, lat=9.40, lng=-0.85, **kw):
        return Place.objects.create(name=name, latitude=lat, longitude=lng, **kw)


class LocalSearchTests(Base):
    def test_finds_by_name_alias_and_area_any_case_any_order(self):
        self.place("Citadel Hostel", zone=self.zone, aliases="Citadel, the Cit", area="Nyankpala campus")
        for q in ("citadel", "CITADEL HOS", "the cit", "hostel citadel", "nyankpala"):
            self.assertEqual([r["name"] for r in places.search_local(q, self.zone)], ["Citadel Hostel"], q)
        self.assertEqual(places.search_local("zzz", self.zone), [])

    def test_best_match_first_then_popular_ones(self):
        self.place("Old Citadel Annex", zone=self.zone, popularity=50)
        self.place("Citadel Hostel", zone=self.zone, popularity=1)
        self.place("Citadel", zone=self.zone, popularity=0)
        names = [r["name"] for r in places.search_local("citadel", self.zone)]
        self.assertEqual(names, ["Citadel", "Citadel Hostel", "Old Citadel Annex"])

    def test_inactive_and_other_zone_places_are_hidden_but_everywhere_places_show(self):
        self.place("Closed Shop", zone=self.zone, is_active=False)
        self.place("Elsewhere Mall", zone=self.other)
        self.place("Tamale Teaching Hospital")  # no zone: every zone
        self.assertEqual(places.search_local("closed", self.zone), [])
        self.assertEqual(places.search_local("mall", self.zone), [])
        self.assertEqual([r["name"] for r in places.search_local("hospital", self.zone)], ["Tamale Teaching Hospital"])
        self.assertEqual([r["name"] for r in places.search_local("mall")], ["Elsewhere Mall"])  # no zone given: anywhere

    def test_pickup_points_are_searched_too(self):
        PickupPoint.objects.create(zone=self.zone, name="Main Gate", latitude=9.41, longitude=-0.84)
        r = places.search_local("gate", self.zone)
        self.assertEqual((r[0]["name"], r[0]["source"], r[0]["lat"]), ("Main Gate", "pickup", 9.41))


@override_settings(GEOCODER_PROVIDER="nominatim")
class OutsideSearchTests(Base):
    NOMINATIM = [{"name": "Kamina Barracks", "display_name": "Kamina Barracks, Tamale, Ghana", "lat": "9.4200", "lon": "-0.8300"}]

    def test_not_called_when_local_places_already_fill_the_list(self):
        for i in range(5):
            self.place(f"Hostel {i}", zone=self.zone)
        with mock.patch("zones.places.requests.get") as get:
            self.assertEqual(len(places.search("hostel", self.zone)), 5)
        get.assert_not_called()

    def test_fills_the_gaps_labels_them_as_map_results_and_sends_a_user_agent(self):
        self.place("Kamina Gate", zone=self.zone, lat=9.4210, lng=-0.8300)
        with mock.patch("zones.places.requests.get", return_value=fake_response(self.NOMINATIM)) as get:
            results = places.search("kamina", self.zone)
        self.assertEqual([(r["name"], r["source"]) for r in results], [("Kamina Gate", "place"), ("Kamina Barracks", "map")])
        args, kwargs = get.call_args
        self.assertIn("WolbiRides", kwargs["headers"]["User-Agent"])
        self.assertEqual(kwargs["params"]["countrycodes"], "gh")
        self.assertEqual(kwargs["params"]["bounded"], 1)
        self.assertEqual(kwargs["params"]["viewbox"], "-1.0,9.5,-0.7,9.3")  # left,top,right,bottom of the zone

    def test_an_outside_result_on_top_of_a_curated_place_is_dropped(self):
        self.place("Kamina Barracks", zone=self.zone, lat=9.4201, lng=-0.8301)
        with mock.patch("zones.places.requests.get", return_value=fake_response(self.NOMINATIM)):
            self.assertEqual([r["source"] for r in places.search("kamina", self.zone)], ["place"])

    def test_same_search_is_remembered_so_the_provider_is_not_asked_twice(self):
        with mock.patch("zones.places.requests.get", return_value=fake_response(self.NOMINATIM)) as get:
            places.search("kamina", self.zone)
            cache.delete("geocode:nominatim:slot")
            again = places.search("KAMINA", self.zone)
        self.assertEqual(get.call_count, 1)
        self.assertEqual(again[0]["name"], "Kamina Barracks")

    def test_openstreetmap_is_never_asked_twice_in_the_same_second(self):
        with mock.patch("zones.places.requests.get", return_value=fake_response(self.NOMINATIM)) as get:
            places.search("kamina", self.zone)
            self.assertEqual(places.search("kaminb", self.zone), [])  # slot taken: skipped, not an error
        self.assertEqual(get.call_count, 1)

    def test_provider_failure_returns_local_results_instead_of_an_error(self):
        self.place("Kamina Gate", zone=self.zone)
        with mock.patch("zones.places.requests.get", side_effect=TimeoutError("slow")):
            self.assertEqual([r["name"] for r in places.search("kamina", self.zone)], ["Kamina Gate"])
        with mock.patch("zones.places.requests.get", return_value=fake_response([], status=503)):
            cache.clear()
            self.assertEqual([r["name"] for r in places.search("kamina", self.zone)], ["Kamina Gate"])

    @override_settings(GEOCODER_PROVIDER="")
    def test_provider_can_be_switched_off(self):
        with mock.patch("zones.places.requests.get") as get:
            self.assertEqual(places.search("kamina", self.zone), [])
        get.assert_not_called()

    @override_settings(GEOCODER_PROVIDER="locationiq", GEOCODER_API_KEY="")
    def test_keyed_providers_without_a_key_do_nothing(self):
        with mock.patch("zones.places.requests.get") as get:
            self.assertEqual(places.search("kamina", self.zone), [])
        get.assert_not_called()

    @override_settings(GEOCODER_PROVIDER="locationiq", GEOCODER_API_KEY="k")
    def test_locationiq_shape(self):
        payload = [{"display_place": "Kamina Barracks", "display_name": "Kamina Barracks, Tamale", "lat": "9.42", "lon": "-0.83"}]
        with mock.patch("zones.places.requests.get", return_value=fake_response(payload)) as get:
            r = places.search("kamina", self.zone)
        self.assertEqual((r[0]["name"], r[0]["lat"], r[0]["lng"]), ("Kamina Barracks", 9.42, -0.83))
        self.assertEqual(get.call_args.kwargs["params"]["key"], "k")
        with mock.patch("zones.places.requests.get", return_value=fake_response([], status=404)):
            cache.clear()
            self.assertEqual(places.search("nothing", self.zone), [])  # 404 means "no match" there

    @override_settings(GEOCODER_PROVIDER="geoapify", GEOCODER_API_KEY="k")
    def test_geoapify_shape_and_bias(self):
        payload = {"results": [{"name": "Kamina Barracks", "formatted": "Kamina Barracks, Tamale", "lat": 9.42, "lon": -0.83},
                               {"formatted": "no coordinates"}]}
        with mock.patch("zones.places.requests.get", return_value=fake_response(payload)) as get:
            r = places.search("kamina", self.zone, near=(9.4, -0.85))
        self.assertEqual([x["name"] for x in r], ["Kamina Barracks"])
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["filter"], "rect:-1.0,9.3,-0.7,9.5")
        self.assertEqual(params["bias"], "proximity:-0.85,9.4")


class ZoneBoxTests(TestCase):
    def test_box_polygon_and_garbage(self):
        z = lambda b: ServiceZone(name="x", boundary=b)  # noqa: E731
        self.assertEqual(places.zone_bbox(z(BOX)), (9.30, -1.00, 9.50, -0.70))
        poly = {"type": "Polygon", "coordinates": [[[-1.0, 9.3], [-0.7, 9.3], [-0.7, 9.5], [-1.0, 9.5], [-1.0, 9.3]]]}
        self.assertEqual(places.zone_bbox(z(poly)), (9.3, -1.0, 9.5, -0.7))
        self.assertIsNone(places.zone_bbox(z({})))
        self.assertIsNone(places.zone_bbox(z({"coordinates": "nope"})))
        self.assertIsNone(places.zone_bbox(None))


@override_settings(GEOCODER_PROVIDER="")
class EndpointTests(Base):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(phone="+233200000040", role="passenger"))
        self.place("Citadel Hostel", zone=self.zone)

    def test_requires_sign_in(self):
        self.assertEqual(APIClient().get("/api/places/search?q=cit").status_code, 401)

    def test_returns_matches_for_the_zone(self):
        r = self.client.get(f"/api/places/search?q=cit&zone={self.zone.id}&lat=9.4&lng=-0.85")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["results"][0]["name"], "Citadel Hostel")
        self.assertEqual(set(r.data["results"][0]), {"id", "name", "label", "lat", "lng", "source"})
        self.assertEqual(self.client.get(f"/api/places/search?q=cit&zone={self.other.id}").data["results"], [])

    def test_too_short_missing_or_junk_input_is_harmless(self):
        for url in ("/api/places/search", "/api/places/search?q=c", "/api/places/search?q=cit&zone=abc&lat=x&lng=y",
                    "/api/places/search?q=cit&lat=999&lng=0"):
            r = self.client.get(url)
            self.assertEqual(r.status_code, 200, url)
        self.assertEqual(self.client.get("/api/places/search?q=c").data["results"], [])
        self.assertEqual(len(self.client.get("/api/places/search?q=cit&zone=abc").data["results"]), 1)


class ImportCommandTests(Base):
    def run_csv(self, text, *args):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as f:
            f.write(text)
        out, err = StringIO(), StringIO()
        try:
            call_command("import_places", f.name, *args, stdout=out, stderr=err)
        finally:
            os.unlink(f.name)
        return out.getvalue(), err.getvalue()

    def test_adds_updates_and_reports_bad_rows(self):
        csv_text = ("zone,name,aliases,area,lat,lng\n"
                    "UDS,Citadel Hostel,Citadel;the Cit,Nyankpala,9.40,-0.85\n"
                    ",Tamale Central Market,,Tamale,9.4034,-0.8424\n"
                    "Nowhere,Ghost Place,,,9.4,-0.8\n"
                    "UDS,No Coordinates,,,abc,def\n"
                    "UDS,Far Away,,,95,0\n")
        out, err = self.run_csv(csv_text)
        self.assertIn("added 2, updated 0, skipped 3", out)
        self.assertIn("zone that doesn't exist", err)
        self.assertEqual(Place.objects.get(name="Citadel Hostel").aliases, "Citadel, the Cit")
        self.assertIsNone(Place.objects.get(name="Tamale Central Market").zone)
        out, _ = self.run_csv("zone,name,aliases,area,lat,lng\nUDS,Citadel Hostel,,Nyankpala campus,9.41,-0.86\n")
        self.assertIn("added 0, updated 1", out)
        self.assertEqual(Place.objects.filter(name="Citadel Hostel").count(), 1)
        self.assertEqual(Place.objects.get(name="Citadel Hostel").area, "Nyankpala campus")

    def test_dry_run_saves_nothing_and_missing_columns_are_explained(self):
        out, _ = self.run_csv("zone,name,aliases,area,lat,lng\nUDS,Citadel Hostel,,,9.4,-0.85\n", "--dry-run")
        self.assertIn("would add 1", out)
        self.assertEqual(Place.objects.count(), 0)
        with self.assertRaisesMessage(CommandError, "Missing: lat, lng"):
            self.run_csv("zone,name\nUDS,X\n")
