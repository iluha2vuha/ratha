import { useState, type FormEvent } from "react";
import { getRatedStays, type RatedStay } from "../api";

const typeLabels: Record<RatedStay["type"], string> = {
  bothy: "Bothy",
  campsite: "Campsite",
  hostel: "Hostel",
  hotel: "Hotel or B&B",
};

export function RatedStays({ day, endpointName, point, initialStays, initialNote, selectedId, onSelect }: {
  day: number;
  endpointName: string;
  point: { lat: number; lon: number };
  initialStays?: RatedStay[];
  initialNote?: string | null;
  selectedId?: string;
  onSelect: (stay: RatedStay | null) => void;
}) {
  const [endpoint, setEndpoint] = useState(endpointName);
  const [stays, setStays] = useState<RatedStay[] | null>(initialStays?.length ? initialStays : null);
  const [searchedNear, setSearchedNear] = useState(initialStays?.length ? endpointName : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialStays?.length ? "" : initialNote ?? "");

  async function search(event: FormEvent) {
    event.preventDefault();
    const name = endpoint.trim();
    setBusy(true); setError("");
    try {
      const result = await getRatedStays(name ? { endpoint: name } : point);
      setStays(result.stays);
      setSearchedNear(name || `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`);
    } catch (err) {
      setStays(null);
      setError(err instanceof Error ? err.message : "Could not load rated stays.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="overnight-stays rated-stays">
    <h4>Rated stays for night {day}</h4>
    <form className="rated-stays-search" onSubmit={search}>
      <label className="field">Daily endpoint
        <input value={endpoint} maxLength={160} onChange={event => setEndpoint(event.target.value)} placeholder="Leave blank to use the end of this stage" />
      </label>
      <button className="button secondary" type="submit" disabled={busy}>{busy ? "Searching…" : "Search rated stays"}</button>
    </form>
    {error ? <p className="weather-unavailable" role="status">{error}</p> : null}
    {stays && !stays.length ? <p>No bothies, campsites, hostels or hotels found on Google within 20 km of {searchedNear}.</p> : null}
    {stays?.length ? <>
      <p className="quiet">Within 20 km of {searchedNear}. Straight-line distance.</p>
      <ul className="rated-stay-list">{stays.map(stay => {
        const selected = stay.id === selectedId;
        return <li key={stay.id} className={selected ? "selected" : undefined}>
          <span className="rated-stay-type">{typeLabels[stay.type]}</span>
          <strong>{stay.google_maps_url ? <a href={stay.google_maps_url} target="_blank" rel="noreferrer">{stay.name}</a> : stay.name}</strong>
          <span>{stay.rating === null ? "No Google rating" : `★ ${stay.rating.toFixed(1)} · ${stay.review_count} ${stay.review_count === 1 ? "review" : "reviews"}`} · {stay.distance_km.toFixed(1)} km away</span>
          {stay.address ? <small>{stay.address}</small> : null}
          <button type="button" className="text-link" aria-pressed={selected} onClick={() => onSelect(selected ? null : stay)}>{selected ? "Chosen for tonight" : "Choose for tonight"}</button>
        </li>;
      })}</ul>
      <p className="overnight-note">Ratings and places from Google Maps. Check availability and booking with each provider.</p>
    </> : null}
  </section>;
}
