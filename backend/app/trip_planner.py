"""Turn a routed track into a multi-day trip: rest stops at daily goals, steepness and difficulty.

Nothing here touches the network. Callers supply the track and a function that lists
places to stay near a point, so the planning rules can be tested on their own.
"""
from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import date, timedelta
from itertools import permutations
from typing import Callable, Literal, Optional, Sequence

from pydantic import BaseModel, Field

from app.planner import Plan, RoutePoint, Stage
from app.routers.places import Place

EARTH_KM = 6371.0088
KM_PER_MILE = 1.609344
Mode = Literal["hiking", "cycling"]
Pace = Literal["easy", "steady", "hard"]
SPEEDS: dict[str, dict[str, float]] = {
    "hiking": {"easy": 3, "steady": 4, "hard": 5},
    "cycling": {"easy": 10, "steady": 15, "hard": 20},
}
# Straight-line journeys in the Highlands are usually shorter than the path. This is a
# planning allowance, not a routed distance.
WINDING = {"hiking": 1.35, "cycling": 1.2}
DIFFICULTIES = ("Easy", "Moderate", "Challenging", "Strenuous")
# Effort-km thresholds between the difficulty levels, and the sustained grade that adds a level.
EFFORT_BOUNDS = {"hiking": (12.0, 22.0, 32.0), "cycling": (40.0, 70.0, 100.0)}
CLIMB_KM_PER_100M = {"hiking": 1.0, "cycling": 2.0}
STEEP_GRADE = {"hiking": 25.0, "cycling": 12.0}
STEEP_SHARE_GRADE = 10.0
# Never end a night this close to the finish; the last day would be a token stroll.
MIN_FINAL_KM = 1.0
MIN_DAY_KM = 0.5
# Unnamed mapped stays are often informal pitches; prefer a named place this much closer.
UNNAMED_PENALTY_KM = 1.5
# When nothing is mapped in the user's search radius, list this many of the next-closest stays.
MAX_NEAREST = 4
STAY_KINDS = ("campsite", "bothy", "hostel", "hotel", "guest_house")
STAY_KIND_PLURALS = {
    "campsite": "campsites",
    "bothy": "bothies",
    "hostel": "hostels",
    "hotel": "hotels",
    "guest_house": "guest houses",
}

TrackPoint = tuple[float, float, Optional[float]]
StaysNear = Callable[[float, float], Optional[Sequence[Place]]]


class NamedPoint(BaseModel):
    name: str
    lat: float
    lon: float


class RestStay(Place):
    distance_km: float
    off_route_km: float


class RestStop(BaseModel):
    night: int
    target_km: float
    end_km: float
    lat: float
    lon: float
    name: str
    stay: Optional[RestStay] = None
    alternatives: list[RestStay] = []
    nearest: list[RestStay] = []
    path_included: bool = False
    note: Optional[str] = None


class RouteOption(BaseModel):
    id: str
    label: str
    description: str
    distance_km: float
    moving_hours: float
    ascent_m: Optional[float]
    descent_m: Optional[float]
    max_elevation_m: Optional[float]
    steepest_climb_pct: Optional[float]
    steepest_descent_pct: Optional[float]
    steep_share_pct: Optional[float]
    difficulty: str
    difficulty_notes: list[str]
    profile: list[tuple[float, float]]
    plan: Plan
    rest_stops: list[RestStop]
    goal_km: float
    over_goal_km: float
    unused_days: int
    goal_note: Optional[str] = None


class TripPlan(BaseModel):
    name: str
    mode: Mode
    start: NamedPoint
    finish: NamedPoint
    points_of_interest: list[NamedPoint]
    daily_km: list[float]
    stay_radius_km: float
    stay_kinds: list[str] = Field(default_factory=lambda: list(STAY_KINDS))
    options: list[RouteOption]
    notices: list[str] = []
    attribution: str


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return EARTH_KM * 2 * math.asin(min(1.0, math.sqrt(h)))


def cumulative_km(points: Sequence[tuple[float, float, Optional[float]] | tuple[float, float]]) -> list[float]:
    cum = [0.0]
    for a, b in zip(points, points[1:]):
        cum.append(cum[-1] + distance_km(a[0], a[1], b[0], b[1]))
    return cum


