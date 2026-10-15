# Ratha design guide

Status: Forest screenshot implementation, 10 October 2026. This is the shared reference
for people and agents changing the interface. The user selected **#006400**.
The design should feel calm, useful and connected to the outdoors.

## The direction

Use the six user-supplied Forest iPhone screenshots (IMG_8463–IMG_8468)
as the direct visual reference. The accepted direction replaces the earlier
restrained prototype: full-screen map, floating white pill navigation with a
raised circular planning action, a white side drawer, cream bottom sheets,
dark green outlines, and solid downward shadows on actionable buttons.
Preserve Ratha's existing headings and labels; uppercase is a CSS treatment.
Keep routing, GPX, itinerary, forecasts, account and settings behaviour.

Ratha retains its route mark and **#006400** primary brand colour. Forest's
logo, bike-rental copy, prices and account statistics are not Ratha data.
The screenshots are visual references; do not add rental features or invented
values to imitate them. The centre navigation action opens the existing planner.

## Colour tokens

The source of truth is `frontend/src/index.css`. Use `var(...)` in components;
do not scatter hex values through new page styles.

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--brand` | `#006400` | `#006400` | Primary action fill; stable brand identity |
| `--brand-on` | `#ffffff` | `#ffffff` | Text on the primary action |
| `--brand-hover` | `#004d00` | `#004d00` | Primary action hover |
| `--accent` | `var(--brand)` | `#afd69b` | Links, focus, selected text and route mark |
| `--bg` | `#fff9f1` | `#121a14` | Page background |
| `--surface` | `#fff9f1` | `#1b261d` | Controls and map sheets |
| `--ink` | `#003b33` | `#f3f5ec` | Main text |
| `--muted` | `#606964` | `#b4bdad` | Supporting text |
| `--line` | `#dce4df` | `#3e4d3d` | Quiet separators, not an interactive boundary by itself |
| `--fill` | `#e1f2ec` | `#263228` | Neutral inset and selected itinerary row |
| `--fill-strong` | `#d1e9df` | `#344335` | Neutral hover |
| `--chip` | `#e1f2ec` | `#2d422b` | Soft navigation selection |
| `--ok` | `#236c3f` | `#6dce8b` | Confirmed success, accompanied by text |
| `--danger` | `#a33330` | `#ffb2a7` | Errors and severe conditions |
| `--danger-fill` | `#f9eeea` | `#382724` | Error surface |
| `--warning` | `#806015` | `#e7c572` | Caution indicators |

Use `--brand` with `--brand-on` for buttons. Use `--accent` for text on a neutral
surface: dark green text is difficult to read on dark backgrounds. Do not use
`--inverse` as a substitute for primary button text.

White on `#006400` is **7.44:1**. Recheck secondary text against the current
cream and dark surfaces after palette changes; these pairings are not a
complete accessibility audit. `--control` is white in light mode and a dark
surface in dark mode. `--outline` supplies the dark green/light green outlines.
`--shadow` is a solid 4px downward offset, with no blur.

Day colours are categorical, not decoration. Use the saturated, high-contrast
palette in `stageColors` from `frontend/src/planner.ts` in the map, day controls
and itinerary so stage lines remain easy to distinguish over map terrain. The
palette starts with the brand dark green and avoids orange and blue, which can
be confused with route infrastructure and water. Keep the same mapping and show
“Day 1”, “Day 2”, etc. Colour alone must not identify a stage.
Weather severity has its own meaning; never recolour severe warnings green.

## Type, spacing and shape

- Keep **Manrope** for rounded body text. Use **Barlow 900 italic** for display
  headings and actions to match Forest's heavy italic lettering, with system
  fallbacks. Do not rewrite headings to achieve uppercase; use CSS.
- Body: 16px, weight 400, line height 1.5. Page headings: 28–45px.
- Use 4, 8, 12, 16, 20, 24, 32 and 48px spacing.
- Inputs: 16px radius and a visible outline. Buttons and navigation: pill shape.
  Sheets: 28px upper corners, dark green outline and a small grab handle.
- Use a 1.5–2px outline for controls and selected sheets. Primary and secondary
  buttons have a solid 4px offset shadow. Ordinary lists have no shadow.
- Keep the route mark and lowercase wordmark. The accessible name stays Ratha.
- The side menu is a native modal dialog with keyboard trapping, Escape close
  and focus restoration. Links and navigation retain visible text labels.

## Components and screens

