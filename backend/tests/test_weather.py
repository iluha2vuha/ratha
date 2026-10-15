import unittest
from datetime import date, timedelta
from unittest.mock import patch
from app.planner import RoutePoint
from app.weather import DAILY_FIELDS, ForecastUnavailable, WeatherRequest, WeatherStage, daily_values, get_weather, route_samples, stage_forecast

TODAY = date(2026, 10, 10)


def forecast(on=TODAY, **changes):
    values = dict(zip(DAILY_FIELDS, [5, 12, 2, 15, 25, 0, 3]))
    values.update(changes)
    return {'daily': {'time': [on.isoformat()], **{key: [value] for key, value in values.items()}}}


class WeatherTests(unittest.TestCase):
    def stage(self, on=TODAY, day=1):
        return WeatherStage(day=day, date=on, points=[RoutePoint(lat=56.8, lon=-5, elevation=100),
                                                    RoutePoint(lat=56.85, lon=-4.95, elevation=1000),
                                                    RoutePoint(lat=56.9, lon=-4.9, elevation=200)])

    def test_samples_cover_endpoints_and_highest_point(self):
        stage = self.stage()
        samples = route_samples(stage.points)
        for point in stage.points:
            self.assertIn(point, samples)
        self.assertGreaterEqual(len(samples), 5)
        self.assertLessEqual(len(samples), 6)

    def test_worst_conditions_trigger_location_warnings(self):
        stage = self.stage()
        points = route_samples(stage.points)
        data = [forecast() for _ in points]
        data[2] = forecast(precipitation_sum=35, wind_gusts_10m_max=85, weather_code=95)
        result = stage_forecast(stage, points, data)
        self.assertEqual(result['precipitation_mm'], 35)
        self.assertEqual(result['gust_kmh'], 85)
        self.assertEqual({w['code'] for w in result['warnings']}, {'rain', 'wind', 'thunder'})
        self.assertTrue(all(w['severity'] == 'severe' for w in result['warnings']))
        self.assertTrue(all(w['location'] == points[2].model_dump() for w in result['warnings']))

    def test_null_or_missing_data_is_unavailable(self):
        self.assertIsNone(daily_values(forecast(temperature_2m_min=None), TODAY))
        self.assertIsNone(daily_values(forecast(on=TODAY+timedelta(days=1)), TODAY))
        self.assertIsNone(daily_values({'daily': {}}, TODAY))
        stage = self.stage()
        points = route_samples(stage.points)
        data = [forecast() for _ in points]
        data[0] = forecast(wind_gusts_10m_max=None)
        self.assertEqual(stage_forecast(stage, points, data)['status'], 'unavailable')

    @patch('app.weather.fetch_forecasts')
    def test_outside_window_never_requests_provider(self, fetch):
        payload = WeatherRequest(stages=[self.stage(TODAY-timedelta(days=1)), self.stage(TODAY+timedelta(days=16), day=2)])
        result = get_weather(payload, today=TODAY)
        fetch.assert_not_called()
        self.assertTrue(all(d['status'] == 'unavailable' for d in result['days']))

    @patch('app.weather.fetch_forecasts', side_effect=ForecastUnavailable('Provider unavailable'))
    def test_provider_failure_is_unavailable_not_good_weather(self, fetch):
        result = get_weather(WeatherRequest(stages=[self.stage()]), today=TODAY)
        self.assertEqual(result['days'][0]['status'], 'unavailable')
        self.assertNotIn('warnings', result['days'][0])

    @patch('app.weather.fetch_forecasts')
    def test_dates_align_with_each_daily_stage(self, fetch):
        tomorrow = TODAY+timedelta(days=1)
        stages = [self.stage(), self.stage(tomorrow, day=2)]
        sample_count = len(route_samples(stages[0].points))
        fetch.return_value = [forecast()]*sample_count + [forecast(tomorrow, snowfall_sum=2, temperature_2m_min=-3)]*sample_count
        result = get_weather(WeatherRequest(stages=stages), today=TODAY)
        self.assertEqual(result['days'][0]['warnings'], [])
        self.assertEqual({w['code'] for w in result['days'][1]['warnings']}, {'snow', 'cold'})
        self.assertEqual(result['days'][1]['date'], tomorrow.isoformat())


if __name__ == '__main__':
    unittest.main()
