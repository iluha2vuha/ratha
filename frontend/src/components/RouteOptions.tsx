import type { RouteOption } from "../api";
import { formatHours } from "../planner";

function ElevationProfile({ profile }: { profile: [number, number][] }) {
  if (profile.length < 2) return <p className="route-option-profile-missing">Elevation unavailable</p>;
  const distance = profile[profile.length - 1][0] || 1;
  const heights = profile.map(([, height]) => height);
  const low = Math.min(...heights);
  const span = Math.max(Math.max(...heights) - low, 50);
  const points = profile.map(([km, height]) => `${(km / distance) * 200},${46 - ((height - low) / span) * 42}`);
  return (
    <svg className="route-option-profile" viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,48 ${points.join(" ")} 200,48`} />
      <polyline points={points.join(" ")} />
    </svg>
  );
}

function grades(option: RouteOption) {
  if (option.ascent_m === null) return "Elevation unavailable";
  const parts = [`↑ ${Math.round(option.ascent_m).toLocaleString("en-GB")} m`, `↓ ${Math.round(option.descent_m ?? 0).toLocaleString("en-GB")} m`];
  if (option.steepest_climb_pct !== null) parts.push(`steepest climb ${Math.round(option.steepest_climb_pct)}%`);
  if (option.steepest_descent_pct !== null) parts.push(`steepest descent ${Math.round(option.steepest_descent_pct)}%`);
  return parts.join(" · ");
}

function staysSummary(option: RouteOption) {
  const missing = option.rest_stops.filter(stop => !stop.stay).map(stop => stop.night);
  if (!option.rest_stops.length) return { ok: true, text: "No overnight stops needed" };
  if (!missing.length) return { ok: true, text: option.rest_stops.length === 1 ? "A place to stay found for the night" : "Places to stay found for every night" };
  return { ok: false, text: `No place to stay found for night ${missing.join(", ")}` };
}

export function RouteOptions({ options, selectedId, onSelect }: { options: RouteOption[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ul className="route-option-list">
      {options.map(option => {
        const stays = staysSummary(option);
        const days = option.plan.stages.length;
        return (
          <li key={option.id}>
            <button type="button" className="route-option" aria-pressed={option.id === selectedId} onClick={() => onSelect(option.id)}>
              <span className="route-option-head">
                <strong>{option.label}</strong>
                <span className={`difficulty-tag is-${option.difficulty.toLowerCase()}`}>{option.difficulty}</span>
              </span>
              <span className="route-option-facts">
                {option.distance_km.toFixed(1)} km · {days} {days === 1 ? "day" : "days"} · {formatHours(option.moving_hours)} moving
              </span>
              <span className="route-option-facts">{grades(option)}</span>
              <ElevationProfile profile={option.profile} />
              <span className={stays.ok ? "route-option-status" : "route-option-status is-warning"}>{stays.text}</span>
              <span className={option.goal_note ? "route-option-status is-warning" : "route-option-status"}>
                {option.over_goal_km > 0.5 ? `${option.over_goal_km.toFixed(1)} km longer than your daily goals`
                  : option.unused_days ? `Finishes in ${days} ${days === 1 ? "day" : "days"}` : "Fits your daily goals"}
              </span>
              <span className="route-option-description">{option.description}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
