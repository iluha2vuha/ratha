# Ratha: Multi-Day Adventure Planner

Ratha is a hiking and cycling trip planner developed by our team during StrathHack 2026 for the SAS challenge. It brings route planning, daily stages, overnight stops and weather forecasts together around a map.

This is a portfolio copy of our hackathon submission. The application code has not been changed since the hackathon. Only this README and the files included for public sharing have been adjusted. API credentials, shared working documents and the original Git history are excluded.

## Our project

**Team name:** _Ratha_

**Team members:** Andrew Meechan, Nazar

**What we built:** A map-based planner for multi-day hiking and cycling trips, with daily distance goals, overnight stops, weather forecasts and GPX downloads.

**How to run it:**

Backend, from `backend` (use Python 3.11+ with TLS 1.3 support; on macOS use Homebrew Python rather than the system Python 3.9):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend, from `frontend`:

```powershell
npm install
npm run dev
```



**Map setup**

Generate your own API key at https://www.maptiler.com/ and create `frontend/.env` with:

```env
VITE_MAPTILER_KEY=your_maptiler_key_here
```

Use your own key rather than the team's hackathon key. Restrict it to the allowed origins for your app in your MapTiler account. Restart the frontend after changing the environment file.


Open https://localhost:5173 (the development server uses a local certificate). The dev server proxies `/api` to the backend on port 8000. API docs are at http://127.0.0.1:8000/docs.

Route planning geocodes Scottish place names with OpenStreetMap Nominatim and requests walking or cycling paths from Valhalla. Nominatim lookups are user-triggered, cached in the running API process, and paced to its public-service limit. The public Valhalla instance is for fair-use demo traffic; configure BOTHYBOUND_ROUTER_URL and BOTHYBOUND_GEOCODER_URL to switch providers. Generated tracks feed into the daily distance/effort planner and route forecasts. Saved route lists, profile, and community APIs remain sample stubs; settings are kept in memory until the server restarts.

Authentication supports email sign-up, sign-in, session lookup, and sign-out at `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, and `/api/auth/logout`. Accounts are stored in `backend/data/auth.sqlite3` (override with `BOTHYBOUND_AUTH_DB`); sessions use an HTTP-only cookie. Set `BOTHYBOUND_COOKIE_SECURE=1` when serving over HTTPS.

## Android app

`frontend/android` is a [Capacitor](https://capacitorjs.com/) project that packages the frontend as an installable APK. The app still uses the FastAPI backend, so the phone must be able to reach the computer running it.

You need Node 22+, JDK 21+ on the `PATH` or in `JAVA_HOME`, and the Android SDK (installed with Android Studio). The first build downloads Gradle and Android SDK 36. Opening `frontend/android` in Android Studio needs a version that supports Android Gradle Plugin 8.13; the command-line build does not need Android Studio.

1. Start the backend on all network interfaces, from `backend`, and allow Python through the firewall on private networks:

   ```powershell
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

   The phone and computer must be on the same network. A phone hotspot works; campus and guest Wi-Fi often stop devices reaching each other.
2. Find the computer's IPv4 address (`ipconfig`) and put it in `frontend/.env.android` (git-ignored), or set it as an environment variable:

   ```
   VITE_API_BASE_URL=http://192.168.1.20:8000
   ```

   The Android emulator reaches the computer at `http://10.0.2.2:8000`.
3. From `frontend`, run `npm run android:apk`. The APK is written to `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
4. Copy the APK to the phone and open it (allow installs from that app when asked), or with USB debugging on run `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

The backend address is compiled in, so rebuild after frontend changes or when the address changes. Debug APKs are signed with each computer's own debug key; to install a build from a different computer, uninstall the old app first.

In the app, API requests use Capacitor's native HTTP, so sign-in cookies work without CORS changes; leave `BOTHYBOUND_COOKIE_SECURE` unset when the backend uses plain HTTP. GPX downloads open the Android share sheet, and the map's location control asks for location permission.

## Multi-day planner

Open `/plan` and enter a start, a finish, any places you want to visit, a travel mode, pace, departure date, which kinds of place to stay to look for (campsites, bothies, hostels, hotels and guest houses), and how far to search (3, 5 or 10 miles). After the place names are entered, `POST /api/route/estimate` geocodes them and returns a straight-line distance plus a path allowance (35% hiking, 20% cycling). The page labels this as a rough estimate and uses the chosen pace to recommend miles per day or, if **Hours walking per day** is selected, how many days that time would take. Daily goals can be miles or hours; hours become distance as hours × pace before planning. **Plan route** then works through these steps:

1. Finds each place with Nominatim. Places to visit are put in the shortest straight-line order between start and finish, unless **Visit in the order listed** is ticked.
2. Asks Valhalla for start → places to visit → finish with up to four profiles: balanced, most direct, gentler climbs, and hill paths (hiking, up to SAC T3) or quieter tracks (cycling). With no places to visit, Valhalla's alternative route is added too. Near-identical lines are dropped, and the page says so.
3. For each option, ends each day where its goal is reached, counted from where the previous day actually ended. It then moves that rest stop to the best mapped bothy, campsite, hostel, hotel or guest house within the search distance, weighing how far that moves the day's end against how far the place is off the route. Named places are preferred over unnamed ones. If nothing is mapped within the search distance, the night says so and the daily route overview lists the closest mapped stays further away so you can add one to the journey. Nothing is invented.
4. Routes each option again through its chosen rest stops, so the line runs start → rest stops → finish and day distances include the detour.
5. Rates each option from Valhalla's 30 m elevation samples: ascent, descent, highest point, steepest sustained climb and descent over about 200 m, and the share of distance steeper than 10%. Each day's difficulty uses distance plus 1 km per 100 m of climbing (2 km when cycling). A sustained grade of 25% or more (12% cycling) adds one level, and the route takes its hardest day's rating. Moving time is distance ÷ pace plus 1 hour per 600 m of ascent, with no breaks. These are Ratha estimates, not official grades.

