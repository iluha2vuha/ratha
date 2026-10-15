import { Capacitor, CapacitorHttp, type HttpResponse } from "@capacitor/core";
import type { RouteWeather } from "./components/StageWeather";
import type { Plan, RoutePoint } from "./planner";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

export type Settings = {
  display_name: string;
  home_area: string;
  distance_unit: "km" | "mi";
  elevation_unit: "m" | "ft";
  map_style: "terrain" | "paper" | "satellite";
  trip_reminders: boolean;
  friend_activity: boolean;
  profile_visibility: "public" | "friends" | "private";
};

export type RouteMode = "hiking" | "cycling";

export type RatedStay = {
  id: string;
  name: string;
  type: "bothy" | "campsite" | "hostel" | "hotel";
  lat: number;
  lon: number;
  distance_km: number;
  rating: number | null;
  review_count: number;
  address: string | null;
  google_maps_url: string | null;
};

export type SavedRoute = {
  id: string;
  name: string;
  points: RoutePoint[];
  plan: Plan;
  generated: Record<string, unknown> | null;
  saved_at: number;
};

export const defaultSettings: Settings = {
  display_name: "",
  home_area: "",
  distance_unit: "km",
  elevation_unit: "m",
  map_style: "terrain",
  trip_reminders: true,
  friend_activity: false,
  profile_visibility: "friends",
};

