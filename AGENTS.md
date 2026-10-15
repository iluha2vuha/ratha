# Working on Ratha

Ratha is a map-first hiking and cycling trip planner. The frontend is React,
TypeScript and Vite in `frontend/`; the FastAPI backend is in `backend/`.

## Before changing the interface

Read [the design guide](docs/design-guide.md). It defines the green prototype,
its research references, shared tokens, component rules and review checklist.
Use that guide for every screen, including loading, empty and error states.

- The primary brand colour is **#006400**. Use the shared CSS tokens.
- Keep the map central and actions specific to planning a trip.
- Reuse existing components and controls before adding another visual pattern.
- Keep API health badges and implementation jargon out of the app header.
- Label illustrative content; never turn missing data into invented values.
- Preserve routing, planner, weather and authentication behaviour during styling work.

## Where to work and how to check

- Shared theme and component styles: `frontend/src/index.css`.
- App navigation: `frontend/src/components/Layout.tsx`.
- Day/route colour mapping: `frontend/src/planner.ts`.
- Design discussion preview: `docs/prototypes/ratha-forest.html`.
  This is a conversation preview, not an application entry point.
- Android packaging: `frontend/android` (Capacitor) and `frontend/capacitor.config.ts`.
  `npm run android:apk` builds a debug APK; see the README for the backend address.
- After frontend changes, run `npm run build` from `frontend/`.
- When browser access is available, review the affected screens using the
  checklist in the guide. Report any checks that could not be performed.

Update the guide when an accepted design decision changes. Keep prototype
alternatives separate from the implemented design, and follow the user's
current instructions about running, committing and pushing.
