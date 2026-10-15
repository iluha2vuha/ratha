"""Open-Meteo daily forecasts sampled along each stage, with planning thresholds."""
import json
from datetime import date, datetime, timedelta, timezone
from math import isfinite
from threading import Lock
from time import monotonic
from typing import Optional
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, model_validator
from app.planner import RoutePoint, distance, interpolate

DAILY_FIELDS = ['temperature_2m_min', 'temperature_2m_max', 'precipitation_sum',
                'wind_speed_10m_max', 'wind_gusts_10m_max', 'snowfall_sum', 'weather_code']


class WeatherStage(BaseModel):
    day: int = Field(ge=1, le=60)
    date: date
    points: list[RoutePoint] = Field(min_length=2, max_length=10000)


class WeatherRequest(BaseModel):
    stages: list[WeatherStage] = Field(min_length=1, max_length=60)

    @model_validator(mode='after')
    def unique_days(self):
        if len({s.day for s in self.stages}) != len(self.stages):
            raise ValueError('Each stage must have a unique day number.')
        if len({s.date for s in self.stages}) != len(self.stages):
            raise ValueError('Each stage must have a unique date.')
        if sum(len(s.points) for s in self.stages) > 20000:
            raise ValueError('Too many route points across stages.')
        return self


class ForecastUnavailable(Exception):
    pass


_cache = {}
_cache_lock = Lock()


def route_samples(points: list[RoutePoint]) -> list[RoutePoint]:
    """Start, quarter, middle, three-quarter, finish, plus highest known point."""
    cumulative = [0.0]
    for a, b in zip(points, points[1:]):
        cumulative.append(cumulative[-1]+distance(a, b))
    samples = [points[0]]
    for fraction in [0.25, 0.5, 0.75]:
        target = cumulative[-1]*fraction
        for i in range(1, len(points)):
            if cumulative[i] >= target and cumulative[i] > cumulative[i-1]:
                samples.append(interpolate(points[i-1], points[i], (target-cumulative[i-1])/(cumulative[i]-cumulative[i-1])))
                break
    samples.append(points[-1])
    elevations = [p for p in points if p.elevation is not None]
    if elevations:
        samples.append(max(elevations, key=lambda p: p.elevation))
    unique = {}
    for p in samples:
        unique[(round(p.lat, 5), round(p.lon, 5), p.elevation)] = p
    return list(unique.values())


def fetch_forecasts(points: list[RoutePoint]) -> list[dict]:
    key = tuple((round(p.lat, 5), round(p.lon, 5), p.elevation) for p in points)
    with _cache_lock:
        cached = _cache.get(key)
        if cached and monotonic()-cached[0] < 600:
            return cached[1]
    params = {'latitude': ','.join(str(p.lat) for p in points),
              'longitude': ','.join(str(p.lon) for p in points),
              'daily': ','.join(DAILY_FIELDS), 'forecast_days': 16, 'timezone': 'auto',
              'wind_speed_unit': 'kmh', 'precipitation_unit': 'mm', 'temperature_unit': 'celsius',
              'elevation': ','.join('nan' if p.elevation is None else str(p.elevation) for p in points)}
    try:
        with urlopen('https://api.open-meteo.com/v1/forecast?'+urlencode(params), timeout=20) as response:
            data = json.load(response)
        forecasts = data if isinstance(data, list) else [data]
        if len(forecasts) != len(points) or any(not isinstance(f, dict) or 'daily' not in f for f in forecasts):
            raise ValueError('Incomplete forecast response')
    except (OSError, ValueError, TypeError) as exc:
        raise ForecastUnavailable('Weather provider is unavailable. Try refreshing later.') from exc
    with _cache_lock:
        if len(_cache) >= 16:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (monotonic(), forecasts)
    return forecasts


def daily_values(forecast: dict, on: date) -> Optional[dict]:
    daily = forecast.get('daily', {})
    try:
        index = daily['time'].index(on.isoformat())
        values = {field: daily[field][index] for field in DAILY_FIELDS}
        if not all(isinstance(value, (float, int)) and isfinite(value) for value in values.values()):
            return None
        return values
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        return None


