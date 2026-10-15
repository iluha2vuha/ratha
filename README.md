# Ratha

A map-based planner for multi-day hiking and cycling trips, built during **StrathHack 2026** for the SAS challenge.

Plan a route, split it into daily stages, find overnight stops, check weather forecasts and download GPX tracks.

This is a portfolio copy of the [team's original project](https://github.com/SAS-StrathHack26/team-5). The application code is unchanged from the hackathon. The README has been simplified, and credentials and shared working documents are excluded.

## Run locally

You need Python 3.11+ and Node.js 22+.

Start the backend:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

On Windows, use `python` instead of `python3` and activate with `.venv\Scripts\Activate.ps1`.

In another terminal, start the frontend:

```sh
cd frontend
npm install
npm run dev
```

Open [https://localhost:5173](https://localhost:5173).

## Map key

Create your own [MapTiler API key](https://www.maptiler.com/) and add it to `frontend/.env`:

```env
VITE_MAPTILER_KEY=your_maptiler_key_here
```

Restrict the key to your app's allowed origins and restart the frontend.

Google ratings are optional. To enable them, copy `backend/env.example` to `backend/.env` and set your own `GOOGLE_PLACES_API_KEY` with Places API (New) enabled.

## About the prototype

Built with React, TypeScript, Vite and FastAPI. Routes and places use OpenStreetMap data and Valhalla, and forecasts come from Open-Meteo.

Some library, profile and community features use sample data. Check route conditions, access and forecasts before travelling.
