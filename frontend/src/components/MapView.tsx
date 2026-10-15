import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { GeolocateControl, Map, Marker, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type GeoJSONSourceSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getPlaces, getWildCampingSuitability, resolveWildCampingPlace, type StayPlace, type WildCampingSuitability } from "../api";
import { PlaceCard, PlaceGlyph, createPlacePinSvg, facilityKinds, placeKinds } from "./PlaceCard";
import { stageColors, type Plan } from "../planner";
import type { WildCampTripStop } from "../sampleData";

setWorkerUrl(maplibreWorkerUrl);

const ukView = { longitude: -3.88048, latitude: 56.19527, zoom: 12.05, bearing: 0, pitch: 0 } as const;
const ukBounds: [[number, number], [number, number]] = [
  [-8.8, 49.7],
  [2.1, 61],
];
const permissionDenied = 1;
const candidateOffsets = [
  { latitude: 0.006, longitude: 0 },
  { latitude: -0.003, longitude: 0.009 },
  { latitude: -0.003, longitude: -0.009 },
] as const;

type CampLocation = { longitude: number; latitude: number };
type AssessmentState = "idle" | "loading" | "error" | "ready" | "water" | "land-check-unavailable";
type CandidateState = "idle" | "loading" | "ready" | "none";
type LandCheck = "land" | "water" | "unavailable";

const phoneGps: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 0,
};

const windowsLocation: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 20000,
  maximumAge: 120_000,
};

const ukMap = "uk-openzoomstack-road";

function styleFor(apiKey: string) {
  return `https://api.maptiler.com/maps/${ukMap}/style.json?key=${encodeURIComponent(apiKey)}`;
}