def warnings_for(values: dict, point: RoutePoint) -> list[dict]:
    warnings = []
    def add(code, severity, message):
        warnings.append({'code': code, 'severity': severity, 'message': message,
                         'location': point.model_dump()})
    gust = values['wind_gusts_10m_max']
    wind = values['wind_speed_10m_max']
    if gust >= 65 or wind >= 50:
        add('wind', 'severe' if gust >= 80 or wind >= 65 else 'caution',
            f'Strong winds: {wind:.0f} km/h sustained, gusting {gust:.0f} km/h. Exposed sections may be difficult.')
    if values['precipitation_sum'] >= 20:
        add('rain', 'severe' if values['precipitation_sum'] >= 30 else 'caution',
            f'Heavy precipitation: {values["precipitation_sum"]:.0f} mm in the day. Review river crossings.')
    if values['snowfall_sum'] >= 1:
        add('snow', 'caution', f'Snowfall: {values["snowfall_sum"]:.1f} cm. Snow may affect the track.')
    if values['weather_code'] in (95, 96, 99):
        add('thunder', 'severe', 'Thunderstorms forecast. Review exposed ridges and summits.')
    if values['weather_code'] in (56, 57, 66, 67):
        add('ice', 'severe', 'Freezing precipitation forecast. Icy surfaces may affect the track.')
    if values['temperature_2m_min'] <= 0:
        add('cold', 'caution', f'Freezing temperatures: minimum {values["temperature_2m_min"]:.0f}°C, including overnight.')
    if values['temperature_2m_max'] >= 30:
        add('heat', 'caution', f'Heat: maximum {values["temperature_2m_max"]:.0f}°C. Plan water and breaks.')
    return warnings


def stage_forecast(stage: WeatherStage, points: list[RoutePoint], forecasts: list[dict]) -> dict:
    samples = []
    for point, forecast in zip(points, forecasts):
        values = daily_values(forecast, stage.date)
        if values is None:
            return {'day': stage.day, 'date': stage.date.isoformat(), 'status': 'unavailable',
                    'reason': 'Forecast is missing or incomplete for a sampled point on this date.'}
        samples.append({'location': point.model_dump(), 'values': values})
    warnings = {}
    for sample in samples:
        for warning in warnings_for(sample['values'], RoutePoint(**sample['location'])):
            # Keep every affected location, so a stronger condition cannot be hidden by a milder sample.
            warnings.setdefault(warning['code'], []).append(warning)
    alerts = []
    for code, matches in warnings.items():
        metric = {'wind': 'wind_gusts_10m_max', 'rain': 'precipitation_sum', 'snow': 'snowfall_sum',
                  'cold': 'temperature_2m_min', 'heat': 'temperature_2m_max'}.get(code)
        def strength(warning):
            sample = next(s for s in samples if s['location'] == warning['location'])
            value = sample['values'].get(metric, 0)
            return (warning['severity'] == 'severe', -value if code == 'cold' else value)
        strongest = max(matches, key=strength)
        alerts.append({**strongest, 'locations': [w['location'] for w in matches]})
    values = [s['values'] for s in samples]
    return {'day': stage.day, 'date': stage.date.isoformat(), 'status': 'available',
            'temperature_min': min(v['temperature_2m_min'] for v in values),
            'temperature_max': max(v['temperature_2m_max'] for v in values),
            'precipitation_mm': max(v['precipitation_sum'] for v in values),
            'wind_kmh': max(v['wind_speed_10m_max'] for v in values),
            'gust_kmh': max(v['wind_gusts_10m_max'] for v in values),
            'snowfall_cm': max(v['snowfall_sum'] for v in values),
            'weather_codes': sorted(set(int(v['weather_code']) for v in values)),
            'warnings': alerts, 'samples': samples}


def get_weather(payload: WeatherRequest, today: Optional[date] = None) -> dict:
    today = today or datetime.now(ZoneInfo('Europe/London')).date()
    days = []
    pending = []
    all_points = []
    for stage in payload.stages:
        if not today <= stage.date <= today+timedelta(days=15):
            days.append({'day': stage.day, 'date': stage.date.isoformat(), 'status': 'unavailable',
                         'reason': 'Outside the forecast window (today through the next 15 days). Check again nearer departure.'})
            continue
        samples = route_samples(stage.points)
        pending.append((stage, samples, len(all_points)))
        all_points.extend(samples)
    if all_points:
        try:
            forecasts = fetch_forecasts(all_points)
            for stage, samples, offset in pending:
                days.append(stage_forecast(stage, samples, forecasts[offset:offset+len(samples)]))
        except ForecastUnavailable as exc:
            days.extend({'day': stage.day, 'date': stage.date.isoformat(), 'status': 'unavailable',
                         'reason': str(exc)} for stage, _, _ in pending)
    return {'days': sorted(days, key=lambda d: d['day']), 'source': 'Open-Meteo',
            'source_url': 'https://open-meteo.com/', 'checked_at': datetime.now(timezone.utc).isoformat(),
            'notice': 'Daily forecasts at up to six route samples per stage, including overnight. Warnings use Ratha planning thresholds, not official weather alerts. Conditions between samples and on exposed ground may differ.'}
