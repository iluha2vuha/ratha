import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MapView } from "../components/MapView";
import { RouteOverview } from "../components/RouteOverview";
import { getOfflineRoute, type OfflineSavedRoute } from "../offlineRoutes";
import type { WildCampTripStop } from "../sampleData";

export function MapPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedRouteId = searchParams.get("route");
  const [savedRoute, setSavedRoute] = useState<OfflineSavedRoute | null>(null);
  const [savedRouteError, setSavedRouteError] = useState("");
  const [selectedDay, setSelectedDay] = useState(1);

  useEffect(() => {
    let active = true;
    setSavedRoute(null);
    setSavedRouteError("");
    setSelectedDay(1);
    if (!savedRouteId) return () => { active = false; };
    getOfflineRoute(savedRouteId).then((route) => {
      if (!active) return;
      if (!route) setSavedRouteError("This route is not saved on this device. Open it from your library while online first.");
      else setSavedRoute(route);
    }).catch(() => {
      if (active) setSavedRouteError("Could not load the saved route from this device.");
    });
    return () => { active = false; };
  }, [savedRouteId]);

  function saveWildCampToTrip(stop: WildCampTripStop) {
    navigate("/plan", { state: { start: "", finish: "", days: 2, wildCampStop: stop } });
  }

  return (
    <section className="map-page">
      <MapView plan={savedRoute?.plan ?? null} selectedDay={selectedDay} fitAllStages={Boolean(savedRoute)} showNavigationControls={false} onSaveToTrip={saveWildCampToTrip} />
      {savedRoute ? (
        <>
          <div className="map-saved-route-banner">
            <div><p className="eyebrow">Saved route · interactive map</p><strong>{savedRoute.name}</strong></div>
            <Link className="text-link" to={`/library/${encodeURIComponent(savedRoute.id)}`}>Route details</Link>
            <button className="icon-button" type="button" aria-label="Close saved route" onClick={() => setSearchParams({}, { replace: true })}>×</button>
          </div>
          <RouteOverview plan={savedRoute.plan} selected={selectedDay} onSelect={setSelectedDay} />
        </>
      ) : null}
      {savedRouteError ? <p className="map-saved-route-error" role="status">{savedRouteError}</p> : null}

    </section>
  );
}
