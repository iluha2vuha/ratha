import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type RoutePoint = { lat: number; lon: number; elevation: number | null; name?: string | null };
export type Stage = { day: number; date: string; points: RoutePoint[]; distance_km: number; ascent_m: number | null; walking_hours: number; start_km: number; end_km: number;
  descent_m?: number | null; steepest_climb_pct?: number | null; steepest_descent_pct?: number | null; difficulty?: string | null; goal_km?: number | null };
export type Plan = { stages: Stage[]; distance_km: number; ascent_m: number | null; walking_hours: number; elevation_known: boolean; descent_m?: number | null };
export const stageColors = ['#006400', '#C2185B', '#7B2CBF', '#C62828', '#8A7A00', '#5A9E00'];

export function parseGpx(text: string): { name: string; points: RoutePoint[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'gpx') throw new Error('Choose a valid GPX file.');
  const all = Array.from(doc.getElementsByTagName('*'));
  const tracks = all.filter(el => el.localName === 'trkseg');
  const routes = all.filter(el => el.localName === 'rte');
  const segments = tracks.filter(el => Array.from(el.children).some(child => child.localName === 'trkpt'));
  const groups = segments.length ? segments : routes;
  if (groups.length !== 1) throw new Error('Import one continuous track or route. Multiple segments could join across a gap.');
  const points = Array.from(groups[0].children).filter(el => el.localName === 'trkpt' || el.localName === 'rtept').map(el => {
    const child = (name: string) => Array.from(el.children).find(c => c.localName === name)?.textContent;
    const latText = el.getAttribute('lat');
    const lonText = el.getAttribute('lon');
    const eleText = child('ele');
    const point: RoutePoint = { lat: latText?.trim() ? Number(latText) : NaN, lon: lonText?.trim() ? Number(lonText) : NaN,
      elevation: eleText?.trim() ? Number(eleText) : null, name: child('name')?.trim() || null };
    if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180 ||
      (point.elevation !== null && !Number.isFinite(point.elevation))) throw new Error('GPX contains invalid coordinates or elevations.');
    return point;
  });
  if (points.length < 2 || points.length > 10000) throw new Error('Track must contain 2 to 10,000 points. Simplify larger files first.');
  const parent = groups[0].parentElement;
  const name = Array.from(parent?.children ?? []).find(el => el.localName === 'name')?.textContent?.trim() || 'Imported route';
  return { name, points };
}

export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function pointLabel(point: RoutePoint) {
  return point.name || `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
}

export const KM_PER_MILE = 1.609344;
export const PACE_KMH = { hiking: { easy: 3, steady: 4, hard: 5 }, cycling: { easy: 10, steady: 15, hard: 20 } } as const;
export const DEFAULT_MILES: Record<"hiking" | "cycling", number> = { hiking: 9, cycling: 31 };
export const DEFAULT_HOURS: Record<"hiking" | "cycling", number> = { hiking: 6, cycling: 4 };

export function milesFromKm(km: number) {
  return km / KM_PER_MILE;
}

export function kmFromMiles(miles: number) {
  return miles * KM_PER_MILE;
}

export function formatMiles(km: number) {
  const miles = milesFromKm(km);
  const rounded = miles >= 10 && Math.abs(miles - Math.round(miles)) < 0.05 ? Math.round(miles) : Math.round(miles * 10) / 10;
  return `${rounded} ${rounded === 1 ? "mile" : "miles"}`;
}

export function formatPace(mode: "hiking" | "cycling", pace: "easy" | "steady" | "hard") {
  const kmh = PACE_KMH[mode][pace];
  const mph = Math.round(milesFromKm(kmh) * 10) / 10;
  return `${kmh} km/h (${mph} mph)`;
}

export function trackDistanceKm(points: { lat: number; lon: number }[]) {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const lat1 = points[i - 1].lat * Math.PI / 180, lat2 = points[i].lat * Math.PI / 180;
    const dLat = lat2 - lat1, dLon = (points[i].lon - points[i - 1].lon) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    km += 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return km;
}

export function recommendedDays(distanceKm: number, dailyKm: number, maxDays = 14) {
  if (!(dailyKm > 0) || !(distanceKm > 0)) return 1;
  return Math.min(maxDays, Math.max(1, Math.ceil((distanceKm - 1e-6) / dailyKm)));
}

export function radiusLabel(km: number) {
  return `${Math.round(km / KM_PER_MILE)} miles (${Math.round(km)} km)`;
}

const stayKindPlurals: Record<string, string> = {
  campsite: "campsites",
  bothy: "bothies",
  hostel: "hostels",
  hotel: "hotels",
  guest_house: "guest houses",
};

export function stayKindsLabel(kinds: string[]) {
  const order = ["campsite", "bothy", "hostel", "hotel", "guest_house"].filter(kind => kinds.includes(kind)).map(kind => stayKindPlurals[kind]);
  if (!order.length || order.length === 5) return "places to stay";
  if (order.length === 1) return order[0];
  return `${order.slice(0, -1).join(", ")} or ${order[order.length - 1]}`;
}

export function formatHours(hours: number) {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 60 ? `${whole + 1} h` : whole ? `${whole} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`;
}

// Android WebViews ignore blob downloads, so the app hands the file to the share sheet instead.
async function saveGpx(xml: string, filename: string) {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: xml, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [uri] }).catch(() => undefined); // closing the share sheet rejects
    return;
  }
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportStage(stage: Stage) {
  const points = stage.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.elevation === null ? '' : `<ele>${p.elevation}</ele>`}</trkpt>`).join('');
  return saveGpx(`<?xml version="1.0"?><gpx version="1.1" creator="Ratha" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Day ${stage.day}</name><trkseg>${points}</trkseg></trk></gpx>`, `ratha-day-${stage.day}.gpx`);
}

export function exportRoute(points: RoutePoint[], name: string) {
  const entities: Record<string, string> = {
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  };
  const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (character) => entities[character] ?? character);
  const trackpoints = points.map((point) =>
    '<trkpt lat="' + point.lat + '" lon="' + point.lon + '">' +
    (point.elevation === null ? "" : "<ele>" + point.elevation + "</ele>") +
    "</trkpt>",
  ).join("");
  const xml = '<?xml version="1.0"?><gpx version="1.1" creator="Ratha" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' +
    escapeXml(name) + "</name><trkseg>" + trackpoints + "</trkseg></trk></gpx>";
  return saveGpx(xml, (name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "ratha-route") + ".gpx");
}

// Illustrative geometry for trying the planner; not a verified hiking trail.
export const demoPoints: RoutePoint[] = [
  { lat: 56.76, lon: -4.69, elevation: 400, name: 'Demo start' },
  { lat: 56.79, lon: -4.61, elevation: 520 },
  { lat: 56.83, lon: -4.56, elevation: 750 },
  { lat: 56.87, lon: -4.49, elevation: 430 },
  { lat: 56.9, lon: -4.4, elevation: 680 },
  { lat: 56.94, lon: -4.3, elevation: 370, name: 'Demo finish' },
];