function addTerrain(map: Map, apiKey: string) {
  if (map.getSource("terrain")) return;
  map.addSource("terrain", {
    type: "raster-dem",
    url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(apiKey)}`,
  });
  map.setTerrain({ source: "terrain", exaggeration: 1.35 });
}

export type AlternativeRoute = { id: string; label: string; points: [number, number][] };
export type RouteStop = { id: string; kind: "start" | "finish" | "night" | "poi"; label: string; title: string; lat: number; lon: number };

function drawAlternatives(map: Map, alternatives: AlternativeRoute[]) {
  const data: Exclude<GeoJSONSourceSpecification["data"], string> = { type: "FeatureCollection", features: alternatives.map(route => ({
    type: "Feature", properties: { id: route.id, label: route.label },
    geometry: { type: "LineString", coordinates: route.points.map(([lat, lon]) => [lon, lat]) },
  })) };
  const source = map.getSource("route-alternatives") as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource("route-alternatives", { type: "geojson", data });
  if (!map.getLayer("route-alternatives-line")) map.addLayer({ id: "route-alternatives-line", type: "line", source: "route-alternatives",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#4d5751", "line-width": 4, "line-opacity": 0.8, "line-dasharray": [1.4, 1.2] } },
    map.getLayer("daily-stages-line") ? "daily-stages-line" : undefined);
}

function drawStages(map: Map, plan: Plan | null, selected: number) {
  const data: Exclude<GeoJSONSourceSpecification["data"], string> = { type: "FeatureCollection", features: (plan?.stages ?? []).map(stage => ({
    type: "Feature", properties: { day: stage.day, color: stageColors[(stage.day-1)%stageColors.length] },
    geometry: { type: "LineString", coordinates: stage.points.map(p => [p.lon, p.lat]) },
  })) };
  const source = map.getSource("daily-stages") as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource("daily-stages", { type: "geojson", data });
  if (!map.getLayer("daily-stages-line")) map.addLayer({ id: "daily-stages-line", type: "line", source: "daily-stages",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 5 } });
  const overview = !plan?.stages.some(stage => stage.day === selected);
  map.setPaintProperty("daily-stages-line", "line-width", overview ? 6 : ["case", ["==", ["get", "day"], selected], 9, 5]);
  map.setPaintProperty("daily-stages-line", "line-opacity", overview ? 1 : ["case", ["==", ["get", "day"], selected], 1, 0.55]);
}

function fitStage(map: Map, plan: Plan | null, selected: number, fitAllStages = false) {
  const day = plan?.stages.find(stage => stage.day === selected);
  const points = fitAllStages || !day ? plan?.stages.flatMap(stage => stage.points) : day.points;
  if (!points?.length) return;
  map.fitBounds([[Math.min(...points.map(p => p.lon)), Math.min(...points.map(p => p.lat))],
    [Math.max(...points.map(p => p.lon)), Math.max(...points.map(p => p.lat))]], { padding: { top: 60, bottom: 260, left: 60, right: 60 }, maxZoom: 14, pitch: 0 });
}

const noAlternatives: AlternativeRoute[] = [];
const noPlaces: StayPlace[] = [];
const noStops: RouteStop[] = [];

function categoryClass(category: WildCampingSuitability["category"]) {
  return category.toLowerCase();
}

function coordinateLabel(location: CampLocation) {
  return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
}

/** Screen map clicks against the rendered water layer before image analysis. */
function checkRenderedLand(map: Map | null, location: CampLocation): LandCheck {
  if (!map?.isStyleLoaded() || !map.areTilesLoaded()) return "unavailable";
  const point = map.project([location.longitude, location.latitude]);
  const waterTerms = ["water", "ocean", "sea", "lake", "river", "reservoir", "wetland"];
  const isWater = map.queryRenderedFeatures(point).some((feature) => {
    const values = [feature.layer?.id, feature.sourceLayer, feature.properties?.class, feature.properties?.kind, feature.properties?.type, feature.properties?.natural];
    return values.some((value) => waterTerms.some((term) => String(value ?? "").toLowerCase().includes(term)));
  });
  return isWater ? "water" : "land";
}

function flyToLocation(map: Map, location: CampLocation) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    map.once("idle", done);
    map.flyTo({ center: [location.longitude, location.latitude], zoom: Math.max(map.getZoom(), 12), essential: true });
    window.setTimeout(done, 2500);
  });
}

export function MapView({ plan = null, selectedDay = 1, fitAllStages = false, alternatives = noAlternatives, onSelectAlternative, routePlaces = noPlaces, stops = noStops, showPlaceControls = true, showNavigationControls = true, onSaveToTrip }: {
  plan?: Plan | null;
  selectedDay?: number;
  fitAllStages?: boolean;
  alternatives?: AlternativeRoute[];
  onSelectAlternative?: (id: string) => void;
  routePlaces?: StayPlace[];
  stops?: RouteStop[];
  showPlaceControls?: boolean;
  showNavigationControls?: boolean;
  onSaveToTrip?: (stop: WildCampTripStop) => void;
} = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const selectedCampMarkerRef = useRef<Marker | null>(null);
  const candidateMarkersRef = useRef<Marker[]>([]);
  const requestLocationRef = useRef<(() => void) | null>(null);
  const locationTracking = useRef(false);
  const routeRef = useRef({ plan, selectedDay, fitAllStages, alternatives, onSelectAlternative });
  routeRef.current = { plan, selectedDay, fitAllStages, alternatives, onSelectAlternative };
  const apiKey = import.meta.env.VITE_MAPTILER_KEY?.trim() ?? "";
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<'prompt' | 'blocked' | 'unavailable' | 'unsupported' | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationDismissed, setLocationDismissed] = useState(() => {
    try { return sessionStorage.getItem('ratha-location-dismissed') === 'true'; } catch { return false; }
  });
  function requestLocation() {
    requestLocationRef.current?.();
  }
  function dismissLocation() {
    setLocationDismissed(true);
    try { sessionStorage.setItem('ratha-location-dismissed', 'true'); } catch { /* Session storage can be unavailable. */ }
  }
  const [places, setPlaces] = useState<StayPlace[]>([]);
  const [facilities, setFacilities] = useState<StayPlace[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<StayPlace | null>(null);
  const [placeStatus, setPlaceStatus] = useState<string | null>(null);
  const [facilityStatus, setFacilityStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [facilityMenuOpen, setFacilityMenuOpen] = useState(false);
  const [wildCampOpen, setWildCampOpen] = useState(false);
  const wildCampOpenRef = useRef(false);
  wildCampOpenRef.current = wildCampOpen;
  const [hasSearched, setHasSearched] = useState(false);
  const [facilitiesSearched, setFacilitiesSearched] = useState(false);
  const [enabled, setEnabled] = useState<Record<(typeof placeKinds)[number]["kind"], boolean>>({
    campsite: true,
    bothy: true,
    hostel: true,
    hotel: true,
    guest_house: true,
  });
  const [facilityEnabled, setFacilityEnabled] = useState<Record<(typeof facilityKinds)[number]["kind"], boolean>>({
    water: true,
    food: true,
  });
  const placeRequest = useRef<AbortController | null>(null);
  const facilityRequest = useRef<AbortController | null>(null);
  const [assessmentLocation, setAssessmentLocation] = useState<CampLocation>({ longitude: ukView.longitude, latitude: ukView.latitude });
  const [suitability, setSuitability] = useState<WildCampingSuitability | null>(null);
  const [suitabilityState, setSuitabilityState] = useState<AssessmentState>("idle");
  const [candidateState, setCandidateState] = useState<CandidateState>("idle");
  const [candidateResults, setCandidateResults] = useState<WildCampingSuitability[]>([]);
  const [savedToTrip, setSavedToTrip] = useState(false);

  function clearCandidateMarkers() {
    candidateMarkersRef.current.forEach((marker) => marker.remove());
    candidateMarkersRef.current = [];
  }

  function resetCandidateSearch() {
    clearCandidateMarkers();
    setCandidateResults([]);
    setCandidateState("idle");
  }

  function setSelectedCampMarker(location: CampLocation) {
    const map = mapRef.current;
    if (!map) return;
    selectedCampMarkerRef.current?.remove();
    selectedCampMarkerRef.current = new Marker({ color: "#df6a37" })
      .setLngLat([location.longitude, location.latitude])
      .addTo(map);
  }

  async function assessLocation(location: CampLocation, locationName?: string) {
    const landCheck = checkRenderedLand(mapRef.current, location);
    if (landCheck === "water") {
      setSuitability(null);
      setSuitabilityState("water");
      return;
    }
    if (landCheck === "unavailable") {
      setSuitability(null);
      setSuitabilityState("land-check-unavailable");
      return;
    }
    setSuitabilityState("loading");
    setSavedToTrip(false);
    try {
      const result = await getWildCampingSuitability(location.latitude, location.longitude);
      setSuitability(locationName ? { ...result, locationName } : result);
      setSuitabilityState("ready");
    } catch {
      setSuitabilityState("error");
    }
  }

  async function selectAndAssess(location: CampLocation, locationName?: string) {
    setAssessmentLocation(location);
    setSelectedCampMarker(location);
    resetCandidateSearch();
    await assessLocation(location, locationName);
  }

  function useCandidate(result: WildCampingSuitability) {
    const location = { latitude: result.latitude, longitude: result.longitude };
    setAssessmentLocation(location);
    setSelectedCampMarker(location);
    setSuitability({ ...result, locationName: result.locationName ?? "Nearby candidate" });
    setSuitabilityState("ready");
    setSavedToTrip(false);
  }

  function showCandidateMarker(result: WildCampingSuitability) {
    const map = mapRef.current;
    if (!map) return;
    const element = document.createElement("button");
    element.type = "button";
    element.className = `wild-camp-candidate-marker ${categoryClass(result.category)}`;
    element.textContent = String(result.score);
    element.title = `${result.category}: ${result.score}/100`;
    element.setAttribute("aria-label", `Use nearby ${result.category.toLowerCase()} candidate scored ${result.score} out of 100`);
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      useCandidate(result);
    });
    candidateMarkersRef.current.push(new Marker({ element, anchor: "center" }).setLngLat([result.longitude, result.latitude]).addTo(map));
  }

  async function findNearbyCandidates() {
    const map = mapRef.current;
    if (!map || suitabilityState !== "ready") return;
    clearCandidateMarkers();
    setCandidateResults([]);
    setCandidateState("loading");
    const longitudeScale = Math.max(0.25, Math.cos((assessmentLocation.latitude * Math.PI) / 180));
    const locations = candidateOffsets.map((offset) => ({
      latitude: assessmentLocation.latitude + offset.latitude,
      longitude: assessmentLocation.longitude + offset.longitude / longitudeScale,
    })).filter((location) => checkRenderedLand(map, location) === "land");
    const responses = await Promise.all(locations.map(async (location) => {
      try {
        return await getWildCampingSuitability(location.latitude, location.longitude);
      } catch {
        return null;
      }
    }));
    const results = responses.filter((result): result is WildCampingSuitability => result !== null);
    results.forEach(showCandidateMarker);
    setCandidateResults(results);
    setCandidateState(results.length ? "ready" : "none");
  }

  async function searchAndAssessWildCamping(place: string) {
    setSuitabilityState("loading");
    try {
      const resolved = await resolveWildCampingPlace(place);
      const location = { longitude: resolved.longitude, latitude: resolved.latitude };
      setAssessmentLocation(location);
      setSelectedCampMarker(location);
      resetCandidateSearch();
      const map = mapRef.current;
      if (map) await flyToLocation(map, location);
      await assessLocation(location, resolved.locationName);
    } catch {
      setSuitabilityState("error");
    }
  }

  function saveToTrip() {
    if (!suitability || !onSaveToTrip) return;
    onSaveToTrip({
      name: suitability.locationName ?? `Wild camp check (${coordinateLabel(suitability)})`,
      latitude: suitability.latitude,
      longitude: suitability.longitude,
      score: suitability.score,
      category: suitability.category,
    });
    setSavedToTrip(true);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !apiKey) return;

    let disposed = false;
    let mapLoaded = false;
    let locationGranted = false;
    let requestPending = false;
    let permissionStatus: PermissionStatus | null = null;
    const map = new Map({
      container,
      style: styleFor(apiKey),
      center: [ukView.longitude, ukView.latitude],
      zoom: ukView.zoom,
      pitch: ukView.pitch,
      bearing: ukView.bearing,
      maxPitch: 85,
      maxBounds: ukBounds,
      attributionControl: { compact: true },
    });

    if (showNavigationControls) map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    const geolocate = new GeolocateControl({
      positionOptions: phoneGps,
      trackUserLocation: true,
      showUserLocation: true,
      fitBoundsOptions: { maxZoom: 14 },
    });
    map.addControl(geolocate, "top-right");

    map.addControl(new ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-left");

    geolocate.on("geolocate", () => {
      setLocationBusy(false);
      setLocationState(null);
      setLocationNote(null);
    });
    geolocate.on("trackuserlocationend", () => {
      locationTracking.current = false;
      setLocationBusy(false);
    });
    geolocate.on("trackuserlocationstart", () => {
      locationTracking.current = true;
      setLocationDismissed(false);
      setLocationBusy(true);
    });
    geolocate.on("error", (event) => {
      if (event.code === permissionDenied) {
        locationTracking.current = false;
        setLocationBusy(false);
        setLocationState('blocked');
        setLocationNote('Allow location for this site in your browser settings and turn on your device’s location services, then try again.');
        return;
      }
      if (geolocate.options.positionOptions?.enableHighAccuracy !== false) {
        geolocate.options.positionOptions = windowsLocation;
        window.setTimeout(() => {
          if (disposed) return;
          if (locationTracking.current) geolocate.trigger();
          geolocate.trigger();
        }, 0);
        return;
      }
      setLocationBusy(false);
      setLocationState('unavailable');
      setLocationNote('No location yet. Turn on your device’s location services and try again.');
    });

    map.on("style.load", () => {
      addTerrain(map, apiKey);
      drawStages(map, routeRef.current.plan, routeRef.current.selectedDay);
      drawAlternatives(map, routeRef.current.alternatives);
    });
    map.on("click", (event) => {
      setSelectedPlace(null);
      if (wildCampOpenRef.current) {
        void selectAndAssess({ longitude: event.lngLat.lng, latitude: event.lngLat.lat });
      }
    });
    map.on("click", "route-alternatives-line", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") routeRef.current.onSelectAlternative?.(id);
    });
    map.on("mouseenter", "route-alternatives-line", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "route-alternatives-line", () => { map.getCanvas().style.cursor = ""; });
    map.on("load", () => {
      mapLoaded = true;
      map.resize();
      if (routeRef.current.plan) fitStage(map, routeRef.current.plan, routeRef.current.selectedDay, routeRef.current.fitAllStages);
      else if (locationGranted) geolocate.trigger();
    });

    // Request permission directly: the map control may not be ready yet, and
    // checking Permissions API alone never opens the browser's permission dialog.
    const blockedNote = 'Location access is blocked. Open this site’s permissions in your browser, allow Location, and enable location services on your device. Then try again.';
    const showBlocked = () => {
      setLocationBusy(false);
      setLocationState('blocked');
      setLocationNote(blockedNote);
    };
    const requestPosition = (options: PositionOptions = phoneGps) => {
      navigator.geolocation.getCurrentPosition(() => {
        if (disposed) return;
        requestPending = false;
        locationGranted = true;
        setLocationBusy(false);
        setLocationState(null);
        setLocationNote(null);
        // Keep an existing planned route in view rather than moving its camera.
        if (mapLoaded && !routeRef.current.plan && !locationTracking.current) {
          geolocate.options.positionOptions = options;
          geolocate.trigger();
        }
      }, error => {
        if (disposed) return;
        if (error.code !== permissionDenied && options.enableHighAccuracy) {
          requestPosition(windowsLocation);
          return;
        }
        requestPending = false;
        if (error.code === permissionDenied) showBlocked();
        else {
          setLocationBusy(false);
          setLocationState('unavailable');
          setLocationNote('No location yet. Turn on your device’s location services and try again.');
        }
      }, options);
    };
    const askForLocation = () => {
      if (disposed || requestPending) return;
      setLocationDismissed(false);
      if (!window.isSecureContext || !navigator.geolocation) {
        setLocationState('unsupported');
        setLocationNote(!window.isSecureContext
          ? 'Open Ratha over HTTPS to enable location. Your browser cannot ask for location on this connection.'
          : 'This browser does not support location. Try opening Ratha in Safari, Chrome or another browser with location support.');
        return;
      }
      requestPending = true;
      setLocationBusy(true);
      setLocationState('prompt');
      setLocationNote('Allow location in your browser’s prompt to see where you are on the map.');
      requestPosition();
    };
    requestLocationRef.current = askForLocation;
    const checkPermission = async () => {
      if (!window.isSecureContext || !navigator.geolocation) {
        askForLocation();
        return;
      }
      try {
        permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
      } catch { /* Safari and other browsers may not support this permission query. */ }
      if (disposed) return;
      if (permissionStatus?.state === 'denied') showBlocked();
      else askForLocation();
      if (permissionStatus) permissionStatus.onchange = () => {
        if (disposed) return;
        if (permissionStatus?.state === 'denied') showBlocked();
        else askForLocation();
      };
    };
    // Defer one tick so React's development remount does not request twice.
    const permissionTimer = window.setTimeout(() => { void checkPermission(); }, 0);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    mapRef.current = map;

    return () => {
      disposed = true;
      window.clearTimeout(permissionTimer);
      if (permissionStatus) permissionStatus.onchange = null;
      requestLocationRef.current = null;
      locationTracking.current = false;
      placeRequest.current?.abort();
      facilityRequest.current?.abort();
      candidateMarkersRef.current.forEach((marker) => marker.remove());
      selectedCampMarkerRef.current?.remove();
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [apiKey, showNavigationControls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      drawStages(map, routeRef.current.plan, routeRef.current.selectedDay);
      drawAlternatives(map, routeRef.current.alternatives);
    };
    // isStyleLoaded() is also false while a GeoJSON source is loading, so wait rather than skip.
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [plan, selectedDay, alternatives]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) fitStage(map, plan, selectedDay, fitAllStages);
  }, [plan, selectedDay, fitAllStages]);

  const stopMarkersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    stopMarkersRef.current.forEach((marker) => marker.remove());
    stopMarkersRef.current = [];
    if (!map) return;
    stopMarkersRef.current = stops.map((stop) => {
      const element = document.createElement("div");
      element.className = `route-stop-marker is-${stop.kind}`;
      element.textContent = stop.label;
      element.title = stop.title;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", stop.title);
      return new Marker({ element, anchor: "bottom", offset: [0, -12] }).setLngLat([stop.lon, stop.lat]).addTo(map);
    });
  }, [stops]);

  const visiblePlaces = useMemo(
    () => places.filter((place) => placeKinds.some((item) => item.kind === place.kind) && enabled[place.kind as (typeof placeKinds)[number]["kind"]]),
    [places, enabled],
  );
  const placeCounts = useMemo(() => {
    const counts: Record<(typeof placeKinds)[number]["kind"], number> = { campsite: 0, bothy: 0, hostel: 0, hotel: 0, guest_house: 0 };
    for (const place of places) {
      const kind = place.kind as (typeof placeKinds)[number]["kind"];
      if (kind in counts) counts[kind] += 1;
    }
    return counts;
  }, [places]);
  const shownPlace = selectedPlace && (
    routePlaces.some((place) => place.id === selectedPlace.id) ||
    (placeKinds.some((item) => item.kind === selectedPlace.kind) ? enabled[selectedPlace.kind as (typeof placeKinds)[number]["kind"]] : facilityEnabled[selectedPlace.kind as (typeof facilityKinds)[number]["kind"]])
  ) ? selectedPlace : null;

  function searchView() {
    const map = mapRef.current;
    if (!map) return;
    setHasSearched(true);
    const bounds = map.getBounds();
    placeRequest.current?.abort();
    const request = new AbortController();
    placeRequest.current = request;
    setPlaceStatus("Looking for places in this view…");
    getPlaces(
      { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
      request.signal,
    )
      .then((result) => {
        if (request.signal.aborted) return;
        setPlaces(result.places);
        setSelectedPlace((current) => {
          if (!current || !placeKinds.some((item) => item.kind === current.kind)) return current;
          return result.places.some((place) => place.id === current.id) ? current : null;
        });
        setPlaceStatus(result.places.length ? null : "No campsites, bothies, or stays in this view.");
      })
      .catch((error: unknown) => {
        if (request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setPlaceStatus(error instanceof Error ? error.message : "Places could not be loaded.");
      });
  }

  function onPlacesClick() {
    setMenuOpen((open) => !open);
    setFacilityMenuOpen(false);
  }

  function openWildCampCheck() {
    setMenuOpen(false);
    setFacilityMenuOpen(false);
    setWildCampOpen(true);
  }

  function toggleKind(kind: (typeof placeKinds)[number]["kind"]) {
    setEnabled((current) => ({ ...current, [kind]: !current[kind] }));
    setSelectedPlace((current) => (current?.kind === kind && enabled[kind] ? null : current));
  }

  const visibleFacilities = useMemo(
    () => facilities.filter((place) => facilityEnabled[place.kind as (typeof facilityKinds)[number]["kind"]]),
    [facilities, facilityEnabled],
  );
  const facilityCounts = useMemo(() => {
    const counts: Record<(typeof facilityKinds)[number]["kind"], number> = { water: 0, food: 0 };
    for (const place of facilities) {
      const kind = place.kind as (typeof facilityKinds)[number]["kind"];
      if (kind in counts) counts[kind] += 1;
    }
    return counts;
  }, [facilities]);

  function searchFacilities() {
    const map = mapRef.current;
    if (!map) return;
    setFacilitiesSearched(true);
    const bounds = map.getBounds();
    facilityRequest.current?.abort();
    const request = new AbortController();
    facilityRequest.current = request;
    setFacilityStatus("Looking for facilities in this view…");
    getPlaces(
      { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
      request.signal,
      "facilities",
    )
      .then((result) => {
        if (request.signal.aborted) return;
        setFacilities(result.places);
        setSelectedPlace((current) => {
          if (!current || !facilityKinds.some((item) => item.kind === current.kind)) return current;
          return result.places.some((place) => place.id === current.id) ? current : null;
        });
        setFacilityStatus(result.places.length ? null : "No water or food in this view.");
      })
      .catch((error: unknown) => {
        if (request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setFacilityStatus(error instanceof Error ? error.message : "Facilities could not be loaded.");
      });
  }

  function onFacilitiesClick() {
    setFacilityMenuOpen((open) => !open);
    setMenuOpen(false);
  }

  function searchArea() {
    const map = mapRef.current;
    if (!map) return;
    const staysOn = placeKinds.some((item) => enabled[item.kind]);
    const facilitiesOn = facilityKinds.some((item) => facilityEnabled[item.kind]);
    if (map.getZoom() < 10) {
      placeRequest.current?.abort();
      facilityRequest.current?.abort();
      setPlaces([]);
      setFacilities([]);
      setSelectedPlace(null);
      setHasSearched(staysOn);
      setFacilitiesSearched(facilitiesOn);
      setPlaceStatus(staysOn ? "Zoom in to search this area." : null);
      setFacilityStatus(facilitiesOn ? "Zoom in to search this area." : null);
      return;
    }
    if (staysOn) searchView();
    else {
      placeRequest.current?.abort();
      setPlaces([]);
      setPlaceStatus(null);
      setSelectedPlace((current) => (current && placeKinds.some((item) => item.kind === current.kind) ? null : current));
    }
    if (facilitiesOn) searchFacilities();
    else {
      facilityRequest.current?.abort();
      setFacilities([]);
      setFacilityStatus(null);
      setSelectedPlace((current) => (current && facilityKinds.some((item) => item.kind === current.kind) ? null : current));
    }
  }

  function toggleFacility(kind: (typeof facilityKinds)[number]["kind"]) {
    setFacilityEnabled((current) => ({ ...current, [kind]: !current[kind] }));
    setSelectedPlace((current) => (current?.kind === kind && facilityEnabled[kind] ? null : current));
  }

  useEffect(() => {
    if (!menuOpen && !facilityMenuOpen && !wildCampOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setFacilityMenuOpen(false);
        setWildCampOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, facilityMenuOpen]);

  const markersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    if (!map) return;
    const searched = [...visiblePlaces, ...visibleFacilities];
    const ids = new Set(searched.map((place) => place.id));
    markersRef.current = [...searched, ...routePlaces.filter((place) => !ids.has(place.id))].map((place) => {
      const button = document.createElement("button");
      button.type = "button";
      const selected = selectedPlace?.id === place.id;
      button.className = `place-pin${selected ? " is-selected" : ""}`;
      button.append(createPlacePinSvg(place.kind, selected));
      button.title = place.name;
      button.setAttribute("aria-label", `${place.kind_label}: ${place.name}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedPlace(place);
      });
      return new Marker({ element: button, anchor: "center" }).setLngLat([place.lon, place.lat]).addTo(map);
    });
  }, [visiblePlaces, visibleFacilities, routePlaces, selectedPlace]);

  if (!apiKey) {
    return (
      <div className="map-canvas map-fallback">
        <div className="map-fallback-card">
          <p className="eyebrow">MapTiler</p>
          <h2>Add a MapTiler key to load the Highlands.</h2>
          <p className="quiet">
            Create a free key, put it in <code>frontend/.env</code> as <code>VITE_MAPTILER_KEY</code>, then restart
            the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-stage">
      <div ref={containerRef} className="map-canvas" aria-label="Map of the Scottish Highlands" />
      <div className="map-top-overlay">
        {!locationDismissed && (locationNote || locationBusy) ? <aside className="map-location-note" aria-label="Location access">
          <strong>{locationState === 'blocked' ? 'Location is blocked' : locationState === 'unavailable' || locationState === 'unsupported' ? 'Location unavailable' : 'See your location'}</strong>
          <p role="status">{locationNote ?? 'Finding your location…'}</p>
          <div className="location-actions">
            {locationState && locationState !== 'unsupported' ? <button type="button" className="button" disabled={locationBusy} onClick={requestLocation}>
              {locationBusy ? 'Finding location…' : locationState === 'prompt' ? 'Enable location' : 'Try again'}
            </button> : null}
            <button type="button" className="text-link location-dismiss" onClick={dismissLocation}>Not now</button>
          </div>
        </aside> : null}
        {showPlaceControls ? <div className="place-controls">
          <div className="place-button-row">
            <button
              type="button"
              className={`place-search${menuOpen ? " is-open" : ""}`}
              aria-expanded={menuOpen}
              aria-controls="place-type-menu"
              onClick={onPlacesClick}
            >
              Places
              <span className="place-chevron" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`place-search${facilityMenuOpen ? " is-open" : ""}`}
              aria-expanded={facilityMenuOpen}
              aria-controls="facility-type-menu"
              onClick={onFacilitiesClick}
            >
              Facilities
              <span className="place-chevron" aria-hidden="true" />
            </button>
            <button type="button" className="place-search place-search-go" onClick={searchArea}>
              Search this area
            </button>
          </div>
          {menuOpen ? (
            <div id="place-type-menu" className="place-type-menu" role="group" aria-label="Place types in this view">
              <p className="place-menu-note">
                {placeStatus ??
                  (!hasSearched
                    ? "Press Search this area to look here."
                    : placeKinds.some((item) => enabled[item.kind])
                      ? `${visiblePlaces.length} ${visiblePlaces.length === 1 ? "place" : "places"} in this view`
                      : "Turn on a place type to show pins.")}
              </p>
              {placeKinds.map((item) => (
                <label key={item.kind} className="place-toggle">
                  <PlaceGlyph kind={item.kind} />
                  <span>{item.label}</span>
                  {hasSearched && placeStatus !== "Looking for places in this view…" ? (
                    <span className="place-count">{placeCounts[item.kind]}</span>
                  ) : null}
                  <input
                    type="checkbox"
                    role="switch"
                    checked={enabled[item.kind]}
                    onChange={() => toggleKind(item.kind)}
                  />
                </label>
              ))}
              <button type="button" className="place-toggle wild-camp-menu-option" onClick={openWildCampCheck}>
                <span className="wild-camp-menu-icon" aria-hidden="true">⛺</span>
                <span>Wild camp check</span>
                <span className="wild-camp-menu-detail">AI estimate</span>
              </button>
              <p className="place-menu-credit">Place data © OpenStreetMap contributors</p>
            </div>
          ) : null}
          {facilityMenuOpen ? (
            <div id="facility-type-menu" className="place-type-menu" role="group" aria-label="Facilities in this view">
              <p className="place-menu-note">
                {facilityStatus ??
                  (!facilitiesSearched
                    ? "Press Search this area to look here."
                    : facilityKinds.some((item) => facilityEnabled[item.kind])
                      ? `${visibleFacilities.length} ${visibleFacilities.length === 1 ? "place" : "places"} in this view`
                      : "Turn on a facility to show pins.")}
              </p>
              {facilityKinds.map((item) => (
                <label key={item.kind} className="place-toggle">
                  <PlaceGlyph kind={item.kind} />
                  <span>{item.label}</span>
                  {facilitiesSearched && facilityStatus !== "Looking for facilities in this view…" ? (
                    <span className="place-count">{facilityCounts[item.kind]}</span>
                  ) : null}
                  <input
                    type="checkbox"
                    role="switch"
                    checked={facilityEnabled[item.kind]}
                    onChange={() => toggleFacility(item.kind)}
                  />
                </label>
              ))}
              <p className="place-menu-credit">Place data © OpenStreetMap contributors</p>
            </div>
          ) : null}
        </div> : null}
      </div>
      {shownPlace ? <PlaceCard place={shownPlace} onClose={() => setSelectedPlace(null)} /> : null}
      {wildCampOpen ? <WildCampingCard
        location={assessmentLocation}
        result={suitability}
        state={suitabilityState}
        candidateState={candidateState}
        candidates={candidateResults}
        savedToTrip={savedToTrip}
        canSaveToTrip={Boolean(onSaveToTrip)}
        onAssess={() => void selectAndAssess(assessmentLocation)}
        onSearch={(place) => void searchAndAssessWildCamping(place)}
        onFindNearby={() => void findNearbyCandidates()}
        onUseCandidate={useCandidate}
        onSaveToTrip={saveToTrip}
        onClose={() => setWildCampOpen(false)}
      /> : null}

    </div>
  );
}

