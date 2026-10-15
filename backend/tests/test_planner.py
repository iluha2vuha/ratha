import unittest
from datetime import date
from pydantic import ValidationError
from app.planner import PlanRequest, RoutePoint, split_route


class PlannerTests(unittest.TestCase):
    def payload(self, **kwargs):
        return PlanRequest(points=[RoutePoint(lat=56.8, lon=-5, elevation=100),
                                   RoutePoint(lat=56.9, lon=-4.9, elevation=700),
                                   RoutePoint(lat=57, lon=-4.8, elevation=200)],
                           start_date=date(2026, 10, 10), **kwargs)

    def test_distance_stages_conserve_route_and_share_boundaries(self):
        payload = self.payload(target=8)
        plan = split_route(payload)
        self.assertEqual(len(plan.stages), 4)
        self.assertAlmostEqual(sum(s.distance_km for s in plan.stages), plan.distance_km)
        self.assertAlmostEqual(sum(s.ascent_m for s in plan.stages), plan.ascent_m)
        self.assertEqual(plan.stages[0].points[0], payload.points[0])
        self.assertEqual(plan.stages[-1].points[-1], payload.points[-1])
        for a, b in zip(plan.stages, plan.stages[1:]):
            self.assertEqual(a.points[-1], b.points[0])
            self.assertEqual((b.date-a.date).days, 1)
        self.assertTrue(all(s.distance_km <= 8+1e-8 for s in plan.stages))

    def test_effort_uses_ascent_and_pace(self):
        plan = split_route(self.payload(mode='effort', target=2, pace='easy'))
        self.assertAlmostEqual(plan.walking_hours, plan.distance_km/3 + plan.ascent_m/600)
        self.assertTrue(all(s.walking_hours <= 2+1e-8 for s in plan.stages))
        self.assertAlmostEqual(sum(s.walking_hours for s in plan.stages), plan.walking_hours)

    def test_short_route_is_one_day(self):
        self.assertEqual(len(split_route(self.payload(target=100)).stages), 1)

    def test_duplicate_points_do_not_create_empty_stages(self):
        payload = self.payload(target=8)
        payload.points.insert(1, payload.points[0])
        self.assertTrue(all(s.distance_km > 0 for s in split_route(payload).stages))

    def test_missing_elevation_distance_and_effort(self):
        payload = self.payload(target=8)
        payload.points[0].elevation = None
        self.assertIsNone(split_route(payload).ascent_m)
        with self.assertRaises(ValidationError):
            PlanRequest(**{**payload.model_dump(), 'mode': 'effort'})

    def test_invalid_targets_and_degenerate_route(self):
        for target in [0, -1, float('nan'), float('inf')]:
            with self.assertRaises(ValidationError):
                self.payload(target=target)
        payload = self.payload(target=1)
        payload.points = [payload.points[0]]*2
        with self.assertRaises(ValueError):
            split_route(payload)
        with self.assertRaises(ValueError):
            split_route(self.payload(target=0.01))

    def test_antimeridian_interpolation(self):
        payload = self.payload(target=100)
        payload.points = [RoutePoint(lat=0, lon=179.9), RoutePoint(lat=0, lon=-179.9)]
        payload.target = 12
        plan = split_route(payload)
        self.assertEqual(len(plan.stages), 2)
        self.assertAlmostEqual(abs(plan.stages[0].points[-1].lon), 180)


if __name__ == '__main__':
    unittest.main()
