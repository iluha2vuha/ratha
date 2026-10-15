import unittest
from datetime import date

from app.routers.places import Place
from app.trip_planner import (
    build_option, cumulative_km, cut, elevation_stats, place_rest_stops, rate_day,
    rough_distance_km, similar_tracks, visit_order,
)

KM_PER_DEGREE_LAT = 111.195


def north_track(km: float, steps: int = 300, climb_m: float = 0.0, lon: float = -5.0):
    """A straight track due north from 56N, `km` long, rising evenly by `climb_m`."""
    return [(56 + km * i / steps / KM_PER_DEGREE_LAT, lon, 100 + climb_m * i / steps) for i in range(steps + 1)]


def stay(name: str, km: float, east_km: float = 0.0, kind: str = "hotel") -> Place:
    return Place(id=f"node/{abs(hash(name))}", name=name, kind=kind, kind_label=kind.title(),
                 lat=56 + km / KM_PER_DEGREE_LAT, lon=-5 + east_km / 61.0, osm_url="https://www.openstreetmap.org/node/1")


class RestStopTests(unittest.TestCase):
    def test_night_moves_to_best_nearby_stay_and_next_day_starts_there(self):
        track = north_track(30)
        cum = cumulative_km(track)
        places = [stay("Far Hotel", 9.5, east_km=2.0), stay("Path Hostel", 11.0, east_km=0.2, kind="hostel"), stay("Second Inn", 21.5)]
        nights = place_rest_stops(track, cum, [10, 10, 10], lambda lat, lon: places, radius_km=8)
        self.assertEqual([n.stay.name for n in nights], ["Path Hostel", "Second Inn"])
        self.assertAlmostEqual(nights[0].end_km, 11.0, delta=0.05)
        self.assertAlmostEqual(nights[1].target_km, nights[0].end_km + 10, delta=0.01)
        self.assertIn("Far Hotel", [alt.name for alt in nights[0].alternatives])

    def test_missing_stays_are_reported_with_the_search_radius(self):
        track = north_track(30)
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: [], radius_km=8.04672)
        self.assertIsNone(nights[0].stay)
        self.assertAlmostEqual(nights[0].end_km, 15)
        self.assertIn("within 5 miles (8 km)", nights[0].note)

    def test_stays_outside_the_radius_are_listed_as_nearest(self):
        track = north_track(30)
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: [stay("Distant", 26)], radius_km=5)
        self.assertIsNone(nights[0].stay)
        self.assertEqual([place.name for place in nights[0].nearest], ["Distant"])
        self.assertIn("closest mapped places", nights[0].note)

    def test_nearest_stays_are_the_closest_outside_the_radius(self):
        track = north_track(40)
        places = [stay("Far Inn", 32), stay("Closer Bothy", 22, kind="bothy"), stay("Mid Hostel", 27, kind="hostel")]
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: places, radius_km=5)
        self.assertIsNone(nights[0].stay)
        self.assertEqual([place.name for place in nights[0].nearest], ["Closer Bothy", "Mid Hostel", "Far Inn"])

    def test_failed_search_is_not_reported_as_no_stays(self):
        track = north_track(30)
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: None, radius_km=8)
        self.assertIn("did not respond", nights[0].note)

    def test_stay_kinds_ignore_other_types(self):
        track = north_track(30)
        places = [stay("Glen Hotel", 15), stay("Path Hostel", 16, kind="hostel")]
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: places, radius_km=8, stay_kinds=["hostel"])
        self.assertEqual(nights[0].stay.name, "Path Hostel")

    def test_stay_kinds_are_named_when_none_match(self):
        track = north_track(30)
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: [stay("Glen Hotel", 15)], radius_km=8, stay_kinds=["bothy"])
        self.assertIsNone(nights[0].stay)
        self.assertIn("bothies", nights[0].note)

    def test_unnamed_stays_lose_to_a_slightly_further_named_one(self):
        track = north_track(30)
        places = [stay("Unnamed campsite", 15.2, kind="campsite"), stay("Glen Bothy", 16.0, kind="bothy")]
        nights = place_rest_stops(track, cumulative_km(track), [15, 15], lambda lat, lon: places, radius_km=8)
        self.assertEqual(nights[0].stay.name, "Glen Bothy")


