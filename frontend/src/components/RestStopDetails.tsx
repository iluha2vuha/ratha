import type { RestStay, RestStop } from "../api";
import { formatMiles, radiusLabel } from "../planner";

function distanceFromRoute(stay: RestStay, included: boolean) {
  if (stay.off_route_km < 0.1) return "On the route.";
  const away = `${stay.off_route_km.toFixed(1)} km from the route`;
  return included ? `${away}; the day's route includes the path there.` : `${away}; the detour is not included in the day's distance.`;
}

export function RestStopDetails({ stop, radiusKm, addedStayIds = [], addingStayId = null, placesFull = false, onAddStay }: {
  stop: RestStop;
  radiusKm: number;
  addedStayIds?: string[];
  addingStayId?: string | null;
  placesFull?: boolean;
  onAddStay?: (stay: RestStay) => void;
}) {
  const stay = stop.stay;
  return (
    <section className="rest-stop">
      <h4>Night {stop.night} rest stop</h4>
      {stay ? (
        <>
          <p className="rest-stop-name"><strong>{stay.name}</strong><span>{stay.kind_label}</span></p>
          <p className="quiet">
            {distanceFromRoute(stay, stop.path_included)} Your goal for this day is reached at km {stop.target_km.toFixed(1)}; this stop is{" "}
            {stay.distance_km.toFixed(1)} km from there in a straight line.
          </p>
          <ul className="rest-stop-facts">
            {stay.address ? <li>{stay.address}</li> : null}
            {stay.fee ? <li>Fee: {stay.fee}</li> : null}
            {stay.opening_hours ? <li>Hours: {stay.opening_hours}</li> : null}
            {stay.phone ? <li><a href={`tel:${stay.phone}`}>{stay.phone}</a></li> : null}
            {stay.website ? <li><a href={stay.website} target="_blank" rel="noreferrer">Website</a></li> : null}
            <li><a href={stay.osm_url} target="_blank" rel="noreferrer">View on OpenStreetMap</a></li>
          </ul>
        </>
      ) : (
        <p className="rest-stop-warning" role="note">{stop.note}</p>
      )}
      {!stay && (stop.nearest ?? []).length ? (
        <>
          <p className="quiet">Closest mapped places for night {stop.night}. Adding one includes it as a place to visit and plans the route through it.</p>
          <ul className="stay-gap-list">
            {(stop.nearest ?? []).map(place => {
              const added = addedStayIds.includes(place.id);
              return <li key={place.id}>
                <div>
                  <strong>{place.name}</strong>
                  <span>{place.kind_label} · {formatMiles(place.distance_km)} from where this day ends</span>
                </div>
                {onAddStay ? <button type="button" className="button secondary" disabled={added || placesFull || addingStayId !== null} onClick={() => onAddStay(place)}>
                  {added ? 'Added to journey' : addingStayId === place.id ? 'Adding…' : 'Add to journey'}
                </button> : null}
              </li>;
            })}
          </ul>
          {placesFull ? <p className="quiet">You already have 10 places to visit. Remove one if you want to add a stay.</p> : null}
        </>
      ) : null}
      {stop.alternatives.length ? (
        <details>
          <summary>{stop.alternatives.length} other {stop.alternatives.length === 1 ? "place" : "places"} within {radiusLabel(radiusKm)}</summary>
          <ul className="rest-stop-alternatives">
            {stop.alternatives.map(place => (
              <li key={place.id}>
                <a href={place.osm_url} target="_blank" rel="noreferrer">{place.name}</a>
                <span>{place.kind_label} · {place.distance_km.toFixed(1)} km from where the goal is reached · {place.off_route_km.toFixed(1)} km off the route</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="overnight-note">Places to stay from OpenStreetMap; listings can be incomplete or out of date. Check access, opening and booking before you travel.</p>
    </section>
  );
}
