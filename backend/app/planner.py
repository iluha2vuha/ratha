"""Stage a supplied route track; this module does not invent paths or overnight stops."""
from datetime import date, timedelta
from math import asin, ceil, cos, radians, sin, sqrt
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class RoutePoint(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    elevation: Optional[float] = Field(default=None, ge=-500, le=9000, allow_inf_nan=False)
    name: Optional[str] = Field(default=None, max_length=120)


class PlanRequest(BaseModel):
    points: list[RoutePoint] = Field(min_length=2, max_length=10000)
    start_date: date
    mode: Literal['distance', 'effort', 'stops'] = 'distance'
    target: float = Field(gt=0, le=100, allow_inf_nan=False)
    pace: Literal['easy', 'steady', 'hard'] = 'steady'
    travel_mode: Literal['hiking', 'cycling'] = 'hiking'
    # Point indices where each day ends, used by 'stops' mode.
    breaks: list[int] = Field(default_factory=list, max_length=59)

    @model_validator(mode='after')
    def validate_effort(self):
        if self.mode == 'stops':
            if not self.breaks:
                raise ValueError('Mark at least one overnight stop to split by stops.')
            if sorted(set(self.breaks)) != self.breaks or self.breaks[0] <= 0 or self.breaks[-1] >= len(self.points) - 1:
                raise ValueError('Overnight stops must be distinct points inside the route, in order.')
        if self.mode == 'effort' and any(p.elevation is None for p in self.points):
            raise ValueError('Effort planning needs elevation at every track point. Use distance mode for this track.')
        if self.mode == 'effort' and self.target > 12:
            raise ValueError('Target walking time must be at most 12 hours.')
        return self


class Stage(BaseModel):
    day: int
    date: date
    points: list[RoutePoint]
    distance_km: float
    ascent_m: Optional[float]
    walking_hours: float
    start_km: float
    end_km: float
    descent_m: Optional[float] = None
    steepest_climb_pct: Optional[float] = None
    steepest_descent_pct: Optional[float] = None
    difficulty: Optional[str] = None
    goal_km: Optional[float] = None


class Plan(BaseModel):
    stages: list[Stage]
    distance_km: float
    ascent_m: Optional[float]
    walking_hours: float
    elevation_known: bool
    descent_m: Optional[float] = None


def distance(a: RoutePoint, b: RoutePoint) -> float:
    lat1, lat2 = radians(a.lat), radians(b.lat)
    h = sin((lat2-lat1)/2)**2 + cos(lat1)*cos(lat2)*sin(radians(b.lon-a.lon)/2)**2
    return 6371.0088 * 2 * asin(min(1, sqrt(h)))


def interpolate(a: RoutePoint, b: RoutePoint, fraction: float) -> RoutePoint:
    if fraction <= 1e-10:
        return a
    if fraction >= 1 - 1e-10:
        return b
    # Use the short longitude arc, including tracks crossing the date line.
    delta_lon = (b.lon-a.lon+180) % 360 - 180
    return RoutePoint(lat=a.lat+(b.lat-a.lat)*fraction,
                      lon=(a.lon+delta_lon*fraction+180) % 360-180,
                      elevation=None if a.elevation is None or b.elevation is None else
                      a.elevation+(b.elevation-a.elevation)*fraction)


def _split_at_breaks(payload: PlanRequest, speed: float, known: bool,
                     total_km: float, total_ascent: float, total_hours: float) -> Plan:
    bounds = [0, *payload.breaks, len(payload.points) - 1]
    stages = []
    overall_km = 0.0
    for day, (first, last) in enumerate(zip(bounds, bounds[1:]), start=1):
        points = payload.points[first:last + 1]
        km = ascent = 0.0
        for a, b in zip(points, points[1:]):
            km += distance(a, b)
            if known:
                ascent += max(0, b.elevation-a.elevation)
        stages.append(Stage(day=day, date=payload.start_date+timedelta(days=day-1), points=points,
                            distance_km=km, ascent_m=ascent if known else None, walking_hours=km/speed + ascent/600,
                            start_km=overall_km, end_km=overall_km+km))
        overall_km += km
    return Plan(stages=stages, distance_km=total_km, ascent_m=total_ascent if known else None,
                walking_hours=total_hours, elevation_known=known)


def split_route(payload: PlanRequest) -> Plan:
    speeds = {'easy': 10, 'steady': 15, 'hard': 20} if payload.travel_mode == 'cycling' else {'easy': 3, 'steady': 4, 'hard': 5}
    speed = speeds[payload.pace]
    known = all(p.elevation is not None for p in payload.points)
    segments = []
    for a, b in zip(payload.points, payload.points[1:]):
        km = distance(a, b)
        if km < 1e-9:
            continue
        ascent = max(0, b.elevation-a.elevation) if known else 0
        hours = km / speed + ascent / 600
        segments.append((a, b, km, ascent, hours))
    total_km = sum(s[2] for s in segments)
    total_ascent = sum(s[3] for s in segments)
    total_hours = sum(s[4] for s in segments)
    if total_km < 0.01:
        raise ValueError('Route must be at least 10 metres long.')
    if payload.mode == 'stops':
        return _split_at_breaks(payload, speed, known, total_km, total_ascent, total_hours)
    measure = total_km if payload.mode == 'distance' else total_hours
    count = ceil(measure / payload.target)
    if count > 60:
        raise ValueError('This target creates more than 60 days. Increase the daily target.')
    budget = measure / count
    stages = []
    current = [segments[0][0]]
    stage_km = stage_ascent = stage_hours = consumed = overall_km = 0.0
    for a, b, km, ascent, hours in segments:
        segment_measure = km if payload.mode == 'distance' else hours
        fraction = 0.0
        while fraction < 1 - 1e-10:
            remaining = segment_measure * (1-fraction)
            room = max(0, budget-consumed)
            piece = min(remaining, room) if len(stages) < count-1 else remaining
            next_fraction = min(1, fraction + piece/segment_measure)
            current.append(interpolate(a, b, next_fraction))
            portion = next_fraction-fraction
            stage_km += km*portion
            stage_ascent += ascent*portion
            stage_hours += hours*portion
            consumed += piece
            fraction = next_fraction
            if len(stages) < count-1 and consumed >= budget-1e-9:
                stages.append(Stage(day=len(stages)+1, date=payload.start_date+timedelta(days=len(stages)),
                                    points=current, distance_km=stage_km,
                                    ascent_m=stage_ascent if known else None, walking_hours=stage_hours,
                                    start_km=overall_km, end_km=overall_km+stage_km))
                overall_km += stage_km
                current = [current[-1]]
                stage_km = stage_ascent = stage_hours = consumed = 0.0
    stages.append(Stage(day=len(stages)+1, date=payload.start_date+timedelta(days=len(stages)),
                        points=current, distance_km=stage_km, ascent_m=stage_ascent if known else None,
                        walking_hours=stage_hours, start_km=overall_km, end_km=total_km))
    return Plan(stages=stages, distance_km=total_km, ascent_m=total_ascent if known else None,
                walking_hours=total_hours, elevation_known=known)
