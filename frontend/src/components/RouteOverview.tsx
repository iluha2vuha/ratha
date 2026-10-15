import { useState } from 'react';
import type { RestStay, RestStop, RouteAmenities, RouteAmenity } from '../api';
import { formatHours, formatMiles, pointLabel, radiusLabel, stageColors, type Plan, type Stage } from '../planner';

function nightsWithoutStay(stops: RestStop[]) {
  return stops.filter(stop => !stop.stay);
}

function nearestOf(stop: RestStop) {
  return stop.nearest ?? [];
}

function nightLabel(nights: RestStop[]) {
  if (nights.length === 1) return `day ${nights[0].night}`;
  return nights.slice(0, -1).map(stop => `day ${stop.night}`).join(', ') + ` and day ${nights[nights.length - 1].night}`;
}

function amenityName(place: { name: string; kind_label: string }) {
  return place.name.startsWith('Unnamed ') ? place.kind_label : place.name;
}

function dayLabel(stage: Stage) {
  return new Date(`${stage.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function elevationText(stage: Pick<Stage, 'ascent_m' | 'descent_m'>) {
  if (stage.ascent_m === null) return 'Elevation unavailable';
  return `↑ ${Math.round(stage.ascent_m)} m · ↓ ${Math.round(stage.descent_m ?? 0)} m`;
}

function steepText(stage: Stage) {
  const parts = [
    stage.steepest_climb_pct != null ? `climb ${Math.round(stage.steepest_climb_pct)}%` : '',
    stage.steepest_descent_pct != null ? `descent ${Math.round(stage.steepest_descent_pct)}%` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function alongFor(stage: Stage | undefined, amenities: RouteAmenities | null, last: boolean) {
  if (!amenities) return [];
  if (!stage) return amenities.along_route;
  return amenities.along_route.filter(place => place.km >= stage.start_km && place.km < stage.end_km + (last ? 0.5 : 0));
}

function ClosestStays({ stop, radiusKm, addedIds, addingId, onAddStay, placesFull }: {
  stop: RestStop;
  radiusKm: number;
  addedIds: string[];
  addingId: string | null;
  onAddStay?: (stay: RestStay) => void;
  placesFull: boolean;
}) {
  if (!nearestOf(stop).length) {
    return <p className="quiet">No closer mapped places were found beyond {radiusLabel(radiusKm)}.</p>;
  }
  return (
    <ul className="stay-gap-list">
      {nearestOf(stop).map(stay => {
        const added = addedIds.includes(stay.id);
        return <li key={stay.id}>
          <div>
            <strong>{stay.name}</strong>
            <span>{stay.kind_label} · {formatMiles(stay.distance_km)} from where this day ends</span>
          </div>
          {onAddStay ? <button type="button" className="button secondary" disabled={added || placesFull || addingId !== null}
            onClick={() => onAddStay(stay)}>
            {added ? 'Added to journey' : addingId === stay.id ? 'Adding…' : 'Add to journey'}
          </button> : null}
        </li>;
      })}
    </ul>
  );
}

function StatRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="route-details-stats">
      {rows.map(row => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UtilityList({ places }: { places: RouteAmenity[] }) {
  if (!places.length) return <p className="quiet">No mapped shops or facilities along this part of the route.</p>;
  return (
    <ul className="route-details-places">
      {places.map(place => (
        <li key={place.id}>
          <a href={place.osm_url} target="_blank" rel="noreferrer">{amenityName(place)}</a>
          <span>{place.kind_label} · km {place.km.toFixed(1)}{place.off_route_km >= 0.1 ? ` · ${place.off_route_km.toFixed(1)} km off` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function RouteSchematic({ plan, selected }: { plan: Plan; selected: number }) {
  const points = plan.stages.flatMap(stage => stage.points);
  const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const origin = points[0].lon;
  const xs = points.map(point => ((point.lon - origin + 180) % 360 + 360) % 360 - 180).map(lon => lon * Math.cos(latitude * Math.PI / 180));
  const ys = points.map(point => -point.lat);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const pad = 16;
  const scale = Math.min(220 / Math.max(0.00001, Math.max(...xs) - left), 180 / Math.max(0.00001, Math.max(...ys) - top));
  const viewW = Math.max(96, (Math.max(...xs) - left) * scale + pad * 2);
  const viewH = Math.max(80, (Math.max(...ys) - top) * scale + pad * 2);
  function position(lat: number, lon: number) {
    const x = (((lon - origin + 180) % 360 + 360) % 360 - 180) * Math.cos(latitude * Math.PI / 180);
    return `${pad + (x - left) * scale},${pad + (-lat - top) * scale}`;
  }
  return (
    <figure className="route-details-map">
      <svg viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route divided into daily stages; schematic without terrain">
        {plan.stages.map(stage => (
          <g key={stage.day}>
            <polyline points={stage.points.map(point => position(point.lat, point.lon)).join(' ')} fill="none" stroke={stageColors[(stage.day - 1) % stageColors.length]} strokeWidth={selected === stage.day ? 7 : 4} />
            <circle cx={position(stage.points[0].lat, stage.points[0].lon).split(',')[0]} cy={position(stage.points[0].lat, stage.points[0].lon).split(',')[1]} r="4.5" fill={stageColors[(stage.day - 1) % stageColors.length]} />
          </g>
        ))}
      </svg>
      <figcaption>Schematic of your track. Select a day to highlight its route.</figcaption>
    </figure>
  );
}

export function RouteOverview({ plan, selected, onSelect, wholeRoute = false, restStops = [], radiusKm = 0, stayLabel = 'place to stay', addedStayIds = [], addingStayId = null, placesFull = false, onAddStay, amenities = null, amenitiesBusy = false, amenitiesError = '' }: {
  plan: Plan;
  selected: number;
  onSelect: (day: number) => void;
  wholeRoute?: boolean;
  restStops?: RestStop[];
  radiusKm?: number;
  stayLabel?: string;
  addedStayIds?: string[];
  addingStayId?: string | null;
  placesFull?: boolean;
  onAddStay?: (stay: RestStay) => void;
  amenities?: RouteAmenities | null;
  amenitiesBusy?: boolean;
  amenitiesError?: string;
}) {
  const [open, setOpen] = useState(true);
  const gaps = nightsWithoutStay(restStops);
  const focused = selected === 0 ? gaps : gaps.filter(stop => stop.night === selected);
  const stages = selected === 0 ? plan.stages : plan.stages.filter(stage => stage.day === selected);
  const overview = selected === 0;
  const lastStage = plan.stages[plan.stages.length - 1];
  const utilities = alongFor(overview ? undefined : stages[0], amenities, !overview && stages[0]?.day === lastStage?.day);

  const totalRows = [
    { label: 'Distance', value: `${plan.distance_km.toFixed(1)} km` },
    { label: 'Time', value: formatHours(plan.walking_hours) },
    { label: 'Climb', value: plan.ascent_m === null ? 'Elevation unavailable' : elevationText(plan) },
  ];

  return <div className={`route-overview${open ? '' : ' is-collapsed'}${gaps.length ? ' has-stay-warning' : ''}`}>
    <div className="route-overview-head">
      <p className="eyebrow" id="route-overview-title">Route details</p>
      <button type="button" className="route-overview-toggle" aria-expanded={open} aria-controls="route-overview-body" onClick={() => setOpen(shown => !shown)}>
        {open ? 'Hide' : 'Show'}
      </button>
    </div>
    {!open && gaps.length ? <p className="stay-gap-banner" role="status">No mapped {stayLabel} at the end of {nightLabel(gaps)}.</p> : null}
    {open ? <div id="route-overview-body" className="route-details-body">
      <div className="stage-tabs" role="group" aria-label="Select daily route">{wholeRoute ? <button type="button" aria-pressed={overview} onClick={() => onSelect(0)}>Whole route</button> : null}{plan.stages.map(stage => <button key={stage.day} type="button" aria-pressed={selected === stage.day} onClick={() => onSelect(stage.day)} style={{ borderColor: stageColors[(stage.day-1)%stageColors.length] }}>Day {stage.day}</button>)}</div>

      <div className="route-details-split">
        <div className="route-details-info">
          {overview ? <>
            <StatRows rows={totalRows} />
            <ul className="route-details-days">
              {plan.stages.map(stage => {
                const stop = restStops.find(item => item.night === stage.day);
                return <li key={stage.day}>
                  <button type="button" onClick={() => onSelect(stage.day)}>
                    <strong style={{ color: stageColors[(stage.day-1)%stageColors.length] }}>Day {stage.day}</strong>
                    <span>{stage.distance_km.toFixed(1)} km · {formatHours(stage.walking_hours)}</span>
                    <span>{elevationText(stage)}{stage.difficulty ? ` · ${stage.difficulty}` : ''}</span>
                    {stop ? <span>{stop.stay ? `${stop.stay.name} · ${stop.stay.kind_label}` : `No mapped ${stayLabel} tonight`}</span> : null}
                  </button>
                </li>;
              })}
            </ul>
          </> : stages.map(stage => {
            const stop = restStops.find(item => item.night === stage.day);
            const visits = stage.points.slice(1, -1).filter(point => point.name).map(point => point.name!);
            const steep = steepText(stage);
            const rows = [
              { label: 'Distance', value: `${stage.distance_km.toFixed(1)} km` },
              { label: 'Time', value: formatHours(stage.walking_hours) },
              { label: 'Climb', value: elevationText(stage) },
              ...(steep ? [{ label: 'Steepest', value: steep }] : []),
              ...(stage.difficulty ? [{ label: 'Difficulty', value: stage.difficulty }] : []),
              { label: 'Start', value: pointLabel(stage.points[0]) },
              { label: 'Finish', value: pointLabel(stage.points[stage.points.length - 1]) },
            ];
            return <div key={stage.day} className="route-details-day">
              <h3>Day {stage.day} · {dayLabel(stage)}</h3>
              <StatRows rows={rows} />
              {visits.length || stop ? <div className="route-details-section">
                <h4>Stopping places</h4>
                <ul className="route-details-places">
                  {visits.map(name => <li key={name}><span>{name}</span><span>On the route</span></li>)}
                  {stop?.stay ? <li><span>{stop.stay.name}</span><span>{stop.stay.kind_label} · night {stop.night}</span></li> : null}
                  {stop && !stop.stay ? <li><span>No mapped {stayLabel} tonight</span><span>Night {stop.night}</span></li> : null}
                </ul>
              </div> : null}
            </div>;
          })}

          {amenities || amenitiesBusy || amenitiesError ? <div className="route-details-section">
            <h4>{overview ? 'Utilities on the route' : 'Utilities on this day'}</h4>
            {amenitiesBusy ? <p>Looking for shops and facilities…</p> : null}
            {amenitiesError ? <p className="weather-unavailable">{amenitiesError}</p> : null}
            {!amenitiesBusy && !amenitiesError && amenities ? <UtilityList places={utilities} /> : null}
          </div> : null}
        </div>
        <RouteSchematic plan={plan} selected={selected} />
      </div>

      {gaps.length ? <div className="stay-gap" role="status">
        <p><strong>No mapped {stayLabel} within {radiusLabel(radiusKm)} at the end of {nightLabel(gaps)}.</strong></p>
        {focused.length ? focused.map(stop => <div key={stop.night} className="stay-gap-night">
          <p>{nearestOf(stop).length
            ? `Closest mapped places for night ${stop.night}. Adding one includes it as a place to visit and plans the route through it.`
            : stop.note}</p>
          <ClosestStays stop={stop} radiusKm={radiusKm} addedIds={addedStayIds} addingId={addingStayId} onAddStay={onAddStay} placesFull={placesFull} />
        </div>) : <p className="quiet">Select that day to see the closest mapped places and add one to the journey.</p>}
        {placesFull ? <p className="quiet">You already have 10 places to visit. Remove one if you want to add a stay.</p> : null}
      </div> : null}
    </div> : null}
  </div>;
}
