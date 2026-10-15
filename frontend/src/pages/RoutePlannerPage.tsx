import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapView, type AlternativeRoute, type RouteStop } from '../components/MapView';
import { RouteSchematic } from '../components/RouteOverview';
import { estimateTrip, getRouteAmenities, getRouteWeather, planTrack, planTrip, putSavedRoute, type DistanceEstimate, type RatedStay, type RestStay, type RouteAmenities, type RouteMode, type SavedRoute, type StayKind, type StayPlace, type TripPlan, type VisitPlace } from '../api';
import { placeKinds } from '../components/PlaceCard';
import { GoalEstimate, type GoalKind } from '../components/GoalEstimate';
import { RatedStays } from '../components/RatedStays';
import { RestStopDetails } from '../components/RestStopDetails';
import { RouteOptions } from '../components/RouteOptions';
import { StageAmenities } from '../components/StageAmenities';
import { StageWeather, type RouteWeather } from '../components/StageWeather';
import { DEFAULT_HOURS, DEFAULT_MILES, KM_PER_MILE, PACE_KMH, demoPoints, exportStage, formatHours, formatMiles, formatPace, kmFromMiles, localDate, milesFromKm, parseGpx, pointLabel, radiusLabel, stageColors, stayKindsLabel, trackDistanceKm, type RoutePoint } from '../planner';
import type { Pace, PlannerSeed, WildCampTripStop } from '../sampleData';
import { useAuth } from '../auth';
import { saveOfflineRoute } from '../offlineRoutes';

const defaultGoal = { hiking: kmFromMiles(DEFAULT_MILES.hiking), cycling: kmFromMiles(DEFAULT_MILES.cycling) };
const radiusChoices = [3, 5, 10];
const allStayKinds = placeKinds.map(item => item.kind);
const maxDays = 14;
const maxPlaces = 10;
type Track = { name: string; points: RoutePoint[]; demo?: boolean };
type Source = 'route' | 'track';

function visitName(place: VisitPlace) {
  return typeof place === 'string' ? place : place.name;
}
function sameVisit(place: VisitPlace, stay: RestStay) {
  if (typeof place !== 'string') return Math.abs(place.lat - stay.lat) < 1e-5 && Math.abs(place.lon - stay.lon) < 1e-5;
  return place.trim().toLowerCase() === stay.name.trim().toLowerCase();
}
function wildCampVisit(stop: WildCampTripStop): VisitPlace {
  return { name: `${stop.name} · AI estimate ${stop.score}/100 (${stop.category})`, lat: stop.latitude, lon: stop.longitude };
}

