import unittest
from unittest.mock import patch

from app import google_places


def place(place_id, name, types, lat=56.81, lon=-5.1, rating=None, reviews=None):
    item = {'id': place_id, 'displayName': {'text': name}, 'types': types,
            'location': {'latitude': lat, 'longitude': lon}, 'googleMapsUri': f'https://maps.google.com/?cid={place_id}'}
    if rating is not None:
        item['rating'] = rating
    if reviews is not None:
        item['userRatingCount'] = reviews
    return item


class GooglePlacesTests(unittest.TestCase):
    def setUp(self):
        google_places._cache.clear()

    @patch.dict('os.environ', {'GOOGLE_PLACES_API_KEY': 'test-key'})
    @patch('app.google_places._post')
    def test_stays_are_classified_and_never_given_invented_ratings(self, post):
        def respond(path, body):
            if path == '/places:searchNearby':
                return {'places': [
                    place('h1', 'Glen Hotel', ['hotel', 'lodging'], rating=4.2, reviews=120),
                    place('c1', 'Glen Campsite', ['campground'], rating=4.6, reviews=80),
                    place('y1', 'Glen Hostel', ['hostel', 'lodging']),
                    place('x1', 'Glen Shop', ['store']),
                ]}
            return {'places': [
                place('b1', 'Corrour Bothy', ['point_of_interest'], rating=4.9, reviews=40),
                place('n1', 'Not a hut', ['point_of_interest'], rating=5),
            ]}
        post.side_effect = respond

        stays = google_places.stays_near(56.8, -5.1)
        self.assertEqual([(s.id, s.type) for s in stays], [('b1', 'bothy'), ('c1', 'campsite'), ('y1', 'hostel'), ('h1', 'hotel')])
        hostel = next(s for s in stays if s.id == 'y1')
        self.assertIsNone(hostel.rating)
        self.assertEqual(hostel.review_count, 0)
        self.assertEqual(stays[1].google_maps_url, 'https://maps.google.com/?cid=c1')

        google_places.stays_near(56.8, -5.1)
        self.assertEqual(post.call_count, 2)

    @patch.dict('os.environ', {'GOOGLE_PLACES_API_KEY': ''})
    def test_missing_key_is_reported(self):
        self.assertFalse(google_places.is_configured())
        with self.assertRaises(google_places.GooglePlacesUnavailable):
            google_places.stays_near(56.8, -5.1)


if __name__ == '__main__':
    unittest.main()