type WildCampingCardProps = {
  location: CampLocation;
  result: WildCampingSuitability | null;
  state: AssessmentState;
  candidateState: CandidateState;
  candidates: WildCampingSuitability[];
  savedToTrip: boolean;
  canSaveToTrip: boolean;
  onAssess: () => void;
  onSearch: (place: string) => void;
  onFindNearby: () => void;
  onUseCandidate: (result: WildCampingSuitability) => void;
  onSaveToTrip: () => void;
  onClose: () => void;
};

function WildCampingCard({ location, result, state, candidateState, candidates, savedToTrip, canSaveToTrip, onAssess, onSearch, onFindNearby, onUseCandidate, onSaveToTrip, onClose }: WildCampingCardProps) {
  const [place, setPlace] = useState("");
  function submitPlaceSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = place.trim();
    if (query) onSearch(query);
  }

  return <aside className="wild-camp-card" aria-live="polite">
    <div className="wild-camp-heading">
      <div><p className="eyebrow">Wild camp check</p><h2>AI-estimated suitability</h2></div>
      <button className="wild-camp-close" type="button" aria-label="Close Wild camp check" onClick={onClose}>×</button>
    </div>
    <p className="wild-camp-location">Click the map or assess map centre · {coordinateLabel(location)}</p>
    <form className="wild-camp-search" onSubmit={submitPlaceSearch}>
      <label htmlFor="wild-camp-place">Find a place to assess</label>
      <div>
        <input id="wild-camp-place" value={place} onChange={(event) => setPlace(event.target.value)} placeholder="e.g. Corrour Station" />
        <button type="submit" disabled={!place.trim() || state === "loading"}>Search & assess</button>
      </div>
    </form>
    <button className="wild-camp-check" type="button" disabled={state === "loading"} onClick={onAssess}>
      {state === "loading" ? "Checking land and imagery…" : "Assess this location"}
    </button>
    {state === "water" ? <p className="wild-camp-water">Water is shown at this point on the map. Pick a land location before assessing terrain.</p> : null}
    {state === "land-check-unavailable" ? <p className="wild-camp-error">The map terrain is still loading, so this point has not been assessed. Try again shortly.</p> : null}
    {state === "error" ? <p className="wild-camp-error">Could not find or assess this location. Try again in a moment.</p> : null}
    {result ? <div className="wild-camp-result">
      <div className={`wild-camp-score-card ${categoryClass(result.category)}`}>
        <span>AI-estimated suitability</span><strong>{result.score}<small>/100</small></strong><b>{result.category}</b>
      </div>
      {result.locationName ? <p className="wild-camp-result-place">{result.locationName}</p> : null}
      <ul className="wild-camp-facts">
        {result.positives.map((item) => <li key={item} className="positive">✓ {item}</li>)}
        {result.cautions.map((item) => <li key={item} className="caution">⚠ {item}</li>)}
      </ul>
      <p className="wild-camp-source">{result.imageCount} nearby image{result.imageCount === 1 ? "" : "s"} ·</p>
      <section className="wild-camp-image-list" aria-label="Nearby Geograph image assessments">
        {result.sampledImages.map((image) => <article key={image.id} className="wild-camp-image-assessment">
          {image.imageUrl ? <a href={image.sourceUrl ?? image.imageUrl} target="_blank" rel="noreferrer" title={`Open ${image.title} on Geograph`}><img src={image.imageUrl} alt={image.title} loading="lazy" /></a> : <div className="wild-camp-image-placeholder">No live Geograph image</div>}
          <div>
            <strong>{image.assessment.category} · {image.assessment.score}/100</strong>
            <span>{image.distanceKm === null ? "Distance unavailable" : `${image.distanceKm.toFixed(2)} km away`}</span>
            <p>{image.assessment.positives[0] ?? "Mixed terrain signals"}</p>
            {image.assessment.cautions[0] ? <p className="caution">⚠ {image.assessment.cautions[0]}</p> : null}
            {image.credit ? <small>© {image.credit}, Geograph</small> : null}
          </div>
        </article>)}
      </section>
      {result.isDemo ? <p className="wild-camp-demo">Demo estimate — mock imagery or terrain analysis is in use. Check the provider labels before relying on the result.</p> : null}
      <button className="wild-camp-nearby" type="button" disabled={candidateState === "loading"} onClick={onFindNearby}>{candidateState === "loading" ? "Checking nearby land…" : "Find better nearby locations"}</button>
      {candidateState === "ready" ? <div className="wild-camp-candidates" aria-label="Nearby candidate scores">
        {candidates.map((candidate) => <button key={`${candidate.latitude}-${candidate.longitude}`} type="button" onClick={() => onUseCandidate(candidate)}><span className={categoryClass(candidate.category)}>{candidate.score}</span>{candidate.category} candidate</button>)}
        <p>Scores are also shown on the map. They compare imagery signals only.</p>
      </div> : null}
      {candidateState === "none" ? <p className="wild-camp-no-images">No nearby land candidates could be assessed.</p> : null}
      {canSaveToTrip ? <><button className="wild-camp-save" type="button" onClick={onSaveToTrip}>Save to my trip</button>{savedToTrip ? <p className="wild-camp-saved">Added to the trip planner.</p> : null}</> : null}
      <p className="wild-camp-restrictions">Terrain imagery is insufficient to confirm safety. Access rules, landowner permission, weather, flood risk and local camping restrictions have not been verified.</p>
      <p className="wild-camp-disclaimer">{result.disclaimer}</p>
    </div> : null}
  </aside>;
}
