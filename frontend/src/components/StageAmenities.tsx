import type { AmenityKind, StayPlace } from "../api";
import { PlaceGlyph } from "./PlaceCard";

export const amenityGroups: { kind: AmenityKind; label: string }[] = [
  { kind: "shop", label: "Shops" },
  { kind: "food", label: "Food and drink" },
  { kind: "water", label: "Drinking water" },
  { kind: "toilets", label: "Toilets and showers" },
  { kind: "health", label: "Pharmacy and medical" },
  { kind: "cash", label: "Cash" },
  { kind: "post", label: "Post office" },
  { kind: "transport", label: "Transport" },
  { kind: "bike", label: "Bike shops and repairs" },
];

type Listed = StayPlace & { detail: string };

function displayName(place: StayPlace) {
  return place.name.startsWith("Unnamed ") ? place.kind_label : `${place.name} · ${place.kind_label.toLowerCase()}`;
}

function AmenityList({ heading, empty, places }: { heading: string; empty: string; places: Listed[] }) {
  const counts = amenityGroups.map(group => ({ ...group, count: places.filter(place => place.kind === group.kind).length })).filter(group => group.count);
  return (
    <div className="amenity-block">
      <h5>{heading}</h5>
      {places.length ? (
        <>
          <p className="amenity-counts">{counts.map(group => <span key={group.kind}><PlaceGlyph kind={group.kind} />{group.count} {group.label.toLowerCase()}</span>)}</p>
          <details>
            <summary>List {places.length === 1 ? "it" : `all ${places.length}`}</summary>
            <ul className="amenity-list">
              {places.map(place => (
                <li key={place.id}>
                  <a href={place.osm_url} target="_blank" rel="noreferrer">{displayName(place)}</a>
                  <span>{place.detail}{place.opening_hours ? ` · ${place.opening_hours}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : <p className="quiet">{empty}</p>}
    </div>
  );
}

export function StageAmenities({ along, near, night, routeRadiusKm, stopRadiusKm, loading, error }: {
  along: (StayPlace & { km: number; off_route_km: number })[];
  near: (StayPlace & { distance_km: number })[] | null;
  night: number | null;
  routeRadiusKm: number;
  stopRadiusKm: number;
  loading: boolean;
  error: string;
}) {
  if (loading) return <section className="stage-amenities" aria-live="polite"><h4>Shops and facilities</h4><p>Looking for shops and facilities along the route…</p></section>;
  if (error) return <section className="stage-amenities"><h4>Shops and facilities</h4><p className="weather-unavailable">{error}</p></section>;
  const metres = Math.round(routeRadiusKm * 1000);
  return (
    <section className="stage-amenities">
      <h4>Shops and facilities</h4>
      <AmenityList heading={`Along the way (within ${metres} m of the route)`} empty={`No mapped shops or facilities within ${metres} m of this day's route.`}
        places={along.map(place => ({ ...place, detail: `km ${place.km.toFixed(1)}${place.off_route_km >= 0.1 ? ` · ${place.off_route_km.toFixed(1)} km off the route` : ""}` }))} />
      {night !== null && near ? (
        <AmenityList heading={`Near night ${night} stop (within ${stopRadiusKm} km)`} empty={`No mapped shops or facilities within ${stopRadiusKm} km of tonight's stop.`}
          places={near.map(place => ({ ...place, detail: `${place.distance_km.toFixed(1)} km away` }))} />
      ) : null}
    </section>
  );
}
