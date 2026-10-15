import type { RoutePoint } from '../planner';

export type WeatherWarning = { code: string; severity: 'caution' | 'severe'; message: string; location: RoutePoint; locations: RoutePoint[] };
export type WeatherDay = { day: number; date: string; status: 'available' | 'unavailable'; reason?: string;
  temperature_min?: number; temperature_max?: number; precipitation_mm?: number; wind_kmh?: number; gust_kmh?: number;
  snowfall_cm?: number; weather_codes?: number[]; warnings?: WeatherWarning[]; samples?: { location: RoutePoint; values: Record<string, number> }[] };
export type RouteWeather = { days: WeatherDay[]; source: string; source_url: string; checked_at: string; notice: string };

function condition(code: number) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if ([56, 57, 66, 67].includes(code)) return 'Freezing precipitation';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if (code >= 95) return 'Thunderstorms';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 80, 81, 82].includes(code)) return 'Rain';
  return 'Variable conditions';
}

export function StageWeather({ day, loading, error }: { day?: WeatherDay; loading: boolean; error: string }) {
  if (loading) return <div className="stage-weather" role="status">Loading route forecast…</div>;
  if (error) return <div className="stage-weather weather-unavailable">Forecast unavailable: {error}</div>;
  if (!day || day.status === 'unavailable') return <div className="stage-weather weather-unavailable">{day?.reason ?? 'No forecast available.'}</div>;
  const warnings = day.warnings ?? [];
  const descriptions = [...new Set((day.weather_codes ?? []).map(condition))];
  return <div className="stage-weather">
    <h4>Daily weather · {descriptions.join(' / ')}</h4>
    <dl className="weather-values"><div><dt>Temperature</dt><dd>{day.temperature_min?.toFixed(0)}–{day.temperature_max?.toFixed(0)}°C</dd></div><div><dt>Precipitation</dt><dd>{day.precipitation_mm?.toFixed(1)} mm</dd></div><div><dt>Wind / gusts</dt><dd>{day.wind_kmh?.toFixed(0)} / {day.gust_kmh?.toFixed(0)} km/h</dd></div></dl>
    {warnings.length ? <ul className="weather-warnings">{warnings.map(w => <li className={`weather-warning ${w.severity}`} key={w.code}><strong>{w.severity === 'severe' ? 'Severe conditions' : 'Caution'}</strong><span>{w.message}</span><small>Near {w.location.lat.toFixed(4)}, {w.location.lon.toFixed(4)}{w.location.elevation === null ? '' : ` · ${Math.round(w.location.elevation)} m`}{w.locations.length > 1 ? ` · ${w.locations.length} affected samples` : ''}</small></li>)}</ul> : <p>No warning thresholds reached at sampled points.</p>}
    <details><summary>Forecast samples ({day.samples?.length ?? 0})</summary><ul className="weather-samples">{day.samples?.map((sample, i) => <li key={i}>{sample.location.lat.toFixed(4)}, {sample.location.lon.toFixed(4)} · {sample.values.temperature_2m_min.toFixed(0)}–{sample.values.temperature_2m_max.toFixed(0)}°C · gusts {sample.values.wind_gusts_10m_max.toFixed(0)} km/h · {sample.values.precipitation_sum.toFixed(1)} mm</li>)}</ul></details>
  </div>;
}
