import type { StayPlace } from "../api";

const kindColor: Record<StayPlace["kind"], string> = {
  campsite: "#58C449",
  bothy: "#F54927",
  hostel: "#4968C4",
  hotel: "#C449C4",
  guest_house: "#DBB230",
  water: "#1C7ED6",
  food: "#F76707",
  shop: "#7048C4",
  toilets: "#5F6B66",
  health: "#D6336C",
  cash: "#2B8A3E",
  post: "#C92A2A",
  transport: "#364FC7",
  bike: "#0B7285",
};

const pinPoints: Partial<Record<StayPlace["kind"], string>> = {
  campsite: "12,2.2 21.6,21.4 2.4,21.4",
  bothy: "2.4,2.6 21.6,2.6 12,21.8",
  hostel: "12,1.8 22.2,12 12,22.2 1.8,12",
  guest_house: "3.2,3.2 20.8,3.2 20.8,20.8 3.2,20.8",
  water: "12,1.8 19.2,11.2 16.4,21.2 7.6,21.2 4.8,11.2",
  food: "12,2.4 21.4,9.2 17.8,21.2 6.2,21.2 2.6,9.2",
  shop: "2.6,6 21.4,6 18.6,21 5.4,21",
  transport: "4,2.6 20,2.6 20,17 12,21.6 4,17",
};

export const placeKinds: { kind: Extract<StayPlace["kind"], "campsite" | "bothy" | "hostel" | "hotel" | "guest_house">; label: string }[] = [
  { kind: "campsite", label: "Campsite" },
  { kind: "bothy", label: "Bothy" },
  { kind: "hostel", label: "Hostel" },
  { kind: "hotel", label: "Hotel" },
  { kind: "guest_house", label: "Guest house" },
];

export const facilityKinds: { kind: Extract<StayPlace["kind"], "water" | "food">; label: string }[] = [
  { kind: "water", label: "Water" },
  { kind: "food", label: "Food" },
];

export function colorForPlace(kind: string) {
  return kindColor[kind as StayPlace["kind"]] ?? "#333333";
}

export function createPlacePinSvg(kind: string, selected: boolean) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const fill = colorForPlace(kind);
  const stroke = selected ? "#ffffff" : "#1a1a1a";
  const strokeWidth = selected ? "2.4" : "1.5";
  const points = pinPoints[kind as StayPlace["kind"]];
  const shape = document.createElementNS("http://www.w3.org/2000/svg", points ? "polygon" : "circle");
  if (points && shape instanceof SVGPolygonElement) {
    shape.setAttribute("points", points);
    shape.setAttribute("stroke-linejoin", "round");
  } else if (shape instanceof SVGCircleElement) {
    shape.setAttribute("cx", "12");
    shape.setAttribute("cy", "12");
    shape.setAttribute("r", "9");
  }
  shape.setAttribute("fill", fill);
  shape.setAttribute("stroke", stroke);
  shape.setAttribute("stroke-width", strokeWidth);
  svg.append(shape);
  return svg;
}

export function PlaceGlyph({ kind }: { kind: string }) {
  const fill = colorForPlace(kind);
  const points = pinPoints[kind as StayPlace["kind"]];
  return (
    <svg className="place-swatch" viewBox="0 0 24 24" aria-hidden="true">
      {points ? (
        <polygon points={points} fill={fill} stroke="#1a1a1a" strokeWidth="1.5" strokeLinejoin="round" />
      ) : (
        <circle cx="12" cy="12" r="9" fill={fill} stroke="#1a1a1a" strokeWidth="1.5" />
      )}
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="place-row-detail">
      <span>{label}</span>
      {value}
    </p>
  );
}

export function PlaceCard({ place, onClose }: { place: StayPlace; onClose: () => void }) {
  return (
    <article className="place-card" aria-label={place.name}>
      <header className="place-card-head">
        <p className="place-kind" style={{ color: colorForPlace(place.kind) }}>
          {place.kind_label}
          {place.stars ? ` · ${place.stars} star` : ""}
        </p>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close place details">
          ×
        </button>
      </header>
      <h2>{place.name}</h2>
      {place.address ? <p className="quiet">{place.address}</p> : null}
      {place.description ? <p>{place.description}</p> : null}
      {place.operator ? <Row label="Run by" value={place.operator} /> : null}
      {place.fee ? <Row label="Fee" value={place.fee} /> : null}
      {place.capacity ? <Row label="Capacity" value={place.capacity} /> : null}
      {place.opening_hours ? <Row label="Hours" value={place.opening_hours} /> : null}
      {place.phone ? (
        <p className="place-row-detail">
          <span>Phone</span>
          <a href={`tel:${place.phone}`}>{place.phone}</a>
        </p>
      ) : null}
      {place.website ? (
        <p className="place-row-detail">
          <span>Website</span>
          <a href={place.website} target="_blank" rel="noreferrer">
            {place.website.replace(/^https?:\/\//, "")}
          </a>
        </p>
      ) : null}
      <section className="place-reviews">
        <h3>Reviews</h3>
        <p>
          OpenStreetMap does not include visitor reviews.
          {place.website ? " Guest comments, when they exist, are on the place website." : ""}
        </p>
      </section>
      <a className="text-link" href={place.osm_url} target="_blank" rel="noreferrer">
        View on OpenStreetMap
      </a>
    </article>
  );
}