| Area | Rule |
| --- | --- |
| Navigation | Floating white/dark bottom pill: Menu / Explore / Plan a trip / Community / Profile or Sign in. The centre planning action is raised and circular. The logo appears only in the menu. There is no top brand bar; map and page surfaces extend to the top on every screen. The menu links include Library, Settings and signed-in Log out. |
| Explore | Real MapLibre basemap fills the available space. Open trip planning with the central “Plan a trip” navigation action. Keep the map free of a duplicate planning button or start/finish popup. Keep attribution and the location control visible. When location permission is undecided, request it directly through the browser as the map opens, without waiting for tiles or a map-control click. Keep an “Enable location” fallback with “Not now” for browsers that require a click. Use the same location banner at the top of every map screen, with matching spacing, width, copy and actions. On Explore, stack Places, Facilities and area search below the banner; keep them at the top when the banner is hidden. When blocked, explain browser/device settings and offer retry; react to permission changes. Explain that insecure connections need HTTPS. Remember dismissal of the supporting banner for the session; it must not suppress the native permission request. Keep Places, Facilities and “Search this area” on Explore. Remove zoom buttons and the compass from Explore and the planner; map gestures still work. |
| Planner | Desktop panel up to 430px wide beside the map. Below 1000px, let the map fill the viewport behind a cream bottom sheet. Drag the sheet’s 44px top edge with touch or a mouse to collapse, reopen or expand it; tap or use the keyboard as an alternative. Keep the edge available above navigation when collapsed. Fit the planner to the viewport and scroll its controls and results independently, with enough bottom padding to reach content above the navigation. Omit “Back to map”; use Explore in the navigation to return. Hide Places, Facilities and area search in the planner map. This is the single trip planning form; do not add an intermediate start/finish popup on Explore. After a successful plan, replace the form with route options and focus that step. Choosing an option opens route details (summary, weather, stays and the daily itinerary) and focuses it. Planning and Options back controls return to the previous step. Preserve start, finish, places to visit, travel mode, pace, departure date, a miles-or-hours daily goal toggle, accommodation type toggles, the stay search distance and GPX import. Show a labelled rough distance estimate (straight-line plus a path allowance) and a recommendation of miles per day or days needed; never present that estimate as a walked route. Route options are outlined, selectable rows (`aria-pressed`) with distance, days, time, ascent/descent, steepest grades, an elevation sparkline, a text difficulty tag, and rest-stop and goal status. The selected option is drawn in day colours; other options are dashed grey lines. When a route exceeds the daily goals, say by how much and offer actions; never add days silently. |
| Daily itinerary | Ordered rows with day/date, distance against its goal, time, ascent/descent and steepness when available, difficulty, named endpoints, places visited, forecast, the rest stop (or a clear “no mapped places to stay within …” note), shops and facilities, and GPX download. Selecting a day visibly highlights its row and corresponding map stage. |
| Route details | On the planner, this is the route details step, not a card over the map. Show the daily schematic, real distance, time, climb, steepness and difficulty, named stopping places, and mapped shops and facilities. Do not invent utilities or stats. Warn when a night has no mapped place to stay within the search distance, and list the closest mapped stays with a real distance and an Add to journey action. Selecting a day highlights its row and map stage. The saved-route map may keep its own Hide/Show card. |
| Forecast | Compact values with units, source and checked time. Put relevant warnings beside the day. Missing forecast is “Forecast unavailable”, never a sunny icon or zero temperature. |
| Saved routes | Keep device storage, account sync, GPX downloads and the interactive map. Library is accessible through the menu. Route summaries use the shared outlined sheets and stay above the floating navigation. The saved-route map can hide or show its route card; hiding it keeps that map clear. The planner does not float a second details card over the map. |
| Places | Preserve Places and Facilities filters and “Search this area”; style them with shared outlined pills. A single detail sheet for the selected place. Keep category labels, external details and loading/no-results messages. Avoid stacking competing sheets over the same map area. |
| Community | Plain readable notes with author, time and route context. Label sample stories and local-only notes. No blank decorative image banner. |
| Profile | Label sample stats, badges, route history and friends. Show a photo only when an actual photo asset exists. |
| Settings and sign-in | Use the same inputs, buttons, colours and spacing. Settings has distinct loading, loaded and failed-to-load copy. |

The compact sheet variants in `docs/prototypes/ratha-forest.html` are options
for discussion, not extra screens or approved changes to the planner flow.

## Copy and data states

Use concrete verbs and familiar route language. “Plan route”, “Add stop”,
“Build daily itinerary” and “Download day 2 GPX” explain the result of an action.
Avoid “Unlock your adventure”, “Seamless experiences” and claims about AI.