def _lerp(a: Optional[float], b: Optional[float], t: float) -> Optional[float]:
    return None if a is None or b is None else a + (b - a) * t


def point_at(points: Sequence[TrackPoint], cum: Sequence[float], km: float) -> TrackPoint:
    if km <= 0:
        return points[0]
    if km >= cum[-1]:
        return points[-1]
    i = min(bisect_right(cum, km) - 1, len(points) - 2)
    span = cum[i + 1] - cum[i]
    t = 0.0 if span <= 0 else (km - cum[i]) / span
    a, b = points[i], points[i + 1]
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, _lerp(a[2], b[2], t))


def project(points: Sequence[tuple], cum: Sequence[float], lat: float, lon: float,
            lo_km: float = 0.0, hi_km: float = math.inf) -> tuple[float, float]:
    """Nearest position on the track to a point: (km along the track, km away from it)."""
    best = (cum[0], math.inf)
    first = max(0, bisect_right(cum, lo_km) - 1)
    for i in range(first, len(points) - 1):
        if cum[i] > hi_km:
            break
        a, b = points[i], points[i + 1]
        scale = math.cos(math.radians(a[0])) * math.pi * EARTH_KM / 180
        bx, by = (b[1] - a[1]) * scale, (b[0] - a[0]) * math.pi * EARTH_KM / 180
        px, py = (lon - a[1]) * scale, (lat - a[0]) * math.pi * EARTH_KM / 180
        length2 = bx * bx + by * by
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / length2))
        along = cum[i] + (cum[i + 1] - cum[i]) * t
        if along < lo_km or along > hi_km:
            along = min(max(along, lo_km), hi_km)
            t = 0.0 if cum[i + 1] == cum[i] else max(0.0, min(1.0, (along - cum[i]) / (cum[i + 1] - cum[i])))
        x, y = bx * t, by * t
        off = math.hypot(px - x, py - y)
        if off < best[1]:
            best = (along, off)
    return best


def cut(points: Sequence[TrackPoint], cum: Sequence[float], cut_kms: Sequence[float]) -> list[list[TrackPoint]]:
    """Split a track at the given distances, interpolating a shared point at each cut."""
    pieces: list[list[TrackPoint]] = []
    current: list[TrackPoint] = [points[0]]
    cuts = iter(sorted(cut_kms))
    next_cut = next(cuts, None)
    for i in range(1, len(points)):
        while next_cut is not None and next_cut <= cum[i]:
            split = point_at(points, cum, next_cut)
            if current[-1][:2] != split[:2]:
                current.append(split)
            pieces.append(current)
            current = [split]
            next_cut = next(cuts, None)
        if current[-1][:2] != points[i][:2]:
            current.append(points[i])
    pieces.append(current)
    return [piece if len(piece) > 1 else [piece[0], piece[0]] for piece in pieces]


def elevations_along(shape: Sequence[tuple[float, float]], samples: Sequence[Optional[float]], interval_m: float) -> list[Optional[float]]:
    """Map evenly spaced elevation samples onto the shape points they were taken along."""
    if not samples or any(value is None for value in samples) or interval_m <= 0:
        return [None] * len(shape)
    result = []
    for km in cumulative_km(shape):
        position = km * 1000 / interval_m
        i = min(int(position), len(samples) - 1)
        j = min(i + 1, len(samples) - 1)
        result.append(float(samples[i]) + (float(samples[j]) - float(samples[i])) * (position - int(position) if j > i else 0))
    return result


def simplify(points: Sequence[tuple], tolerance_m: float, keep: set[int] | None = None) -> list[int]:
    """Douglas-Peucker indices to keep; `keep` indices always survive."""
    if len(points) < 3:
        return list(range(len(points)))
    keep_set = {0, len(points) - 1, *(keep or ())}
    anchors = sorted(keep_set)
    kept = set(anchors)
    stack = list(zip(anchors, anchors[1:]))
    tolerance_km = tolerance_m / 1000
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        a, b = points[first], points[last]
        scale = math.cos(math.radians(a[0])) * math.pi * EARTH_KM / 180
        bx, by = (b[1] - a[1]) * scale, (b[0] - a[0]) * math.pi * EARTH_KM / 180
        length = math.hypot(bx, by)
        worst, worst_index = -1.0, first
        for i in range(first + 1, last):
            px, py = (points[i][1] - a[1]) * scale, (points[i][0] - a[0]) * math.pi * EARTH_KM / 180
            off = math.hypot(px, py) if length == 0 else abs(px * by - py * bx) / length
            if off > worst:
                worst, worst_index = off, i
        if worst > tolerance_km:
            kept.add(worst_index)
            stack.extend([(first, worst_index), (worst_index, last)])
    return sorted(kept)


