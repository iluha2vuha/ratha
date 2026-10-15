import json
import unittest
from unittest.mock import patch

from app.routers import places


class _Response:
    def __init__(self, payload: dict):
        self._payload = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class PlaceTests(unittest.TestCase):
    def setUp(self):
        places._cache.clear()

    @patch("app.routers.places.urlopen")
    def test_places_are_classified_from_openstreetmap_tags(self, urlopen):
        urlopen.return_value = _Response(
            {
                "elements": [
                    {"type": "node", "id": 1, "lat": 56.2, "lon": -3.9, "tags": {"tourism": "camp_site", "name": "Glen Camp", "fee": "£12", "website": "example.com"}},
                    {"type": "way", "id": 2, "center": {"lat": 56.21, "lon": -3.88}, "tags": {"bothy": "yes", "name": "Allt Bothy"}},
                    {"type": "node", "id": 3, "lat": 56.19, "lon": -3.87, "tags": {"tourism": "hotel", "name": "Station Hotel", "stars": "3", "phone": "0131 000 000"}},
                ]
            }
        )
        found = {place.name: place for place in places.list_places(south=56.1, west=-4.0, north=56.3, east=-3.7).places}
        self.assertEqual(found["Glen Camp"].kind, "campsite")
        self.assertEqual(found["Glen Camp"].website, "https://example.com")
        self.assertEqual(found["Allt Bothy"].kind, "bothy")
        self.assertEqual(found["Station Hotel"].stars, "3")
        self.assertIn("openstreetmap.org/node/1", found["Glen Camp"].osm_url)

    def test_wide_view_returns_no_places(self):
        self.assertEqual(places.list_places(south=50, west=-8, north=59, east=1).places, [])

    @patch("app.routers.places.urlopen")
    def test_facilities_cover_water_and_food(self, urlopen):
        urlopen.return_value = _Response(
            {
                "elements": [
                    {"type": "node", "id": 10, "lat": 56.2, "lon": -3.9, "tags": {"amenity": "drinking_water", "name": "Village tap"}},
                    {"type": "way", "id": 11, "center": {"lat": 56.21, "lon": -3.88}, "tags": {"waterway": "stream", "name": "Allt a' Chaorainn"}},
                    {"type": "way", "id": 17, "center": {"lat": 56.25, "lon": -3.95}, "tags": {"waterway": "stream", "name": "Allt a' Chaorainn"}},
                    {"type": "way", "id": 12, "center": {"lat": 56.22, "lon": -3.86}, "tags": {"waterway": "stream"}},
                    {"type": "node", "id": 13, "lat": 56.19, "lon": -3.87, "tags": {"amenity": "cafe", "name": "Station Cafe"}},
                    {"type": "node", "id": 14, "lat": 56.18, "lon": -3.85, "tags": {"amenity": "device_charging_station"}},
                    {"type": "node", "id": 15, "lat": 56.17, "lon": -3.84, "tags": {"amenity": "charging_station", "name": "Hydro charger"}},
                    {"type": "node", "id": 16, "lat": 56.16, "lon": -3.83, "tags": {"tourism": "hotel", "name": "Not a facility"}},
                ]
            }
        )
        result = places.list_places(south=56.1, west=-4.0, north=56.3, east=-3.7, group="facilities").places
        found = {place.name: place for place in result}
        self.assertEqual(found["Village tap"].kind, "water")
        self.assertEqual(found["Allt a' Chaorainn"].kind_label, "Stream")
        self.assertEqual(sum(place.kind_label == "Stream" for place in result), 1)
        self.assertNotIn("Unnamed stream", found)
        self.assertEqual(found["Station Cafe"].kind, "food")
        self.assertNotIn("Unnamed device charging", found)
        self.assertNotIn("Hydro charger", found)
        self.assertNotIn("Not a facility", found)