// The Android app has no dev-server proxy, and the WebView would treat the API
// as a third-party site and drop the session cookie, so requests go through
// native HTTP, which shares the WebView cookie store.
async function nativeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { signal } = init;
  signal?.throwIfAborted();
  const pending = CapacitorHttp.request({
    url,
    method: init.method ?? "GET",
    headers: init.headers as Record<string, string> | undefined,
    data: init.body ?? undefined,
  });
  const result = await new Promise<HttpResponse>((resolve, reject) => {
    const abort = () => reject(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
  });
  const { status, data } = result;
  const body = status === 204 || data === null || data === undefined || data === "" ? null
    : typeof data === "string" ? data : JSON.stringify(data);
  return new Response(body, { status });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiBaseUrl + path;
  const response = Capacitor.isNativePlatform() ? await nativeFetch(url, init) : await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item: { msg: string }) => item.msg).join("; ") : `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getHealth() {
  return request<{ status: string }>("/api/health");
}

export function getSettings() {
  return request<Settings>("/api/settings");
}

export function updateSettings(settings: Settings) {
  return request<Settings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function getRouteWeather(plan: Plan, signal?: AbortSignal) {
  return request<RouteWeather>("/api/weather", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stages: plan.stages.map(({ day, date, points }) => ({ day, date, points })) }), signal });
}

export type AmenityKind = "food" | "shop" | "water" | "toilets" | "health" | "cash" | "post" | "transport" | "bike";

export type StayPlace = {
  id: string;
  name: string;
  kind: "campsite" | "bothy" | "hostel" | "hotel" | "guest_house" | AmenityKind;
  kind_label: string;
  lat: number;
  lon: number;
  address: string | null;
  description: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  fee: string | null;
  capacity: string | null;
  stars: string | null;
  operator: string | null;
  osm_url: string;
};

export function getPlaces(
  bounds: { south: number; west: number; north: number; east: number },
  signal?: AbortSignal,
  group: "stays" | "facilities" = "stays",
) {
  const params = new URLSearchParams({
    south: String(bounds.south),
    west: String(bounds.west),
    north: String(bounds.north),
    east: String(bounds.east),
    group,
  });
  return request<{ places: StayPlace[]; attribution: string }>(`/api/places?${params}`, { signal });
}

export function getRatedStays(near: { endpoint: string } | { lat: number; lon: number }, signal?: AbortSignal) {
  const params = new URLSearchParams("endpoint" in near ? { endpoint: near.endpoint } : { lat: String(near.lat), lon: String(near.lon) });
  return request<{ endpoint: string | null; lat: number; lon: number; stays: RatedStay[]; attribution: string }>(`/api/stays/nearby?${params}`, { signal });
}

export type NamedPoint = { name: string; lat: number; lon: number };
export type RestStay = StayPlace & { distance_km: number; off_route_km: number };
export type RestStop = {
  night: number;
  target_km: number;
  end_km: number;
  lat: number;
  lon: number;
  name: string;
  stay: RestStay | null;
  alternatives: RestStay[];
  nearest: RestStay[];
  path_included: boolean;
  note: string | null;
};
export type Difficulty = "Easy" | "Moderate" | "Challenging" | "Strenuous";
export type RouteOption = {
  id: string;
  label: string;
  description: string;
  distance_km: number;
  moving_hours: number;
  ascent_m: number | null;
  descent_m: number | null;
  max_elevation_m: number | null;
  steepest_climb_pct: number | null;
  steepest_descent_pct: number | null;
  steep_share_pct: number | null;
  difficulty: Difficulty;
  difficulty_notes: string[];
  profile: [number, number][];
  plan: Plan;
  rest_stops: RestStop[];
  goal_km: number;
  over_goal_km: number;
  unused_days: number;
  goal_note: string | null;
};
export type StayKind = "campsite" | "bothy" | "hostel" | "hotel" | "guest_house";
export type TripPlan = {
  name: string;
  mode: RouteMode;
  start: NamedPoint;
  finish: NamedPoint;
  points_of_interest: NamedPoint[];
  daily_km: number[];
  stay_radius_km: number;
  stay_kinds: StayKind[];
  options: RouteOption[];
  notices: string[];
  attribution: string;
};
export type TripSettings = { mode: RouteMode; daily_km: number[]; start_date: string; pace: "easy" | "steady" | "hard"; stay_radius_km: number; stay_kinds: StayKind[] };
export type VisitPlace = string | NamedPoint;
export type DistanceEstimate = {
  start: NamedPoint;
  finish: NamedPoint;
  points_of_interest: NamedPoint[];
  straight_km: number;
  estimated_km: number;
  path_allowance: number;
  notice: string;
};

export function estimateTrip(input: { start: string; finish: string; points_of_interest: VisitPlace[]; keep_order: boolean; mode: RouteMode }, signal?: AbortSignal) {
  return request<DistanceEstimate>("/api/route/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

export function planTrip(input: TripSettings & { start: string; finish: string; points_of_interest: VisitPlace[]; keep_order: boolean }, signal?: AbortSignal) {
  return request<TripPlan>("/api/route/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

export function planTrack(input: TripSettings & { name: string; points: RoutePoint[] }, signal?: AbortSignal) {
  return request<TripPlan>("/api/route/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

export type RouteAmenity = StayPlace & { km: number; off_route_km: number };
export type NearbyAmenity = StayPlace & { distance_km: number };
export type RouteAmenities = {
  along_route: RouteAmenity[];
  near_stops: { night: number; amenities: NearbyAmenity[] }[];
  route_radius_km: number;
  stop_radius_km: number;
  attribution: string;
  notice: string;
};

export function getRouteAmenities(option: RouteOption, mode: RouteMode, signal?: AbortSignal) {
  return request<RouteAmenities>("/api/route/amenities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      line: option.plan.stages.flatMap(stage => stage.points.map(point => [point.lat, point.lon])),
      stops: option.rest_stops.map(stop => ({ night: stop.night, lat: stop.stay?.lat ?? stop.lat, lon: stop.stay?.lon ?? stop.lon })),
      mode,
    }),
    signal,
  });
}

export function getSavedRoutes(signal?: AbortSignal) {
  return request<SavedRoute[]>("/api/routes", { signal });
}

export function getSavedRoute(id: string, signal?: AbortSignal) {
  return request<SavedRoute>("/api/routes/" + encodeURIComponent(id), { signal });
}

export function putSavedRoute(route: SavedRoute, signal?: AbortSignal) {
  return request<SavedRoute>("/api/routes/" + encodeURIComponent(route.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: route.name, points: route.points, plan: route.plan, generated: route.generated }),
    signal,
  });
}

export function deleteSavedRoute(id: string) {
  return request<void>("/api/routes/" + encodeURIComponent(id), { method: "DELETE" });
}

export type AuthUser = { id: number; email: string; display_name: string };

export function getCurrentUser() {
  return request<AuthUser>("/api/auth/me");
}

export function registerAccount(input: { email: string; password: string; display_name: string }) {
  return request<AuthUser>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function loginAccount(input: { email: string; password: string }) {
  return request<AuthUser>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function logoutAccount() {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export type WildCampingSuitability = {
  latitude: number;
  longitude: number;
  locationName: string | null;
  score: number;
  category: "Poor" | "Moderate" | "Promising";
  positives: string[];
  cautions: string[];
  imageCount: number;
  sampledImages: {
    id: string;
    title: string;
    imageUrl: string | null;
    sourceUrl: string | null;
    credit: string | null;
    distanceKm: number | null;
    assessment: {
      score: number;
      category: "Poor" | "Moderate" | "Promising";
      positives: string[];
      cautions: string[];
    };
  }[];
  imageProvider: string;
  visionProvider: string;
  isDemo: boolean;
  disclaimer: string;
};

export type ResolvedWildCampPlace = {
  latitude: number;
  longitude: number;
  locationName: string;
};

export function getWildCampingSuitability(latitude: number, longitude: number) {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  return request<WildCampingSuitability>(`/api/campsites/suitability?${params}`);
}

export function resolveWildCampingPlace(place: string) {
  return request<ResolvedWildCampPlace>(`/api/campsites/resolve?place=${encodeURIComponent(place)}`);
}