| State | Example / expected behaviour |
| --- | --- |
| Empty | “Choose a start and finish to plan your route.” Preserve the controls needed to begin. |
| Busy | “Finding a route…” or “Checking forecasts…”. Disable only the action that cannot safely repeat. |
| Failed | Explain what failed and offer the relevant retry. Keep entered places, date and preferences. Avoid exposing raw internals when a useful message is possible. |
| Missing value | “Elevation unavailable” or “No mapped overnight options nearby.” Do not render missing data as zero. |
| Sample | Label illustrative routes, activity and notes near their content. Sample distance and weather are not verified travel information. |
| Saved | Say where it is saved. “Saved on this page only. Reloading clears this note.” matches the current community implementation. |

Do not remove necessary provenance or forecast limitations to make a screen
look cleaner. Put supporting detail below the main value or in a labelled
disclosure. Do not introduce new disclaimers unrelated to the actual feature.

## Avoiding a generic template

These are design review signals, not evidence that an app was made with AI:

- A heading and supporting line that could describe any product. Name the route,
  day or action instead.
- Every section in an identical rounded card. Use aligned lists for comparing
  daily stages, and bounded sheets for selected details.
- Repeated icon circles, empty photo blocks, gradients, glass effects and huge
  shadows that add no information. Remove decoration without a functional role.
- Large marketing headings inside an operational planner. Give the route and
  current task priority.
- Different buttons, labels, radii or spacing on each page. Reuse shared rules.
- A beautiful default state with no empty, busy, failed or long-content state.
  Review the awkward cases before calling the design finished.
- Invented ratings, route facts, user activity or sunny forecasts to fill space.
  Keep uncertainty and samples explicit.

A useful test: would this screen still communicate its purpose if the decorative
treatment disappeared? Can a person find the next action without reading a slogan?

## Implementation and review

Edit shared rules in `frontend/src/index.css` and reuse components in
`frontend/src/components/`. The Forest screenshot treatments are grouped at the
end of the stylesheet. When refining them, edit that group or consolidate the
corresponding base rule; do not add an endless chain of overriding blocks.
Keep visual changes separate from route calculation and network behaviour.

- Run `npm run build` in `frontend/` after frontend edits.
- Review 320px, 390px, 768px and 1440px widths, light and dark appearances.
- Check the signed-in header and guest header. Long names and place names must
  wrap without obscuring controls. Mobile navigation must fit without clipping.
- Use native labelled buttons and form fields. Keep visible keyboard focus,
  pressed/selected semantics and loading announcements.
- Aim for 44px touch targets for main controls. WCAG 2.2 AA's minimum is 24px
  with exceptions; 44px is this project's more generous target, not that minimum.
- Target at least 4.5:1 contrast for ordinary text; check actual foreground and
  background pairs. Decorative dividers do not serve as a focus indicator.
- Check long itineraries, unavailable elevation/forecast, severe weather, empty
  nearby places, failed sign-in and local-only community notes.
- Honour reduced motion. Do not animate panels into place merely for polish.
- Preserve map attribution, native map interactions and GPX download actions.
- Report visual verification separately from compilation. A successful build
  does not demonstrate that layouts were visually reviewed.

## Research notes

Reviewed for this prototype on 10 October 2026. Observations below inform
Ratha's choices; they do not prescribe a copy of another product.

1. **Forest primary references:** [official website](https://forest.bike/) and
   [official App Store screenshots](https://apps.apple.com/gb/app/forest-ebike-sharing/id6443626172).
   The inspected map and rental screenshots place the map first, use compact
   controls and a cream lower sheet, and reserve a strong green button for the
   main action. This is visual observation; the palette here is Ratha's.
2. **Hierarchy:** [Nielsen Norman Group: Visual Hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/).
   Use size, contrast and grouping to establish reading order. Our application:
   route heading, current action and ordered day rows, with quieter source detail.
3. **Lists versus cards:** [Nielsen Norman Group: Cards](https://www.nngroup.com/articles/cards-component/).
   Consistent lists support scanning and comparison; cards are more useful for
   browsing varied content. Our application: flat itinerary rows and a bounded
   selected-place sheet.
4. **Generic generated interfaces:** [InterfaceKit: What Makes a Website Look AI-Generated](https://blog.interfacekit.io/what-makes-a-website-look-ai-generated).
   This is practitioner opinion, not an authorship detector. It highlights
   interchangeable structure/copy, unnecessary decoration, inconsistent screens
   and missing non-default states. Our review rules address those weaknesses.
5. **Accessibility:** W3C's [contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
   and [target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
   underpin the contrast and target checks above. These are review targets;
   this prototype is not a completed accessibility audit.