class OptionTests(unittest.TestCase):
    def option(self, track, goals, nights=None):
        cum = cumulative_km(track)
        nights = nights if nights is not None else place_rest_stops(track, cum, goals, lambda lat, lon: [], radius_km=8)
        return build_option(option_id="test", label="Test", description="", points=track,
                            night_cuts=[n.end_km for n in nights], nights=nights, path_included=False,
                            start_name="Start", finish_name="Finish", poi_marks=[("Viewpoint", 5.0)],
                            goals=goals, mode="hiking", pace="steady", start_date=date(2026, 10, 10))

    def test_route_longer_than_goals_is_flagged_not_extended(self):
        option = self.option(north_track(30), [10, 10])
        self.assertEqual(len(option.plan.stages), 2)
        self.assertAlmostEqual(option.over_goal_km, 10, delta=0.05)
        self.assertIn("10.0 km more than your daily goals add up to (20 km)", option.goal_note)

    def test_route_shorter_than_goals_reports_unneeded_days(self):
        option = self.option(north_track(15), [10, 10, 10])
        self.assertEqual(len(option.plan.stages), 2)
        self.assertEqual(option.unused_days, 1)
        self.assertIn("reaches the finish on day 2", option.goal_note)

    def test_stages_share_endpoints_carry_names_and_conserve_distance(self):
        option = self.option(north_track(30, climb_m=300), [15, 15])
        first, second = option.plan.stages
        self.assertEqual(first.points[-1], second.points[0])
        self.assertEqual(first.points[0].name, "Start")
        self.assertEqual(second.points[-1].name, "Finish")
        self.assertIn("Viewpoint", [p.name for p in first.points])
        self.assertAlmostEqual(first.distance_km + second.distance_km, option.distance_km, delta=0.02)
        self.assertAlmostEqual(option.ascent_m, 300, delta=5)
        self.assertEqual(first.goal_km, 15)
        self.assertEqual(option.rest_stops[0].name, "Night 1 stop (km 15.0)")

    def test_missing_elevation_rates_by_distance_and_says_so(self):
        track = [(lat, lon, None) for lat, lon, _ in north_track(12)]
        option = self.option(track, [12])
        self.assertIsNone(option.ascent_m)
        self.assertEqual(option.profile, [])
        self.assertIn("Elevation unavailable", " ".join(option.difficulty_notes))


class ElevationAndDifficultyTests(unittest.TestCase):
    def test_even_climb_gives_ascent_and_grade(self):
        stats = elevation_stats(north_track(1, steps=100, climb_m=120))
        self.assertAlmostEqual(stats.ascent_m, 120, delta=1)
        self.assertAlmostEqual(stats.descent_m, 0, delta=0.5)
        self.assertAlmostEqual(stats.steepest_climb_pct, 12, delta=0.5)
        self.assertGreater(stats.steep_share_pct, 95)

    def test_difficulty_uses_distance_climb_and_steep_ground(self):
        self.assertEqual(rate_day("hiking", 8, 100, 5), 0)
        self.assertEqual(rate_day("hiking", 15, 400, 8), 1)
        self.assertEqual(rate_day("hiking", 15, 400, 30), 2)
        self.assertEqual(rate_day("hiking", 30, 1500, 30), 3)
        self.assertEqual(rate_day("cycling", 30, 100, 5), 0)


class GeometryTests(unittest.TestCase):
    def test_visit_order_avoids_backtracking(self):
        start, finish = (56.0, -5.0), (57.0, -5.0)
        places = [(56.8, -5.0), (56.2, -5.0), (56.5, -5.0)]
        self.assertEqual(visit_order(start, places, finish), [1, 2, 0])

    def test_rough_distance_adds_a_path_allowance(self):
        start, finish = (56.0, -5.0), (56.0 + 20 / KM_PER_DEGREE_LAT, -5.0)
        straight, estimated = rough_distance_km([start, finish], "hiking")
        self.assertAlmostEqual(straight, 20, delta=0.02)
        self.assertAlmostEqual(estimated, 27, delta=0.03)

    def test_cut_shares_points_and_keeps_length(self):
        track = north_track(10, steps=7)
        pieces = cut(track, cumulative_km(track), [3.3, 6.6])
        self.assertEqual(len(pieces), 3)
        self.assertEqual(pieces[0][-1], pieces[1][0])
        self.assertAlmostEqual(sum(cumulative_km(piece)[-1] for piece in pieces), cumulative_km(track)[-1], delta=1e-6)

    def test_similar_tracks(self):
        track = north_track(20)
        self.assertTrue(similar_tracks(track, list(track)))
        self.assertFalse(similar_tracks(track, north_track(20, lon=-4.9)))


if __name__ == "__main__":
    unittest.main()
