import math
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import route_places
from app.main import app
from app.routers import auth, route_planner
from app.routers.places import OverpassUnavailable
from app.trip_planner import cumulative_km
from app.weather import DAILY_FIELDS

PLACES = {'Start': (56.0, -5.0), 'Finish': (56.36, -5.0), 'South Cairn': (56.1, -5.0), 'North Cairn': (56.25, -5.0)}
HOTEL = (56.0 + 15.5 / 111.195, -5.0 + 0.6 / 62.2)


def fake_geocode(place):
    lat, lon = PLACES[place]
    return lat, lon, place


def fake_valhalla(url, payload):
    """Straight legs between locations, bowed east by an amount that depends on the profile."""
    options = next(iter(payload['costing_options'].values()))
    bend = 0.0 if options.get('shortest') else 0.05 if options.get('max_hiking_difficulty') else 0.02
    legs = []
    for a, b in zip(payload['locations'], payload['locations'][1:]):
        shape = [[a['lat'] + (b['lat'] - a['lat']) * i / 40, a['lon'] + (b['lon'] - a['lon']) * i / 40 + bend * math.sin(math.pi * i / 40)]
                 for i in range(41)]
        samples = [100 + 50 * math.sin(k / 20) for k in range(int(cumulative_km(shape)[-1] * 1000 / 30) + 2)]
        legs.append({'shape': polyline(shape), 'elevation': samples, 'elevation_interval': 30})
    return {'trip': {'legs': legs, 'summary': {}}}


def fake_overpass(query):
    if 'tourism' not in query:
        return []
    return [{'type': 'node', 'id': 99, 'lat': HOTEL[0], 'lon': HOTEL[1], 'tags': {'tourism': 'hotel', 'name': 'Glen Hotel'}}]