export function RoutePlannerPage() {
  const { user } = useAuth();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetSize, setSheetSize] = useState(0.65);
  const drag = useRef<{ id: number; y: number; height: number; viewport: number; size: number; delta: number } | null>(null);
  const dragged = useRef(false);
  function startSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    const sheet = sheetRef.current;
    if (!sheet) return;
    dragged.current = false;
    drag.current = { id: event.pointerId, y: event.clientY, height: sheet.clientHeight,
      viewport: sheet.parentElement!.clientHeight, size: sheetSize, delta: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    current.delta = event.clientY - current.y;
    if (Math.abs(current.delta) > 5) dragged.current = true;
    setSheetSize(Math.max(164 / current.viewport, Math.min(0.92, (current.height - current.delta) / current.viewport)));
  }
  function finishSheetDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    if (cancelled || !dragged.current) { setSheetSize(current.size); return; }
    const size = (current.height - current.delta) / current.viewport;
    if (current.delta > 60) setSheetSize(current.size > 0.65 ? 0.65 : 0);
    else if (current.delta < -60) setSheetSize(current.size === 0 ? 0.65 : 0.92);
    else {
      const stops = [164 / current.viewport, 0.65, 0.92];
      const nearest = stops.reduce((best, stop) => Math.abs(stop - size) < Math.abs(best - size) ? stop : best);
      setSheetSize(nearest === stops[0] ? 0 : nearest);
    }
  }
  const resultRef = useRef<HTMLHeadingElement>(null);
  const overviewRef = useRef<HTMLHeadingElement>(null);
  const planHeadingRef = useRef<HTMLHeadingElement>(null);
  const [panel, setPanel] = useState<'planning' | 'options' | 'overview'>('planning');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const view = useRef<'planning' | 'options' | 'overview'>('planning');
  const focusOptions = useRef(false);
  const focusOverview = useRef(false);
  const focusPlanning = useRef(false);
  const failedAdjustKey = useRef('');
  const seed = (useLocation().state ?? null) as PlannerSeed | null;
  const [start, setStart] = useState(seed?.start ?? '');
  const [finish, setFinish] = useState(seed?.finish ?? '');
  const [travelMode, setTravelMode] = useState<RouteMode>('hiking');
  const [places, setPlaces] = useState<VisitPlace[]>(() => seed?.wildCampStop ? [wildCampVisit(seed.wildCampStop)] : []);
  const [addingStayId, setAddingStayId] = useState<string | null>(null);
  const [placeDraft, setPlaceDraft] = useState('');
  const [keepOrder, setKeepOrder] = useState(false);
  const [goals, setGoals] = useState<number[]>(() => Array.from({ length: seed?.days ?? 2 }, () => defaultGoal.hiking));
  const [goalKind, setGoalKind] = useState<GoalKind>('miles');
  const [hoursGoal, setHoursGoal] = useState<number>(DEFAULT_HOURS.hiking);
  const [pace, setPace] = useState<Pace>(seed?.pace ?? 'steady');
  const [startDate, setStartDate] = useState(localDate);
  const [miles, setMiles] = useState(5);
  const [stayKinds, setStayKinds] = useState<StayKind[]>(allStayKinds);
  const [estimate, setEstimate] = useState<DistanceEstimate | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateError, setEstimateError] = useState('');

  const [trip, setTrip] = useState<TripPlan | null>(null);
  const [source, setSource] = useState<Source>('route');
  const [track, setTrack] = useState<Track | null>(null);
  const [plannedKey, setPlannedKey] = useState('');
  const [optionId, setOptionId] = useState('');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<'' | Source>('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  const [chosenStays, setChosenStays] = useState<Record<number, RatedStay>>({});
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [weatherRefresh, setWeatherRefresh] = useState(0);
  const [amenities, setAmenities] = useState<RouteAmenities | null>(null);
  const [amenitiesBusy, setAmenitiesBusy] = useState(false);
  const [amenitiesError, setAmenitiesError] = useState('');
  const [amenitiesRefresh, setAmenitiesRefresh] = useState(0);
  const [showAmenityPins, setShowAmenityPins] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const mapPanel = useRef<HTMLDivElement>(null);
  const option = trip?.options.find(item => item.id === optionId) ?? trip?.options[0] ?? null;
  const plan = option?.plan ?? null;
  const cycling = (trip?.mode ?? travelMode) === 'cycling';

  function revealMap() {
    if (!window.matchMedia('(max-width: 1000px)').matches) return;
    const target = mapPanel.current?.querySelector<HTMLElement>('.map-stage') ?? mapPanel.current;
    if (!target) return;
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }
  function selectDay(day: number) {
    setSelected(day);
    revealMap();
  }
  function chooseOption(id: string) {
    setOptionId(id);
    setSelected(0);
    focusOverview.current = true;
    view.current = 'overview';
    setPanel('overview');
    revealMap();
  }

  function dailyKm(kind = goalKind, dayGoals = goals, hours = hoursGoal, mode = travelMode, chosenPace = pace) {
    return kind === 'hours' ? dayGoals.map(() => hours * PACE_KMH[mode][chosenPace]) : dayGoals;
  }
  function keyFor(kind: Source, dayGoals: number[], useTrack: Track | null, extras: { goalKind?: GoalKind; hours?: number; mode?: RouteMode; chosenPace?: Pace; places?: VisitPlace[] } = {}) {
    const planned = dailyKm(extras.goalKind ?? goalKind, dayGoals, extras.hours ?? hoursGoal, extras.mode ?? travelMode, extras.chosenPace ?? pace);
    const shared = [extras.mode ?? travelMode, planned, startDate, extras.chosenPace ?? pace, miles, stayKinds];
    const visits = extras.places ?? places;
    return JSON.stringify(kind === 'route' ? ['route', start.trim(), finish.trim(), visits, keepOrder, ...shared] : ['track', useTrack?.name, useTrack?.points.length, ...shared]);
  }
  const stale = Boolean(trip) && plannedKey !== keyFor(source, goals, track);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (start.trim().length < 2 || finish.trim().length < 2) {
      setEstimate(null); setEstimateError(''); setEstimateBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setEstimateBusy(true); setEstimateError('');
      estimateTrip({ start: start.trim(), finish: finish.trim(), points_of_interest: places, keep_order: keepOrder, mode: travelMode }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setEstimate(result); })
        .catch(err => {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
          setEstimate(null);
          setEstimateError(err instanceof Error ? err.message : 'Could not estimate this distance.');
        })
        .finally(() => { if (!controller.signal.aborted) setEstimateBusy(false); });
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [start, finish, places, keepOrder, travelMode]);

  async function run(kind: Source, overrides: { goals?: number[]; track?: Track; places?: VisitPlace[] } = {}, reveal = false) {
    const dayGoals = overrides.goals ?? goals;
    const planned = dailyKm(goalKind, dayGoals);
    const useTrack = overrides.track ?? track;
    const visits = overrides.places ?? places;
    if (kind === 'track' && !useTrack) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const startedPanel = view.current;
    setBusy(kind);
    setError('');
    const requestKey = keyFor(kind, dayGoals, useTrack, { places: visits });
    const settings = { mode: travelMode, daily_km: planned, start_date: startDate, pace, stay_radius_km: miles * KM_PER_MILE, stay_kinds: stayKinds };
    try {
      const result = kind === 'route'
        ? await planTrip({ ...settings, start: start.trim(), finish: finish.trim(), points_of_interest: visits, keep_order: keepOrder }, controller.signal)
        : await planTrack({ ...settings, name: useTrack!.name.slice(0, 160), points: useTrack!.points }, controller.signal);
      if (controller.signal.aborted) return;
      setTrip(result);
      setSource(kind);
      setOptionId(result.options[0]?.id ?? '');
      setSelected(0);
      setPlannedKey(requestKey);
      failedAdjustKey.current = '';
      if (view.current === startedPanel && reveal && result.options.length) {
        focusOptions.current = true;
        view.current = 'options';
        setPanel('options');
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        failedAdjustKey.current = requestKey;
        setError(err instanceof Error ? err.message : 'Could not plan this route.');
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy('');
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run('route', {}, true);
  }

  function commitAdjustments(event: FormEvent) {
    event.preventDefault();
    if (view.current !== 'options') return;
    failedAdjustKey.current = '';
    void run(source);
  }

  function backToOptions() {
    focusOptions.current = true;
    view.current = 'options';
    setPanel('options');
  }

  function backToPlanning() {
    view.current = 'planning';
    focusPlanning.current = true;
    pending.current?.abort();
    setError('');
    setPanel('planning');
  }

  function addPlace() {
    const name = placeDraft.trim();
    if (!name || places.length >= maxPlaces) return;
    setPlaces(current => [...current, name]);
    setPlaceDraft('');
  }

  function onPlaceKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addPlace();
  }

  function changeMode(next: RouteMode) {
    setGoals(current => current.every(goal => Math.abs(goal - defaultGoal[travelMode]) < 0.3) ? current.map(() => defaultGoal[next]) : current);
    setHoursGoal(current => current === DEFAULT_HOURS[travelMode] ? DEFAULT_HOURS[next] : current);
    setTravelMode(next);
  }

  function resizeGoals(count: number) {
    setGoals(current => {
      const next = current.slice(0, count);
      while (next.length < count) next.push(goalKind === 'hours' ? hoursGoal * PACE_KMH[travelMode][pace] : current[current.length - 1] || defaultGoal[travelMode]);
      return next;
    });
  }

  async function importFile(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 5_000_000) throw new Error('Choose a GPX file smaller than 5 MB.');
      const parsed = parseGpx(await file.text());
      const next = { name: parsed.name === 'Imported route' ? file.name.replace(/\.gpx$/i, '') : parsed.name, points: parsed.points };
      setTrack(next);
      await run('track', { track: next }, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import GPX.');
    }
  }

  function tryDemo() {
    const demo = { name: 'Highlands demo', points: demoPoints, demo: true };
    setTrack(demo);
    void run('track', { track: demo }, true);
  }

  function replanWith(dailyKm: number[]) {
    setGoals(dailyKm);
    void run(source, { goals: dailyKm });
  }

  function addStayToJourney(stay: RestStay) {
    if (places.length >= maxPlaces || places.some(place => sameVisit(place, stay))) return;
    const next: VisitPlace[] = [...places, { name: stay.name, lat: stay.lat, lon: stay.lon }];
    setPlaces(next);
    if (!start.trim() || !finish.trim()) return;
    setAddingStayId(stay.id);
    void run('route', { places: next }).finally(() => setAddingStayId(null));
  }

  useEffect(() => { setChosenStays({}); setSaved(false); setSaveStatus(''); }, [option]);

  useEffect(() => {
    setWeather(null); setWeatherError(''); setWeatherBusy(false);
    if (!plan) return;
    const controller = new AbortController();
    setWeatherBusy(true);
    getRouteWeather(plan, controller.signal).then(result => {
      if (!controller.signal.aborted) setWeather(result);
    }).catch(err => {
      if (!controller.signal.aborted) setWeatherError(err instanceof Error ? err.message : 'Could not load weather.');
    }).finally(() => { if (!controller.signal.aborted) setWeatherBusy(false); });
    return () => controller.abort();
  }, [plan, weatherRefresh]);

  useEffect(() => {
    setAmenities(null); setAmenitiesError(''); setAmenitiesBusy(false);
    if (!option || !trip) return;
    const controller = new AbortController();
    setAmenitiesBusy(true);
    getRouteAmenities(option, trip.mode, controller.signal).then(result => {
      if (!controller.signal.aborted) setAmenities(result);
    }).catch(err => {
      if (!controller.signal.aborted) setAmenitiesError(err instanceof Error ? err.message : 'Could not load shops and facilities.');
    }).finally(() => { if (!controller.signal.aborted) setAmenitiesBusy(false); });
    return () => controller.abort();
  }, [option, trip, amenitiesRefresh]);

  const alternatives = useMemo<AlternativeRoute[]>(() => !trip || !option ? [] : trip.options.filter(item => item.id !== option.id).map(item => ({
    id: item.id, label: item.label, points: item.plan.stages.flatMap(stage => stage.points.map(point => [point.lat, point.lon] as [number, number])),
  })), [trip, option]);

  const stops = useMemo<RouteStop[]>(() => {
    if (!trip || !option) return [];
    const first = option.plan.stages[0].points[0];
    const last = option.plan.stages[option.plan.stages.length - 1].points.at(-1)!;
    return [
      { id: 'start', kind: 'start', label: 'Start', title: `Start: ${trip.start.name}`, lat: first.lat, lon: first.lon },
      ...trip.points_of_interest.map((place, index): RouteStop => ({ id: `poi-${index}`, kind: 'poi', label: place.name, title: `Place to visit: ${place.name}`, lat: place.lat, lon: place.lon })),
      ...option.rest_stops.map((stop): RouteStop => ({ id: `night-${stop.night}`, kind: 'night', label: `Night ${stop.night}`,
        title: `Night ${stop.night}: ${stop.stay?.name ?? 'no place to stay found'}`, lat: stop.stay?.lat ?? stop.lat, lon: stop.stay?.lon ?? stop.lon })),
      { id: 'finish', kind: 'finish', label: 'Finish', title: `Finish: ${trip.finish.name}`, lat: last.lat, lon: last.lon },
    ];
  }, [trip, option]);

  const routePlaces = useMemo<StayPlace[]>(() => {
    if (!option) return [];
    const stays = option.rest_stops.flatMap(stop => stop.stay ? [stop.stay] : (stop.nearest ?? []));
    if (!amenities || !showAmenityPins) return stays;
    const stage = option.plan.stages.find(item => item.day === selected);
    const along = amenities.along_route.filter(place => !stage || (place.km >= stage.start_km - 0.2 && place.km <= stage.end_km + 0.2));
    const near = amenities.near_stops.filter(item => !stage || item.night === stage.day || item.night === stage.day - 1).flatMap(item => item.amenities);
    const seen = new Set<string>();
    const result: StayPlace[] = [];
    for (const place of [...stays, ...along, ...near]) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      result.push(place);
    }
    return result;
  }, [option, amenities, showAmenityPins, selected]);

  const goalsReady = goalKind === 'hours'
    ? Number.isFinite(hoursGoal) && hoursGoal >= 0.5 && hoursGoal <= 14
    : goals.length > 0 && goals.every(goal => Number.isFinite(goal) && milesFromKm(goal) >= 0.49 && milesFromKm(goal) <= 120);
  const canAdjust = stayKinds.length > 0 && goalsReady && (source === 'track' ? Boolean(track) : start.trim().length >= 2 && finish.trim().length >= 2);
  const adjustKey = keyFor(source, goals, track);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (panel !== 'options' || !stale || !canAdjust || busy || failedAdjustKey.current === adjustKey) return;
    const timer = window.setTimeout(() => { void runRef.current(source); }, 800);
    return () => window.clearTimeout(timer);
  }, [panel, stale, canAdjust, busy, source, adjustKey]);

  useEffect(() => {
    if ((panel === 'options' && focusOptions.current) || (panel === 'overview' && focusOverview.current)) {
      const overview = panel === 'overview';
      focusOptions.current = false;
      focusOverview.current = false;
      setSheetSize(size => size === 0 ? 0.65 : size);
      const frame = requestAnimationFrame(() => {
        sheetRef.current?.querySelector('.planner-side')?.scrollTo({ top: 0 });
        (overview ? overviewRef.current : resultRef.current)?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (panel === 'planning' && focusPlanning.current) {
      focusPlanning.current = false;
      const frame = requestAnimationFrame(() => {
        sheetRef.current?.querySelector('.planner-side')?.scrollTo({ top: 0 });
        planHeadingRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [panel, plan]);

  async function saveToLibrary() {
    if (!trip || !option || !plan) return;
    setSaveBusy(true);
    setSaveStatus('');
    const id = window.crypto?.randomUUID?.() ?? ("route-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
    const snapshot: SavedRoute = {
      id,
      name: (source === 'track' ? trip.name : `${trip.name} (${option.label})`).slice(0, 160),
      points: plan.stages.flatMap((stage, index) => index ? stage.points.slice(1) : stage.points),
      plan,
      generated: null,
      saved_at: Date.now(),
    };
    try {
      await saveOfflineRoute(snapshot);
      setSaved(true);
      setSaveStatus("Saved on this device for offline viewing.");
      if (user) {
        try {
          const synced = await putSavedRoute(snapshot);
          await saveOfflineRoute(synced, true);
          setSaveStatus("Saved offline and synced to your account.");
        } catch {
          setSaveStatus("Saved on this device. Account sync is unavailable; you can retry from your library.");
        }
      } else {
        setSaveStatus("Saved on this device. Sign in if you want to sync it to your account.");
      }
    } catch (saveError) {
      setSaveStatus(saveError instanceof Error ? saveError.message : "Could not save this route on the device.");
    } finally {
      setSaveBusy(false);
    }
  }

  const plannedDaily = dailyKm();
  const goalTotal = plannedDaily.reduce((sum, goal) => sum + (Number.isFinite(goal) ? goal : 0), 0);
  const plannedGoals = trip?.daily_km ?? plannedDaily;
  const lastGoal = plannedGoals[plannedGoals.length - 1] ?? defaultGoal[travelMode];
  const coverKm = !stale && option ? option.distance_km : source === 'track' && track ? trackDistanceKm(track.points) : estimate?.estimated_km ?? null;
  const coverSource = !stale && option ? 'route' as const : source === 'track' && track ? 'track' as const : estimate ? 'estimate' as const : null;
  const addedStayIds = (option?.rest_stops ?? []).flatMap(stop => stop.nearest ?? []).filter(stay => places.some(place => sameVisit(place, stay))).map(stay => stay.id);
  const showingOptions = panel === 'options' && Boolean(trip && option && plan);
  const showingOverview = panel === 'overview' && Boolean(trip && option && plan);
  const panelTitle = trip?.name ?? (start.trim() && finish.trim() ? `${start.trim()} to ${finish.trim()}` : 'Plan your days');

  return <section className="planner" style={{ '--planner-sheet-height': sheetSize === 0 ? '164px' : `${sheetSize * 100}dvh` } as CSSProperties}>
    <div className={`planner-sheet ${sheetSize === 0 ? 'is-collapsed' : ''} ${showingOptions || showingOverview ? 'is-options' : ''}`} ref={sheetRef}>
      <button type="button" className="planner-sheet-handle"
        aria-label={sheetSize === 0
          ? (showingOverview ? 'Show route details' : showingOptions ? 'Show route options' : 'Show trip planning')
          : (showingOverview ? 'Collapse route details to show the map' : showingOptions ? 'Collapse route options to show the map' : 'Collapse trip planning to show the map')}
        aria-expanded={sheetSize !== 0} aria-controls="trip-planning-controls"
        onPointerDown={startSheetDrag} onPointerMove={moveSheetDrag}
        onPointerUp={event => finishSheetDrag(event)} onPointerCancel={event => finishSheetDrag(event, true)}
        onLostPointerCapture={event => finishSheetDrag(event, true)}
        onClick={event => { if (event.detail === 0 || !dragged.current) setSheetSize(size => size === 0 ? 0.65 : 0); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'End') { event.preventDefault(); setSheetSize(0); }
          if (event.key === 'ArrowUp' || event.key === 'Home') { event.preventDefault(); setSheetSize(event.key === 'Home' ? 0.92 : 0.65); }
        }}>
        <span className="planner-grip" aria-hidden="true" />
        {sheetSize === 0 ? <span className="planner-handle-label">{showingOverview ? 'Route details' : showingOptions ? 'Route options' : 'Plan your days'}</span> : null}
      </button>
    <div id="trip-planning-controls" className={`planner-side${showingOptions || showingOverview ? ' is-options' : ''}`} role="region" aria-label={showingOverview ? 'Route details' : showingOptions ? 'Route options' : 'Trip planning'} aria-busy={panel === 'planning' && busy !== ''} tabIndex={0}>
      {showingOptions || showingOverview ? null : <>
      <p className="eyebrow">Multi-day planner</p>
      <h1 ref={planHeadingRef} tabIndex={-1}>{panelTitle}</h1>
      <p className="quiet planner-lead">Choose a start and finish to plan your route. Add places you want to visit, then set miles or hours for each day; each night ends at the nearest place to stay.</p>

      <form onSubmit={submit}>
        <label className="field">Start<input required minLength={2} maxLength={160} value={start} onChange={event => setStart(event.target.value)} placeholder="e.g. Fort William" /></label>
        <label className="field">Finish<input required minLength={2} maxLength={160} value={finish} onChange={event => setFinish(event.target.value)} placeholder="e.g. Kinlochleven" /></label>

        <div className="field">
          <label htmlFor="place-draft">Places to visit</label>
          <div className="inline-add">
            <input id="place-draft" value={placeDraft} maxLength={160} onChange={event => setPlaceDraft(event.target.value)} onKeyDown={onPlaceKey} placeholder="Summit, bothy, village or landmark" />
            <button type="button" className="button secondary" disabled={!placeDraft.trim() || places.length >= maxPlaces} onClick={addPlace}>Add place</button>
          </div>
        </div>
        {places.length ? <>
          <ol className="waypoint-list">{places.map((place, index) => <li key={`${visitName(place)}-${index}`} className="waypoint">
            <span>{visitName(place)}</span>
            <button className="icon-button" type="button" aria-label={`Remove ${visitName(place)}`} onClick={() => setPlaces(current => current.filter((_, i) => i !== index))}>×</button>
          </li>)}</ol>
          {places.length > 1 ? <label className="toggle planner-toggle"><input type="checkbox" checked={keepOrder} onChange={event => setKeepOrder(event.target.checked)} />Visit in the order listed (otherwise the shortest order is used)</label> : null}
        </> : <p className="quiet planner-hint">The route goes through every place you add, between start and finish.</p>}

        <div className="planner-options">
          <label className="field">Travel mode<select value={travelMode} onChange={event => changeMode(event.target.value as RouteMode)}><option value="hiking">Hiking</option><option value="cycling">Cycling</option></select></label>
          <label className="field">{travelMode === 'cycling' ? 'Cycling pace' : 'Walking pace'}<select value={pace} onChange={event => setPace(event.target.value as Pace)}>
            <option value="easy">Easy · {formatPace(travelMode, 'easy')}</option>
            <option value="steady">Steady · {formatPace(travelMode, 'steady')}</option>
            <option value="hard">Fast · {formatPace(travelMode, 'hard')}</option>
          </select></label>
        </div>
        <label className="field">Departure date<input type="date" required value={startDate} onChange={event => setStartDate(event.target.value)} /></label>

        <fieldset className="goal-fieldset">
          <legend>Daily goal</legend>
          <div className="pace goal-mode" role="group" aria-label="Daily goal type">
            <button type="button" className={goalKind === 'miles' ? 'is-selected' : ''} aria-pressed={goalKind === 'miles'} onClick={() => setGoalKind('miles')}>Miles per day</button>
            <button type="button" className={goalKind === 'hours' ? 'is-selected' : ''} aria-pressed={goalKind === 'hours'} onClick={() => setGoalKind('hours')}>{travelMode === 'cycling' ? 'Hours riding per day' : 'Hours walking per day'}</button>
          </div>
          <GoalEstimate
            coverKm={coverKm} source={coverSource} notice={estimate?.notice} loading={estimateBusy} error={estimateError}
            mode={travelMode} pace={pace} goalKind={goalKind} days={goals.length} hoursGoal={hoursGoal}
            dailyKm={goalTotal / Math.max(1, goals.length)}
            onApplyDays={count => resizeGoals(count)}
            onApplyMiles={value => setGoals(current => current.map(() => kmFromMiles(value)))} />
          <div className="stepper goal-stepper">
            <button type="button" aria-label="Remove the last day" disabled={goals.length <= 1} onClick={() => resizeGoals(goals.length - 1)}>−</button>
            <span>{goals.length} {goals.length === 1 ? 'day' : 'days'}</span>
            <button type="button" aria-label="Add a day" disabled={goals.length >= maxDays} onClick={() => resizeGoals(goals.length + 1)}>+</button>
          </div>
          {goalKind === 'hours' ? (
            <label className="goal-field hours-field">
              <span>Each day</span>
              <input type="number" required min={0.5} max={14} step={0.5} inputMode="decimal" value={hoursGoal > 0 ? hoursGoal : ''}
                onChange={event => setHoursGoal(Number(event.target.value))} />
              <span>hours</span>
            </label>
          ) : (
            <ol className="goal-list">{goals.map((goal, index) => <li key={index}>
              <label className="goal-field">
                <span>Day {index + 1}</span>
                <input type="number" required min={0.5} max={120} step={0.5} inputMode="decimal" value={goal > 0 ? Math.round(milesFromKm(goal) * 10) / 10 : ''}
                  onChange={event => setGoals(current => current.map((value, i) => i === index ? kmFromMiles(Number(event.target.value)) : value))} />
                <span>miles</span>
              </label>
            </li>)}</ol>
          )}
          <p className="quiet">
            {goalKind === 'hours'
              ? `That is ${formatMiles(plannedDaily[0] || 0)} a day, ${formatMiles(goalTotal)} in total. If the planned route is longer, the planner tells you so you can decide what to change.`
              : `Your goals add up to ${formatMiles(goalTotal)} (${goalTotal.toFixed(goalTotal >= 10 ? 0 : 1)} km). If a route is longer, the planner tells you so you can decide what to change.`}
          </p>
        </fieldset>

        <fieldset className="goal-fieldset stay-kinds">
          <legend>Places to stay</legend>
          <div className="pace stay-kind-toggles" role="group" aria-label="Accommodation types">
            {placeKinds.map(item => {
              const on = stayKinds.includes(item.kind);
              return <button type="button" key={item.kind} className={on ? 'is-selected' : ''} aria-pressed={on}
                onClick={() => setStayKinds(current => on ? current.filter(kind => kind !== item.kind) : [...current, item.kind])}>
                {item.label}
              </button>;
            })}
          </div>
          {stayKinds.length ? <label className="field">Look for these within<select value={miles} onChange={event => setMiles(Number(event.target.value))}>
            {radiusChoices.map(choice => <option key={choice} value={choice}>{radiusLabel(choice * KM_PER_MILE)}</option>)}
          </select></label> : <p className="quiet" role="status">Turn on at least one type of place to stay.</p>}
        </fieldset>

        <button className="button" type="submit" disabled={busy !== '' || stayKinds.length === 0}>{busy === 'route' ? 'Finding routes…' : 'Plan route'}</button>
      </form>
      {busy ? <p className="quiet" role="status">{busy === 'route' ? 'Finding routes and places to stay near each night…' : 'Building days and finding places to stay along your track…'}</p> : null}
      {error ? <p role="alert" className="route-error">{error}</p> : null}

      <section className="planner-track">
        <h3>Or use your own track</h3>
        <p className="quiet">Days and rest stops use the goals and settings above. An imported track is not re-routed, so detours to places to stay are not added.</p>
        <label className="field">Route track (GPX)<input type="file" accept=".gpx,application/gpx+xml" disabled={busy !== '' || stayKinds.length === 0} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
        <button type="button" className="button secondary" disabled={busy !== '' || stayKinds.length === 0} onClick={tryDemo}>Try a demo track</button>
      </section>
      </>}

      {showingOptions && trip && option && plan ? <>
        <div className="planner-results-bar">
          <button type="button" className="button secondary planner-back" aria-label="Back to planning" onClick={backToPlanning}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>Planning</button>
          <button type="button" className="button secondary" aria-expanded={optionsOpen} aria-controls="route-options-settings" onClick={() => setOptionsOpen(open => !open)}>{optionsOpen ? 'Hide options' : 'Options'}</button>
        </div>
        <p className="eyebrow">Route options</p>
        <h1 ref={resultRef} tabIndex={-1}>{trip.name}</h1>
        <p className="quiet planner-lead">Select a route to open its details. The others stay on the map as dashed lines until you choose.</p>
        {source === 'track' && track?.demo ? <p className="planner-notice">Illustrative track only — these lines are not a verified hiking route.</p> : null}
        {trip.notices.map(notice => <p key={notice} className="planner-notice">{notice}</p>)}
        {busy ? <p className="quiet" role="status">{busy === 'route' ? 'Finding routes and places to stay near each night…' : 'Building days and finding places to stay along your track…'}</p> : stale && canAdjust ? <p className="quiet" role="status">Updating the routes…</p> : null}
        {stale && !busy && !canAdjust ? <p className="quiet">Set a valid daily goal and at least one place to stay before the routes can update.</p> : null}
        {error ? <p role="alert" className="route-error">{error}</p> : null}
        {error ? <button type="button" className="button secondary" disabled={busy !== '' || !canAdjust} onClick={() => { failedAdjustKey.current = ''; void run(source); }}>Try again</button> : null}
        <section className="route-choice" aria-labelledby="route-choice-heading">
          <h2 id="route-choice-heading">{trip.options.length > 1 ? 'Choose a route' : 'Your route'}</h2>
          <p className="quiet">
            {trip.options.length > 1 ? `${trip.options.length} route options. Select one to open its details.` : null}
            {trip.points_of_interest.length ? ` Visiting ${trip.points_of_interest.map(place => place.name).join(', then ')}.` : ''}
          </p>
          <RouteOptions options={trip.options} selectedId={option.id} onSelect={chooseOption} />
        </section>
        {option.goal_note ? <div className="goal-notice" role="status">
          <p><strong>{option.goal_note}</strong></p>
          {option.over_goal_km > 0.5 ? <>
            <p>
              Adding {Math.ceil(option.over_goal_km / lastGoal)} more {Math.ceil(option.over_goal_km / lastGoal) === 1 ? 'day' : 'days'} at {formatMiles(lastGoal)} would cover it.
              You could also raise your daily goals above{trip.options.length > 1 ? ' or choose a shorter route option' : ''}.
            </p>
            <button type="button" className="button secondary" disabled={busy !== '' || plannedGoals.length >= maxDays} onClick={() => replanWith([...plannedGoals, lastGoal])}>
              Add day {plannedGoals.length + 1} ({formatMiles(lastGoal)}) and plan again
            </button>
          </> : option.unused_days ? (
            <button type="button" className="button secondary" disabled={busy !== ''} onClick={() => replanWith(plannedGoals.slice(0, plan.stages.length))}>
              Remove {option.unused_days === 1 ? 'the unneeded day' : 'the unneeded days'} and plan again
            </button>
          ) : null}
        </div> : null}
        {optionsOpen ? <form id="route-options-settings" className="route-adjust" onSubmit={commitAdjustments}>
          <h2>Days</h2>
          <div className="stepper goal-stepper">
            <button type="button" aria-label="Remove the last day" disabled={goals.length <= 1} onClick={() => resizeGoals(goals.length - 1)}>−</button>
            <span>{goals.length} {goals.length === 1 ? 'day' : 'days'}</span>
            <button type="button" aria-label="Add a day" disabled={goals.length >= maxDays} onClick={() => resizeGoals(goals.length + 1)}>+</button>
          </div>
          <h2>Progress each day</h2>
          <div className="pace goal-mode" role="group" aria-label="Daily goal type">
            <button type="button" className={goalKind === 'miles' ? 'is-selected' : ''} aria-pressed={goalKind === 'miles'} onClick={() => setGoalKind('miles')}>Miles per day</button>
            <button type="button" className={goalKind === 'hours' ? 'is-selected' : ''} aria-pressed={goalKind === 'hours'} onClick={() => setGoalKind('hours')}>{travelMode === 'cycling' ? 'Hours riding per day' : 'Hours walking per day'}</button>
          </div>
          {goalKind === 'hours' ? (
            <label className="goal-field hours-field">
              <span>Each day</span>
              <input type="number" required min={0.5} max={14} step={0.5} inputMode="decimal" value={hoursGoal > 0 ? hoursGoal : ''}
                onChange={event => setHoursGoal(Number(event.target.value))} />
              <span>hours</span>
            </label>
          ) : (
            <ol className="goal-list">{goals.map((goal, index) => <li key={index}>
              <label className="goal-field">
                <span>Day {index + 1}</span>
                <input type="number" required min={0.5} max={120} step={0.5} inputMode="decimal" value={goal > 0 ? Math.round(milesFromKm(goal) * 10) / 10 : ''}
                  onChange={event => setGoals(current => current.map((value, i) => i === index ? kmFromMiles(Number(event.target.value)) : value))} />
                <span>miles</span>
              </label>
            </li>)}</ol>
          )}
          <h2>Accommodation preferences</h2>
          <div className="pace stay-kind-toggles" role="group" aria-label="Accommodation types">
            {placeKinds.map(item => {
              const on = stayKinds.includes(item.kind);
              return <button type="button" key={item.kind} className={on ? 'is-selected' : ''} aria-pressed={on}
                onClick={() => setStayKinds(current => on ? current.filter(kind => kind !== item.kind) : [...current, item.kind])}>
                {item.label}
              </button>;
            })}
          </div>
          {stayKinds.length ? <label className="field">Look for these within<select value={miles} onChange={event => setMiles(Number(event.target.value))}>
            {radiusChoices.map(choice => <option key={choice} value={choice}>{radiusLabel(choice * KM_PER_MILE)}</option>)}
          </select></label> : <p className="quiet" role="status">Turn on at least one type of place to stay.</p>}
          <h2>Amenities</h2>
          <label className="toggle planner-toggle"><input type="checkbox" checked={showAmenityPins} onChange={event => setShowAmenityPins(event.target.checked)} />Show shops and facilities on the map</label>
          {amenitiesError ? <button type="button" className="button secondary" disabled={amenitiesBusy} onClick={() => setAmenitiesRefresh(value => value + 1)}>Retry shops and facilities</button> : null}
        </form> : null}
      </> : null}

      {showingOverview && trip && option && plan ? <>
        <div className="planner-results-bar">
          <button type="button" className="button secondary planner-back" aria-label="Back to options" onClick={backToOptions}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>Options</button>
        </div>
        <p className="eyebrow">Route details</p>
        <h1 ref={overviewRef} tabIndex={-1}>{option.label}</h1>
        <RouteSchematic plan={plan} selected={selected} />
        {option.rest_stops.some(stop => !stop.stay) ? <p className="stay-gap" role="status">
          <strong>No mapped {stayKindsLabel(trip.stay_kinds)} within {radiusLabel(trip.stay_radius_km)} on {
            option.rest_stops.filter(stop => !stop.stay).map(stop => `day ${stop.night}`).join(', ')
          }.</strong> The closest places are listed on those days.
        </p> : null}
        <div className="option-summary">
          <h3>{option.label} · {option.difficulty}</h3>
          <p>{plan.distance_km.toFixed(1)} km over {plan.stages.length} {plan.stages.length === 1 ? 'day' : 'days'} · {formatHours(plan.walking_hours)} {cycling ? 'riding' : 'walking'}
            {option.max_elevation_m !== null ? ` · highest point ${Math.round(option.max_elevation_m).toLocaleString('en-GB')} m` : ''}
            {option.steep_share_pct !== null ? ` · ${Math.round(option.steep_share_pct)}% of the distance steeper than 10%` : ''}</p>
          <ul className="difficulty-notes">{option.difficulty_notes.map(note => <li key={note}>{note}</li>)}</ul>
          <details>
            <summary>How difficulty and time are estimated</summary>
            <p className="quiet">Each day is rated from its distance plus {cycling ? 2 : 1} km for every 100 m of climbing: {cycling ? 'under 40 is Easy, under 70 Moderate, under 100 Challenging' : 'under 12 is Easy, under 22 Moderate, under 32 Challenging'}, then Strenuous. A sustained grade of {cycling ? '12%' : '25%'} or more over about 200 m adds one level. The route takes its hardest day’s rating. Time is distance ÷ pace plus 1 hour per 600 m of ascent, without breaks. These are Ratha estimates, not official grades.</p>
          </details>
        </div>

        <div className="save-route-panel">
          <button className="button" type="button" onClick={() => void saveToLibrary()} disabled={saveBusy || saved}>
            {saveBusy ? "Saving…" : saved ? "Saved to library" : "Save to library"}
          </button>
          <Link className="text-link" to="/library">Open route library</Link>
          {saveStatus ? <p role="status">{saveStatus}</p> : null}
        </div>

        <div className="weather-summary">
          <div className="weather-summary-heading"><h3>Weather along your route</h3><button type="button" className="button secondary" disabled={weatherBusy} onClick={() => setWeatherRefresh(value => value + 1)}>Refresh</button></div>
          {weatherBusy ? <p role="status">Checking forecasts along each daily stage…</p> : null}
          {weather ? <>
            <p>{weather.days.filter(day => day.warnings?.some(w => w.severity === 'severe')).length} days with severe forecast conditions · {weather.days.filter(day => day.status === 'unavailable').length} days without forecasts</p>
            <p className="quiet">{weather.notice}</p>
            <p className="quiet"><a href={weather.source_url} target="_blank" rel="noreferrer">{weather.source}</a> · Checked {new Date(weather.checked_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Forecasts update on refresh; data may be cached for 10 minutes.</p>
          </> : null}
          {weatherError ? <p role="alert">Forecast unavailable: {weatherError}</p> : null}
          <details><summary>Warning thresholds</summary><p className="quiet">Wind ≥50 km/h or gusts ≥65 km/h; severe at ≥65 / ≥80 km/h. Precipitation ≥20 mm/day; severe at ≥30 mm/day. Snowfall ≥1 cm/day, freezing minimums, or heat ≥30°C trigger caution. Thunderstorms and freezing precipitation trigger severe warnings. These are app thresholds, not official alerts.</p></details>
        </div>

        <div className="amenity-controls">
          <label className="toggle planner-toggle"><input type="checkbox" checked={showAmenityPins} onChange={event => setShowAmenityPins(event.target.checked)} />Show shops and facilities on the map</label>
          {amenitiesError ? <button type="button" className="button secondary" disabled={amenitiesBusy} onClick={() => setAmenitiesRefresh(value => value + 1)}>Retry shops and facilities</button> : null}
        </div>

        <h2 className="day-heading">Daily itinerary</h2>
        <div className="day-list">{plan.stages.map(stage => {
          const stop = option.rest_stops.find(item => item.night === stage.day);
          const goal = stage.goal_km ?? null;
          const over = goal ? stage.distance_km - goal : 0;
          const visits = stage.points.slice(1, -1).filter(point => point.name).map(point => point.name!);
          const last = stage.day === plan.stages.length;
          const steep = [stage.steepest_climb_pct != null ? `steepest climb ${Math.round(stage.steepest_climb_pct)}%` : '', stage.steepest_descent_pct != null ? `steepest descent ${Math.round(stage.steepest_descent_pct)}%` : ''].filter(Boolean).join(' · ');
          return <article key={stage.day} className={`day-card ${selected === stage.day ? 'selected-stage' : ''}`} style={{ borderLeft: `4px solid ${stageColors[(stage.day - 1) % stageColors.length]}` }}>
            <button type="button" className="stage-select" aria-pressed={selected === stage.day} onClick={() => selectDay(stage.day)}>
              <h3>Day {stage.day} · {new Date(`${stage.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
            </button>
            <p>{stage.distance_km.toFixed(1)} km{goal ? ` (goal ${goal} km)` : ''} · {formatHours(stage.walking_hours)}
              {stage.ascent_m === null ? ' · elevation unavailable' : ` · ↑ ${Math.round(stage.ascent_m)} m ↓ ${Math.round(stage.descent_m ?? 0)} m`}
              {stage.difficulty ? ` · ${stage.difficulty}` : ''}</p>
            {steep ? <p className="stage-steepness">{steep[0].toUpperCase() + steep.slice(1)} (sustained over about 200 m)</p> : null}
            {goal && over > Math.max(1, goal * 0.1) ? <p className="stage-goal-warning">{over.toFixed(1)} km more than this day’s goal.</p> : null}
            <ol className="stage-itinerary">
              <li>Start at {pointLabel(stage.points[0])} (km {stage.start_km.toFixed(1)}).</li>
              {visits.length ? <li>Visit {visits.join(', then ')}.</li> : null}
              <li>{last ? 'Finish' : 'End the day'} at {pointLabel(stage.points[stage.points.length - 1])} (km {stage.end_km.toFixed(1)}).{chosenStays[stage.day] ? ` Staying at ${chosenStays[stage.day].name}.` : ''}</li>
            </ol>
            <StageWeather day={weather?.days.find(day => day.day === stage.day)} loading={weatherBusy} error={weatherError} />
            {stop ? <RestStopDetails stop={stop} radiusKm={trip.stay_radius_km} addedStayIds={addedStayIds} addingStayId={addingStayId} placesFull={places.length >= maxPlaces} onAddStay={addStayToJourney} /> : null}
            {stop ? <details className="rated-stays-disclosure">
              <summary>Check Google ratings near this stop</summary>
              <RatedStays day={stage.day} endpointName={stop.stay?.name ?? ''} point={{ lat: stop.stay?.lat ?? stop.lat, lon: stop.stay?.lon ?? stop.lon }}
                selectedId={chosenStays[stage.day]?.id}
                onSelect={stay => setChosenStays(current => {
                  const next = { ...current };
                  if (stay) next[stage.day] = stay; else delete next[stage.day];
                  return next;
                })} />
            </details> : null}
            <StageAmenities
              along={(amenities?.along_route ?? []).filter(place => place.km >= stage.start_km && place.km < stage.end_km + (last ? 0.5 : 0))}
              near={stop ? amenities?.near_stops.find(item => item.night === stage.day)?.amenities ?? [] : null}
              night={stop ? stage.day : null}
              routeRadiusKm={amenities?.route_radius_km ?? 0.5} stopRadiusKm={amenities?.stop_radius_km ?? 2}
              loading={amenitiesBusy} error={amenitiesError} />
            <button type="button" className="button secondary" onClick={() => exportStage(stage)}>Download day {stage.day} GPX</button>
          </article>;
        })}</div>
        {amenities ? <p className="overnight-note">{amenities.notice} {amenities.attribution}.</p> : null}
      </> : null}
    </div>
    </div>
    <div className="planner-map" id="planner-map" ref={mapPanel}>
      <MapView plan={plan} selectedDay={selected} fitAllStages={selected === 0} alternatives={alternatives} onSelectAlternative={chooseOption} routePlaces={routePlaces} stops={stops} showPlaceControls={false} showNavigationControls={false}
        onSaveToTrip={(stop) => setPlaces((current) => current.some((place) => typeof place !== 'string' && Math.abs(place.lat - stop.latitude) < 1e-5 && Math.abs(place.lon - stop.longitude) < 1e-5) ? current : [...current, wildCampVisit(stop)])} />
      {trip ? <div className="map-attribution">{trip.attribution}</div> : null}
    </div>
  </section>;
}