If a route is longer than the daily goals add up to, the option and the page say by how much and offer to add a day. Nothing changes until the user decides. If the route finishes early, the page offers to remove the unneeded days.

Selecting an option shows it in day colours on the map, with the other options as dashed lines; clicking a dashed line selects it. Each day lists distance against its goal, time, ascent, descent, steepness, difficulty, places visited, weather, the rest stop with other nearby places, an optional Google ratings search, shops and facilities, and a GPX download. If a night has no stay in range, the daily route overview warns and offers the closest mapped places; **Add to journey** adds that stay as a place to visit using its map coordinates and plans the route through it.

**Or use your own track** accepts one continuous GPX track (2-10,000 points, under 5 MB) or the illustrative demo track. It applies the same goals and rest-stop search, but the track is not re-routed, so detours to places to stay are not added.

API:

- `POST /api/route/estimate` takes `start`, `finish`, `points_of_interest`, `keep_order` and `mode`. It returns `straight_km`, `estimated_km`, `path_allowance` and a notice that this is not a walked route.
- `POST /api/route/plan` takes `start`, `finish`, `points_of_interest` (names or `{name, lat, lon}`), `keep_order`, `mode` (`hiking` or `cycling`), `daily_km` (one goal per day, up to 14), `start_date`, `pace` (`easy`, `steady`, `hard`), `stay_radius_km` and `stay_kinds` (`campsite`, `bothy`, `hostel`, `hotel`, `guest_house`; at least one). It returns `options`, each with a `plan` (the same stage format the weather, library and map use), `rest_stops` (including `nearest` stays when none are in range), steepness, difficulty and goal fields, plus `notices`.
- `POST /api/route/track` takes the same settings with `name` and `points`, and returns a single option.
- `POST /api/route/amenities` takes `line` (`[lat, lon]` pairs), `stops` (`night`, `lat`, `lon`) and `mode`. It returns shops, food and drink, drinking water, toilets and showers, pharmacies and medical, cash, post offices and transport within 500 m of the route, and within 2 km of each rest stop. Bike shops and repair stands are included when cycling.
- `POST /api/plan`, the older even-split stager, is still available.

Valhalla responses are cached for 10 minutes and calls are paced to one per second. Overpass results are cached for 10 minutes and fall back across mirrors.

Checks: from `backend`, install `requirements-dev.txt` then run `.venv/bin/python -m unittest discover -s tests`; from `frontend`, `npm run build`.

## Rated stays

Each night's rest stop has **Check Google ratings near this stop**. Results come from Google Places (New) via `GET /api/stays/nearby?endpoint=…` or `?lat=…&lon=…`: bothies, campsites, hostels and hotels within 20 km, with Google ratings and review counts where Google has them. Nothing is filled in when Google has no data. Rest stops themselves come from OpenStreetMap and need no key.

Google search needs a server-side key with billing and Places API (New) enabled. Copy [backend/env.example](backend/env.example) to `backend/.env`, set `GOOGLE_PLACES_API_KEY`, then restart the backend. The key never reaches the browser. Without it, rated stays report that they are not set up and the rest of the planner works as before. Results are cached for 30 minutes per location.

## Weather

The itinerary automatically requests Open-Meteo daily forecasts at the start, quarter, midpoint, three-quarter and finish of each stage, plus the highest recorded point. Weather cards show the temperature range and worst sampled daily precipitation, wind and gusts. Expand a card to inspect sample coordinates. GPX elevations are passed to the provider when present.

`POST /api/weather` accepts `stages` with `day`, `date`, and `points`. Past dates, dates beyond the 16-day forecast window, missing data and provider failures appear as unavailable rather than fabricated forecasts. Requests time out after 20 seconds and successful provider responses are cached for 10 minutes. Refresh retries forecasts without rebuilding the itinerary.

Warnings are Ratha planning heuristics, **not official weather alerts**: wind ≥50 km/h or gusts ≥65 km/h (severe ≥65 / ≥80); daily precipitation ≥20 mm (severe ≥30); snowfall ≥1 cm; minimum temperature ≤0°C; maximum ≥30°C; severe for thunderstorm or freezing-precipitation weather codes. Forecasts include overnight conditions and cannot cover every point or exposure along the route. Source and API details: https://open-meteo.com/en/docs.

## Overnight stays

The planner now chooses rest stops itself (see above). The older endpoint remains for other clients: it searches within 10 km of each non-final stage endpoint for mapped bothies, campsites, hostels, hotels, guest houses and motels. POST /api/overnight-stays accepts the itinerary's stages (day, points) and an optional radius_m (500-30,000; defaults to 10,000). Results link to the matching OpenStreetMap objects and include mapped operator, opening-hours, fee, access and contact details when available. Distances are straight-line estimates. Data comes from the public Overpass API and may be incomplete or stale; bothy listings are not verified by the Mountain Bothies Association, campsites are not wild-camping recommendations, and ratings/availability are not provided. Users should verify access, conditions and bookings before travel. © OpenStreetMap contributors.

The backend dependency pins have been corrected to the available, locally tested FastAPI 0.128.8 and Uvicorn 0.39.0 releases. The previous pins could not be installed from the package index.

## Credits

Developed collaboratively for StrathHack 2026 by the SAS-StrathHack26/team-5 team. Original project: https://github.com/SAS-StrathHack26/team-5. This source-only portfolio copy omits shared working documents and original Git history.