def polyline(points):
    output = ''
    last = [0, 0]
    for point in points:
        for i in range(2):
            current = round(point[i]*1000000)
            diff = current-last[i]
            last[i] = current
            value = ~(diff << 1) if diff < 0 else diff << 1
            while value >= 0x20:
                output += chr((0x20 | (value & 0x1f))+63)
                value >>= 5
            output += chr(value+63)
    return output


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(auth, 'DB_PATH', Path(self.temp.name)/'test.sqlite3')
        self.db_patch.start()
        auth._initialize()
        route_planner._route_cache.clear()
        route_places._cache.clear()
        self.pacing_patch = patch.object(route_planner, 'ROUTE_INTERVAL_SECONDS', 0)
        self.pacing_patch.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.pacing_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    def test_auth_registration_login_session_and_logout(self):
        credentials = {'email': 'test@example.com', 'password': 'test-password-123'}
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        response = self.client.post('/api/auth/register', json={**credentials, 'display_name': 'Test Hiker'})
        self.assertEqual(response.status_code, 201)
        self.assertIn('httponly', response.headers['set-cookie'].lower())
        self.assertEqual(self.client.get('/api/auth/me').json()['display_name'], 'Test Hiker')
        self.assertEqual(self.client.post('/api/auth/register', json={**credentials, 'display_name': 'Duplicate'}).status_code, 409)
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 204)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', json={**credentials, 'password': 'incorrect-password'}).status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', json=credentials).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me').json()['email'], credentials['email'])

    def test_auth_rejects_bad_registration(self):
        response = self.client.post('/api/auth/register', json={'email': 'bad-address', 'password': 'test-password', 'display_name': 'Hiker'})
        self.assertEqual(response.status_code, 422)

    def trip(self, **overrides):
        return {'start': 'Start', 'finish': 'Finish', 'mode': 'hiking', 'daily_km': [15, 15],
                'start_date': date.today().isoformat(), **overrides}

    def test_trip_options_rest_stops_and_weather_fit_together(self):
        with patch('app.routers.route_planner._json_request', side_effect=fake_valhalla) as routed, \
             patch('app.routers.route_planner._geocode', side_effect=fake_geocode), \
             patch('app.route_places._elements', side_effect=fake_overpass):
            response = self.client.post('/api/route/plan', json=self.trip(points_of_interest=['North Cairn', 'South Cairn']))
        self.assertEqual(response.status_code, 200, response.text)
        trip = response.json()
        self.assertEqual([p['name'] for p in trip['points_of_interest']], ['South Cairn', 'North Cairn'])
        self.assertEqual([o['id'] for o in trip['options']], ['balanced', 'direct', 'hill'])
        self.assertIn('Other route preferences gave the same line', ' '.join(trip['notices']))

        option = trip['options'][0]
        night = option['rest_stops'][0]
        self.assertEqual(night['stay']['name'], 'Glen Hotel')
        self.assertTrue(night['path_included'])
        rerouted = [call.args[1]['locations'] for call in routed.call_args_list if len(call.args[1]['locations']) == 5]
        self.assertTrue(any(abs(loc['lon'] - HOTEL[1]) < 1e-6 for locations in rerouted for loc in locations))
        first, second = option['plan']['stages']
        self.assertEqual(first['points'][-1]['name'], 'Glen Hotel')
        self.assertEqual(first['points'][-1], second['points'][0])
        self.assertIsNotNone(option['ascent_m'])
        self.assertIn(option['difficulty'], ['Easy', 'Moderate', 'Challenging', 'Strenuous'])
        self.assertGreater(option['over_goal_km'], 0)
        self.assertIn('more than your daily goals add up to (30 km)', option['goal_note'])

        def forecasts(samples):
            dates = [stage['date'] for stage in option['plan']['stages']]
            values = dict(zip(DAILY_FIELDS, [5, 12, 2, 15, 25, 0, 3]))
            return [{'daily': {'time': dates, **{key: [value]*len(dates) for key, value in values.items()}}} for _ in samples]
        with patch('app.weather.fetch_forecasts', side_effect=forecasts):
            weather = self.client.post('/api/weather', json={'stages': option['plan']['stages']})
        self.assertEqual(weather.status_code, 200)
        self.assertTrue(all(day['status'] == 'available' for day in weather.json()['days']))

    def test_unavailable_place_search_is_reported_not_hidden(self):
        def offline(query):
            raise OverpassUnavailable(True, 'busy')
        with patch('app.routers.route_planner._json_request', side_effect=fake_valhalla), \
             patch('app.routers.route_planner._geocode', side_effect=fake_geocode), \
             patch('app.route_places._elements', side_effect=offline):
            response = self.client.post('/api/route/plan', json=self.trip())
        self.assertEqual(response.status_code, 200, response.text)
        trip = response.json()
        self.assertIn('could not be checked', ' '.join(trip['notices']))
        self.assertIn('did not respond', trip['options'][0]['rest_stops'][0]['note'])

    def test_trip_request_validation(self):
        self.assertEqual(self.client.post('/api/route/plan', json=self.trip(daily_km=[])).status_code, 422)
        self.assertEqual(self.client.post('/api/route/plan', json=self.trip(points_of_interest=[' '])).status_code, 422)
        self.assertEqual(self.client.post('/api/route/plan', json=self.trip(finish='start')).status_code, 422)
        self.assertEqual(self.client.post('/api/route/plan', json=self.trip(stay_kinds=[])).status_code, 422)
        self.assertEqual(self.client.post('/api/route/plan', json=self.trip(stay_kinds=['cabin'])).status_code, 422)

    def test_distance_estimate_orders_places_and_allows_for_paths(self):
        with patch('app.routers.route_planner._geocode', side_effect=fake_geocode):
            response = self.client.post('/api/route/estimate', json={
                'start': 'Start', 'finish': 'Finish', 'points_of_interest': ['North Cairn', 'South Cairn'], 'mode': 'hiking'})
        self.assertEqual(response.status_code, 200, response.text)
        estimate = response.json()
        self.assertEqual([place['name'] for place in estimate['points_of_interest']], ['South Cairn', 'North Cairn'])
        self.assertAlmostEqual(estimate['estimated_km'], estimate['straight_km'] * 1.35, places=2)
        self.assertIn('planning estimate', estimate['notice'])

    def test_distant_stays_are_offered_when_none_are_in_range(self):
        distant = {'type': 'node', 'id': 7, 'lat': 56.28, 'lon': -5.0, 'tags': {'tourism': 'hotel', 'name': 'Far Glen Hotel'}}
        with patch('app.routers.route_planner._json_request', side_effect=fake_valhalla), \
             patch('app.routers.route_planner._geocode', side_effect=fake_geocode), \
             patch('app.route_places._elements', return_value=[distant]):
            response = self.client.post('/api/route/plan', json=self.trip(daily_km=[8, 8, 8], stay_radius_km=5))
        self.assertEqual(response.status_code, 200, response.text)
        night = response.json()['options'][0]['rest_stops'][0]
        self.assertIsNone(night['stay'])
        self.assertEqual(night['nearest'][0]['name'], 'Far Glen Hotel')
        self.assertIn('closest mapped places', night['note'])

    def test_imported_track_gets_days_and_rest_stop_notes(self):
        points = [{'lat': 56 + i * 0.002, 'lon': -5, 'elevation': 100 + i} for i in range(101)]
        points[0]['name'] = 'Car park'
        with patch('app.route_places._elements', return_value=[]):
            response = self.client.post('/api/route/track', json={'name': 'My GPX', 'points': points, 'daily_km': [12, 12],
                                                                  'start_date': date.today().isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        option = response.json()['options'][0]
        self.assertEqual(option['label'], 'My GPX')
        self.assertEqual(len(option['plan']['stages']), 2)
        self.assertEqual(option['plan']['stages'][0]['points'][0]['name'], 'Car park')
        self.assertIn('No mapped places to stay', option['rest_stops'][0]['note'])
        self.assertAlmostEqual(option['ascent_m'], 100, delta=2)

    def test_amenities_along_route_and_near_rest_stops(self):
        elements = [
            {'type': 'node', 'id': 1, 'lat': 56.1, 'lon': -5.001, 'tags': {'amenity': 'cafe', 'name': 'Path Cafe'}},
            {'type': 'node', 'id': 2, 'lat': 56.2, 'lon': -4.99, 'tags': {'amenity': 'toilets'}},
            {'type': 'node', 'id': 3, 'lat': 56.2, 'lon': -4.995, 'tags': {'shop': 'supermarket', 'name': 'Village Store'}},
            {'type': 'node', 'id': 4, 'lat': 56.1, 'lon': -5.0, 'tags': {'tourism': 'hotel', 'name': 'Not an amenity'}},
        ]
        with patch('app.route_places._elements', return_value=elements):
            response = self.client.post('/api/route/amenities', json={
                'line': [[56.0, -5.0], [56.3, -5.0]], 'stops': [{'night': 1, 'lat': 56.2, 'lon': -5.0}]})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        along = {item['name']: item for item in result['along_route']}
        self.assertEqual(along['Path Cafe']['kind'], 'food')
        self.assertAlmostEqual(along['Path Cafe']['km'], 11.1, delta=0.2)
        self.assertNotIn('Not an amenity', along)
        near = result['near_stops'][0]['amenities']
        self.assertEqual([item['kind'] for item in near], ['shop', 'toilets'])

    def test_rated_stays_report_missing_key(self):
        with patch.dict('os.environ', {'GOOGLE_PLACES_API_KEY': ''}):
            response = self.client.get('/api/stays/nearby', params={'lat': 56.8, 'lon': -5})
        self.assertEqual(response.status_code, 503)


if __name__ == '__main__':
    unittest.main()