@dataclass
class ElevationStats:
    ascent_m: float
    descent_m: float
    max_m: float
    steepest_climb_pct: float
    steepest_descent_pct: float
    steep_share_pct: float
    profile: list[tuple[float, float]] = field(default_factory=list)


def elevation_stats(points: Sequence[TrackPoint], step_m: float = 25.0) -> Optional[ElevationStats]:
    """Ascent, descent and sustained gradients from a resampled, lightly smoothed profile."""
    if len(points) < 2 or any(point[2] is None for point in points):
        return None
    cum = cumulative_km(points)
    total_m = cum[-1] * 1000
    if total_m <= 0:
        return None
    count = max(2, int(total_m // step_m) + 1)
    kms = [min(cum[-1], k * step_m / 1000) for k in range(count)]
    if kms[-1] < cum[-1]:
        kms.append(cum[-1])
    raw = [point_at(points, cum, km)[2] for km in kms]
    smooth = []
    for i in range(len(raw)):
        # Symmetric window that narrows at the ends, so the first and last heights are exact.
        half = min(2, i, len(raw) - 1 - i)
        smooth.append(sum(raw[i - half:i + half + 1]) / (2 * half + 1))
    diffs = [b - a for a, b in zip(smooth, smooth[1:])]
    window = max(1, round(200 / step_m))
    grades = []
    for i in range(max(1, len(smooth) - window)):
        j = min(i + window, len(smooth) - 1)
        run = (kms[j] - kms[i]) * 1000
        if run > 0:
            grades.append((smooth[j] - smooth[i]) / run * 100)
    chunk = max(1, round(100 / step_m))
    steep_m = total_chunks_m = 0.0
    for i in range(0, len(smooth) - 1, chunk):
        j = min(i + chunk, len(smooth) - 1)
        run = (kms[j] - kms[i]) * 1000
        if run <= 0:
            continue
        total_chunks_m += run
        if abs(smooth[j] - smooth[i]) / run * 100 >= STEEP_SHARE_GRADE:
            steep_m += run
    stride = max(1, math.ceil(len(kms) / 120))
    profile = [(round(kms[i], 2), round(smooth[i], 1)) for i in range(0, len(kms), stride)]
    if profile[-1][0] != round(kms[-1], 2):
        profile.append((round(kms[-1], 2), round(smooth[-1], 1)))
    return ElevationStats(
        ascent_m=sum(d for d in diffs if d > 0),
        descent_m=-sum(d for d in diffs if d < 0),
        max_m=max(raw),
        steepest_climb_pct=max([0.0, *grades]),
        steepest_descent_pct=-min([0.0, *grades]),
        steep_share_pct=0.0 if total_chunks_m == 0 else steep_m / total_chunks_m * 100,
        profile=profile,
    )


def is_steep(mode: Mode, steepest_pct: Optional[float]) -> bool:
    return steepest_pct is not None and steepest_pct >= STEEP_GRADE[mode]


def rate_day(mode: Mode, km: float, ascent_m: Optional[float], steepest_pct: Optional[float]) -> int:
    effort = km + (ascent_m or 0) / 100 * CLIMB_KM_PER_100M[mode]
    level = sum(effort >= bound for bound in EFFORT_BOUNDS[mode]) + is_steep(mode, steepest_pct)
    return min(level, len(DIFFICULTIES) - 1)


def moving_hours(mode: Mode, pace: Pace, km: float, ascent_m: Optional[float]) -> float:
    return km / SPEEDS[mode][pace] + (ascent_m or 0) / 600


def visit_order(start: tuple[float, float], places: Sequence[tuple[float, float]], finish: tuple[float, float]) -> list[int]:
    """Order must-visit places to keep the straight-line journey from start to finish short."""
    n = len(places)
    if n < 2:
        return list(range(n))

    def length(order: Sequence[int]) -> float:
        stops = [start, *(places[i] for i in order), finish]
        return sum(distance_km(a[0], a[1], b[0], b[1]) for a, b in zip(stops, stops[1:]))

    if n <= 7:
        return list(min(permutations(range(n)), key=length))
    remaining, order, here = set(range(n)), [], start
    while remaining:
        nearest = min(remaining, key=lambda i: distance_km(here[0], here[1], places[i][0], places[i][1]))
        order.append(nearest)
        remaining.remove(nearest)
        here = places[nearest]
    improved = True
    while improved:
        improved = False
        for i in range(n - 1):
            for j in range(i + 1, n):
                candidate = order[:i] + order[i:j + 1][::-1] + order[j + 1:]
                if length(candidate) < length(order) - 1e-9:
                    order, improved = candidate, True
    return order


def path_allowance(mode: Mode) -> float:
    return WINDING[mode]


def rough_distance_km(stops: Sequence[tuple[float, float]], mode: Mode) -> tuple[float, float]:
    """Straight-line journey between ordered stops, plus a path-and-hills allowance."""
    straight = sum(distance_km(a[0], a[1], b[0], b[1]) for a, b in zip(stops, stops[1:]))
    return straight, straight * path_allowance(mode)


def similar_tracks(a: Sequence[tuple], b: Sequence[tuple], tolerance_km: float = 0.2) -> bool:
    """True when two tracks are near-duplicates: similar length and `a` stays close to `b`."""
    cum_a, cum_b = cumulative_km(a), cumulative_km(b)
    if not cum_a[-1] or not cum_b[-1] or abs(cum_a[-1] - cum_b[-1]) / max(cum_a[-1], cum_b[-1]) > 0.03:
        return False
    stride = max(1, len(b) // 400)
    sample_b = list(b[::stride]) + [b[-1]]
    checks = [point_at(a, cum_a, cum_a[-1] * k / 24) for k in range(25)]
    close = sum(min(distance_km(p[0], p[1], q[0], q[1]) for q in sample_b) <= tolerance_km for p in checks)
    return close >= 0.9 * len(checks)


def radius_label(radius_km: float) -> str:
    miles = radius_km / KM_PER_MILE
    return f"{miles:.0f} miles ({radius_km:.0f} km)" if abs(miles - round(miles)) < 0.05 else f"{radius_km:g} km"


def stay_kinds_label(kinds: Sequence[str] | None) -> str:
    """Plain-language list of stay types, or the generic phrase when every type is included."""
    allowed = [STAY_KIND_PLURALS[kind] for kind in STAY_KINDS if not kinds or kind in kinds]
    if not allowed or len(allowed) == len(STAY_KINDS):
        return "places to stay"
    if len(allowed) == 1:
        return allowed[0]
    return f"{', '.join(allowed[:-1])} or {allowed[-1]}"


@dataclass
class Night:
    night: int
    target_km: float
    end_km: float
    point: TrackPoint
    stay: Optional[RestStay]
    alternatives: list[RestStay]
    nearest: list[RestStay]
    note: Optional[str]


def place_rest_stops(points: Sequence[TrackPoint], cum: Sequence[float], goals: Sequence[float],
                     stays_near: StaysNear, radius_km: float, stay_kinds: Sequence[str] | None = None) -> list[Night]:
    """End each day where its goal is reached, moved to the best nearby place to stay.

    Days are anchored to where the previous day actually ended, so a stay chosen a little
    early or late does not shift every later day. The best stay balances how far it moves
    the day's end against how far it sits off the route.
    """
    allowed = set(stay_kinds or STAY_KINDS)
    wanted = stay_kinds_label(allowed)
    total = cum[-1]
    nights: list[Night] = []
    anchor = 0.0
    for index, goal in enumerate(goals[:-1]):
        target = anchor + goal
        if target >= total - MIN_FINAL_KM:
            break
        ideal = point_at(points, cum, target)
        found = stays_near(ideal[0], ideal[1])
        scored: list[tuple[float, RestStay, float]] = []
        further: list[tuple[float, RestStay]] = []
        lo, hi = anchor + MIN_DAY_KM, total - MIN_FINAL_KM
        search = max(radius_km * 2, 8.0)
        for place in found or ():
            if place.kind not in allowed:
                continue
            straight = distance_km(ideal[0], ideal[1], place.lat, place.lon)
            along, off = project(points, cum, place.lat, place.lon, max(lo, target - 2 * search), min(hi, target + 2 * search))
            stay = RestStay(**place.model_dump(), distance_km=round(straight, 2), off_route_km=round(off, 2))
            if straight > radius_km:
                further.append((straight, stay))
                continue
            unnamed = UNNAMED_PENALTY_KM if place.name.startswith("Unnamed ") else 0.0
            scored.append((abs(along - target) + 1.5 * off + unnamed, stay, along))
        scored.sort(key=lambda item: item[0])
        further.sort(key=lambda item: item[0])
        nearest = [item[1] for item in further[:MAX_NEAREST]]
        night = index + 1
        if scored:
            _, stay, along = scored[0]
            nights.append(Night(night, target, along, point_at(points, cum, along), stay, [item[1] for item in scored[1:6]], [], None))
            anchor = along
            continue
        if found is None:
            note = "Could not check for places to stay here because the OpenStreetMap search did not respond. Try again shortly."
        elif nearest:
            note = (f"No mapped {wanted} within {radius_label(radius_km)} of where day {night} reaches its goal. "
                    "The closest mapped places are listed so you can add one to the journey.")
        else:
            note = (f"No mapped {wanted} within {radius_label(radius_km)} of where day {night} reaches its goal. "
                    "Change this day's goal, widen the search, or choose another route.")
        nights.append(Night(night, target, target, ideal, None, [], nearest, note))
        anchor = target
    return nights


def _route_point(point: TrackPoint, name: Optional[str] = None) -> RoutePoint:
    elevation = None if point[2] is None else round(max(-500.0, min(9000.0, point[2])), 1)
    return RoutePoint(lat=round(point[0], 6), lon=round(point[1], 6), elevation=elevation, name=name)


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def build_option(*, option_id: str, label: str, description: str, points: Sequence[TrackPoint],
                 night_cuts: Sequence[float], nights: Sequence[Night], path_included: bool,
                 start_name: str, finish_name: str, poi_marks: Sequence[tuple[str, float]],
                 goals: Sequence[float], mode: Mode, pace: Pace, start_date: date) -> RouteOption:
    cum = cumulative_km(points)
    total = cum[-1]
    pieces = cut(points, cum, night_cuts)
    stop_names = [night.stay.name if night.stay else f"Night {night.night} stop (km {night.target_km:.1f})" for night in nights]
    stages: list[Stage] = []
    levels: list[int] = []
    day_stats: list[Optional[ElevationStats]] = []
    steep_days: list[int] = []
    start_km = 0.0
    for day, piece in enumerate(pieces, start=1):
        piece_cum = cumulative_km(piece)
        km = piece_cum[-1]
        stats = elevation_stats(piece)
        steepest = None if stats is None else max(stats.steepest_climb_pct, stats.steepest_descent_pct)
        level = rate_day(mode, km, None if stats is None else stats.ascent_m, steepest)
        levels.append(level)
        if is_steep(mode, steepest):
            steep_days.append(day)
        day_stats.append(stats)
        named = {0: start_name if day == 1 else stop_names[day - 2],
                 len(piece) - 1: finish_name if day == len(pieces) else stop_names[day - 1]}
        for name, at_km in poi_marks:
            if name not in named.values() and start_km - 1e-6 <= at_km <= start_km + km + 1e-6:
                nearest = min(range(len(piece)), key=lambda i: abs(piece_cum[i] - (at_km - start_km)))
                named.setdefault(nearest, name)
        kept = simplify(piece, 4.0, set(named))
        stages.append(Stage(
            day=day,
            date=start_date + timedelta(days=day - 1),
            points=[_route_point(piece[i], named.get(i)) for i in kept],
            distance_km=round(km, 2),
            ascent_m=None if stats is None else round(stats.ascent_m),
            descent_m=None if stats is None else round(stats.descent_m),
            walking_hours=round(moving_hours(mode, pace, km, None if stats is None else stats.ascent_m), 2),
            start_km=round(start_km, 2),
            end_km=round(start_km + km, 2),
            steepest_climb_pct=None if stats is None else round(stats.steepest_climb_pct, 1),
            steepest_descent_pct=None if stats is None else round(stats.steepest_descent_pct, 1),
            difficulty=DIFFICULTIES[level],
            goal_km=goals[day - 1] if day <= len(goals) else None,
        ))
        start_km += km

    known = all(stats is not None for stats in day_stats)
    overall = elevation_stats(points) if known else None
    ascent = sum(stage.ascent_m for stage in stages) if known else None
    descent = sum(stage.descent_m for stage in stages) if known else None
    plan = Plan(stages=stages, distance_km=round(total, 2), ascent_m=ascent, descent_m=descent,
                walking_hours=round(sum(stage.walking_hours for stage in stages), 2), elevation_known=known)

    hardest = max(range(len(stages)), key=lambda i: (levels[i], stages[i].distance_km + (stages[i].ascent_m or 0) / 100))
    hard = stages[hardest]
    climb = "" if hard.ascent_m is None else f" with {hard.ascent_m:,.0f} m of climbing"
    notes = [f"Hardest day: day {hard.day}, {hard.distance_km:.1f} km{climb}." if len(stages) > 1 else f"{hard.distance_km:.1f} km{climb}."]
    if overall is not None:
        steepest = max(overall.steepest_climb_pct, overall.steepest_descent_pct)
        direction = "climb" if overall.steepest_climb_pct >= overall.steepest_descent_pct else "descent"
        notes.append(f"Steepest sustained {direction}: {steepest:.0f}% over about 200 m.")
        if steep_days:
            days = ("day " if len(steep_days) == 1 else "days ") + ", ".join(str(day) for day in steep_days)
            notes.append(f"Grades of {STEEP_GRADE[mode]:.0f}% or more raise the rating of {days} by one level."
                         if len(stages) > 1 else f"Grades of {STEEP_GRADE[mode]:.0f}% or more raise the rating by one level.")
    else:
        notes.append("Elevation unavailable, so the rating uses distance only.")

    rest_stops = []
    for night, cut_km in zip(nights, night_cuts):
        end = point_at(points, cum, cut_km)
        rest_stops.append(RestStop(
            night=night.night, target_km=round(night.target_km, 2), end_km=round(cut_km, 2),
            lat=round(end[0], 6), lon=round(end[1], 6), name=stop_names[night.night - 1],
            stay=night.stay, alternatives=night.alternatives, nearest=night.nearest,
            path_included=path_included and night.stay is not None, note=night.note,
        ))

    goal_total = sum(goals)
    over = total - goal_total
    unused = max(0, len(goals) - len(stages))
    goal_note = None
    if over > 0.5:
        goal_note = (f"This route is {total:.1f} km, {over:.1f} km more than your daily goals add up to "
                     f"({goal_total:g} km), so the last day runs long.")
    elif unused:
        goal_note = (f"This route reaches the finish on day {len(stages)}, so {_plural(unused, 'planned day')} "
                     f"{'is' if unused == 1 else 'are'} not needed.")

    return RouteOption(
        id=option_id, label=label, description=description,
        distance_km=round(total, 2), moving_hours=plan.walking_hours,
        ascent_m=ascent, descent_m=descent,
        max_elevation_m=None if overall is None else round(overall.max_m),
        steepest_climb_pct=None if overall is None else round(overall.steepest_climb_pct, 1),
        steepest_descent_pct=None if overall is None else round(overall.steepest_descent_pct, 1),
        steep_share_pct=None if overall is None else round(overall.steep_share_pct, 1),
        difficulty=DIFFICULTIES[max(levels)], difficulty_notes=notes,
        profile=[] if overall is None else overall.profile,
        plan=plan, rest_stops=rest_stops,
        goal_km=goal_total, over_goal_km=round(max(0.0, over), 2), unused_days=unused, goal_note=goal_note,
    )
