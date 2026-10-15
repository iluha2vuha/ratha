import { PACE_KMH, formatMiles, formatPace, milesFromKm, recommendedDays } from "../planner";
import type { RouteMode } from "../api";
import type { Pace } from "../sampleData";

export type GoalKind = "miles" | "hours";

function travelWord(mode: RouteMode) {
  return mode === "cycling" ? "riding" : "walking";
}

function paceWord(pace: Pace) {
  return pace === "easy" ? "an easy" : pace === "hard" ? "a fast" : "a steady";
}

export function GoalEstimate({ coverKm, source, notice, loading, error, mode, pace, goalKind, days, hoursGoal, dailyKm, onApplyDays, onApplyMiles }: {
  coverKm: number | null;
  source: "route" | "estimate" | "track" | null;
  notice?: string;
  loading: boolean;
  error: string;
  mode: RouteMode;
  pace: Pace;
  goalKind: GoalKind;
  days: number;
  hoursGoal: number;
  dailyKm: number;
  onApplyDays: (days: number) => void;
  onApplyMiles: (miles: number) => void;
}) {
  if (loading) return <div className="trip-estimate" role="status"><p>Estimating the distance…</p></div>;
  if (error) return <div className="trip-estimate"><p className="weather-unavailable">{error}</p></div>;
  if (coverKm === null || coverKm < 0.05) return null;

  const heading = source === "route" ? "This route is" : source === "track" ? "This track is" : "Rough estimate:";
  const hoursKm = hoursGoal * PACE_KMH[mode][pace];
  const daysFromHours = recommendedDays(coverKm, hoursKm);
  const milesADay = days > 0 ? milesFromKm(coverKm / days) : 0;
  const daysFromMiles = recommendedDays(coverKm, dailyKm);
  const canApplyDays = goalKind === "hours" && daysFromHours !== days;
  const canApplyMiles = goalKind === "miles" && Math.abs(milesFromKm(dailyKm) - milesADay) >= 0.4;

  return (
    <div className="trip-estimate" role="status">
      <p><strong>{heading} about {formatMiles(coverKm)} ({coverKm.toFixed(coverKm >= 10 ? 0 : 1)} km)</strong></p>
      {source === "estimate" && notice ? <p className="quiet">{notice}</p> : null}
      {source === "track" ? <p className="quiet">Distance along your imported track. Days and rest stops still use the goals below.</p> : null}
      {goalKind === "hours" ? (
        <p>
          At {hoursGoal} {hoursGoal === 1 ? "hour" : "hours"} a day and {paceWord(pace)} {travelWord(mode)} pace ({formatPace(mode, pace)}),
          that is about {formatMiles(hoursKm)} a day.
          {coverKm > 0 ? ` We estimate ${daysFromHours} ${daysFromHours === 1 ? "day" : "days"} to cover it.` : ""}
        </p>
      ) : (
        <p>
          To cover about {formatMiles(coverKm)} in {days} {days === 1 ? "day" : "days"}, we recommend about {formatMiles(coverKm / days)} a day.
          {daysFromMiles !== days ? ` At your current ${formatMiles(dailyKm)} a day, that is about ${daysFromMiles} ${daysFromMiles === 1 ? "day" : "days"}.` : ""}
        </p>
      )}
      {canApplyDays ? (
        <button type="button" className="button secondary" onClick={() => onApplyDays(daysFromHours)}>
          Use {daysFromHours} {daysFromHours === 1 ? "day" : "days"}
        </button>
      ) : null}
      {canApplyMiles ? (
        <button type="button" className="button secondary" onClick={() => onApplyMiles(Math.round(milesADay * 2) / 2)}>
          Use {formatMiles(coverKm / days)} a day
        </button>
      ) : null}
    </div>
  );
}
