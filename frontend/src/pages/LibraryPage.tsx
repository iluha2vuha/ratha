import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSavedRoutes, putSavedRoute, type SavedRoute } from "../api";
import { useAuth } from "../auth";
import { getOfflineRoutes, saveOfflineRoute, type OfflineSavedRoute } from "../offlineRoutes";
import { exportRoute } from "../planner";

function saveTime(value: number) {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function LibraryPage() {
  const { user } = useAuth();
  const [routes, setRoutes] = useState<OfflineSavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      if (user) {
        try {
          const remote = await getSavedRoutes();
          for (const route of remote) await saveOfflineRoute(route, true);
        } catch {
          setMessage("Could not reach your account library. Showing routes saved on this device.");
        }
      }
      setRoutes(await getOfflineRoutes());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open offline route storage.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function syncDeviceRoutes() {
    if (!user) return;
    setSyncing(true);
    setMessage("");
    try {
      const local = await getOfflineRoutes();
      const unsynced = local.filter((route) => !route.synced);
      for (const route of unsynced) {
        const remote: SavedRoute = await putSavedRoute(route);
        await saveOfflineRoute(remote, true);
      }
      await refresh();
      setMessage(unsynced.length ? "Device routes synced to your account." : "Your account library is up to date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync routes. They remain saved on this device.");
      setRoutes(await getOfflineRoutes());
    } finally {
      setSyncing(false);
    }
  }

  const pendingSync = routes.some((route) => !route.synced);

  return (
    <div className="page library-page">
      <header className="library-header">
        <p className="eyebrow">Your trips</p>
        <h1>Route library</h1>
        <p className="quiet">Routes in this library are stored on this device for offline viewing. Sign in to keep a copy in your account too.</p>
        <div className="library-actions">
          {user && pendingSync ? <button className="button" type="button" onClick={() => void syncDeviceRoutes()} disabled={syncing}>{syncing ? "Syncing…" : "Sync device routes"}</button> : null}
          <button className="button secondary" type="button" onClick={() => void refresh()} disabled={loading}>Refresh library</button>
        </div>
        {message ? <p className="form-status" role="status">{message}</p> : null}
      </header>
      {loading ? <p role="status">Loading your routes…</p> : null}
      {!loading && routes.length === 0 ? (
        <section className="library-empty card">
          <h2>No saved routes yet</h2>
          <p>Plan a route, build its day-by-day itinerary, then choose “Save to library” to keep it on this device.</p>
          <Link className="button" to="/plan">Plan a route</Link>
        </section>
      ) : null}
      <div className="library-list">
        {routes.map((route) => (
          <article className="library-route card" key={route.id}>
            <div>
              <p className="eyebrow">{route.synced ? "Saved on this device · synced to account" : "Saved on this device"}</p>
              <h2>{route.name}</h2>
              <p>{route.plan.distance_km.toFixed(1)} km · {route.plan.stages.length} {route.plan.stages.length === 1 ? "day" : "days"} · Saved {saveTime(route.offline_saved_at)}</p>
            </div>
            <div className="library-route-actions">
              <Link className="button" to={"/library/" + encodeURIComponent(route.id)}>Open route</Link>
              <button className="button secondary" type="button" onClick={() => exportRoute(route.points, route.name)}>Download GPX</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
