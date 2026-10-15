import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSavedRoute } from "../api";
import { useAuth } from "../auth";
import { getOfflineRoute, saveOfflineRoute, type OfflineSavedRoute } from "../offlineRoutes";
import { exportRoute, exportStage, pointLabel, stageColors } from "../planner";

function OfflineTrack({ route }: { route: OfflineSavedRoute }) {
  const points = route.plan.stages.flatMap((stage) => stage.points);
  const middleLat = points.reduce((sum, point) => sum + point.lat, 0) / Math.max(1, points.length);
  const longitudeScale = Math.cos((middleLat * Math.PI) / 180);
  const projected = points.map((point) => ({ x: point.lon * longitudeScale, y: point.lat }));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 0.00001);
  const spanY = Math.max(maxY - minY, 0.00001);
  const width = 800;
  const height = 300;
  const padding = 28;
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = (point: { lat: number; lon: number }) => ({
    x: offsetX + (point.lon * longitudeScale - minX) * scale,
    y: height - offsetY - (point.lat - minY) * scale,
  });

  return (
    <svg className="offline-track" viewBox={"0 0 " + width + " " + height} role="img" aria-label={"Offline route line for " + route.name}>
      <title>Offline route line: {route.name}</title>
      {route.plan.stages.map((stage, index) => {
        const coords = stage.points.map(project);
        return <polyline key={stage.day} points={coords.map((point) => point.x + "," + point.y).join(" ")}
          fill="none" stroke={stageColors[index % stageColors.length]} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {points.length ? <>
        <circle cx={project(points[0]).x} cy={project(points[0]).y} r="8" className="offline-track-start" />
        <circle cx={project(points[points.length - 1]).x} cy={project(points[points.length - 1]).y} r="8" className="offline-track-finish" />
      </> : null}
    </svg>
  );
}

export function SavedRoutePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [route, setRoute] = useState<OfflineSavedRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setRoute(null);
    async function load() {
      try {
        const local = await getOfflineRoute(id).catch(() => undefined);
        if (local) {
          if (active) setRoute(local);
          return;
        }
        if (!user) throw new Error("No offline copy of this route is on this device. Open the library online while signed in to download it for offline use.");
        const remote = await getSavedRoute(id);
        const stored = await saveOfflineRoute(remote, true);
        if (active) setRoute(stored);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not open this saved route.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, user]);

  if (loading) return <div className="page"><p role="status">Opening saved route…</p></div>;
  if (error || !route) return <div className="page saved-route-page"><Link className="back-link" to="/library">Back to library</Link><p className="planner-notice" role="alert">{error || "Route unavailable."}</p></div>;

  const ascent = route.plan.ascent_m;
  return (
    <div className="page saved-route-page">
      <Link className="back-link" to="/library">Back to library</Link>
      <header className="saved-route-header">
        <p className="eyebrow">{route.synced ? "Available offline · synced to account" : "Available offline · this device"}</p>
        <h1>{route.name}</h1>
        <p>{route.plan.distance_km.toFixed(1)} km · {route.plan.stages.length} {route.plan.stages.length === 1 ? "day" : "days"} · {route.plan.walking_hours.toFixed(1)} hours</p>
        {ascent !== null ? <p>↑ {Math.round(ascent)} m total ascent</p> : <p className="quiet">Elevation data was unavailable when this itinerary was planned.</p>}
        <div className="library-actions">
          <Link className="button" to={`/?route=${encodeURIComponent(route.id)}`}>Open on interactive map</Link>
          <button className="button" type="button" onClick={() => exportRoute(route.points, route.name)}>Download full route GPX</button>
          <span className="quiet">The route and itinerary are stored on this device.</span>
        </div>
      </header>
      <section className="offline-map-panel" aria-label="Offline route overview">
        <h2>Route overview</h2>
        <p className="quiet">Schematic view from the saved track; no live map tiles are needed.</p>
        <OfflineTrack route={route} />
        <div className="offline-track-legend">
          <span><i className="offline-track-start" /> Start: {pointLabel(route.points[0])}</span>
          <span><i className="offline-track-finish" /> Finish: {pointLabel(route.points[route.points.length - 1])}</span>
        </div>
      </section>
      <section className="saved-stage-list">
        <h2>Day-by-day itinerary</h2>
        {route.plan.stages.map((stage, index) => (
          <article className="saved-stage card" key={stage.day} style={{ borderLeft: "4px solid " + stageColors[index % stageColors.length] }}>
            <h3>Day {stage.day} · {new Date(stage.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>
            <p>{stage.distance_km.toFixed(1)} km · {stage.walking_hours.toFixed(1)} hours{stage.ascent_m === null ? "" : " · ↑ " + Math.round(stage.ascent_m) + " m"}</p>
            <p>Start: {pointLabel(stage.points[0])} · Finish: {pointLabel(stage.points[stage.points.length - 1])}</p>
            <button className="button secondary" type="button" onClick={() => exportStage(stage)}>Download day {stage.day} GPX</button>
          </article>
        ))}
      </section>
    </div>
  );
}
