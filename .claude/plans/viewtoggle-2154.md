# viewtoggle-2154: consolidated <-> tabs view toggle in the header top-right

Card: joshualeestone/kosmos#2154. Design/content lane (Mona Lisa). Parent design pass: #1704.

## What finished looks like

A compact two-segment control sits in the header top-right, in the light/dark
switcher's visual language. One press flips the whole board between the tabbed
view (Agents / Projects / Settings as separate screens) and the consolidated
"one screen" view, and the choice persists across reloads. The control shows the
current view as its checked segment, and appears only at window width >= 960px
(the floor at which the consolidated view is offered at all).

## Substrate (already in web/index.html, verified)

- `html[data-layout]` = saved layout preference (`tabs` | `consolidated`),
  persisted via `PUT /api/style` `{layout}`, read on boot by `paintStyles` ->
  `applyLayout(layout, apply)`.
- `applyLayout` sets the attribute, re-lays the page (`placeProjectHead`,
  `showTab`), and syncs the Settings picker tiles' aria-checked.
- `body.consolidated` (the effective view) is toggled by `showTab` only when
  `layoutConsolidated()` is true: saved pref is consolidated AND innerWidth >=
  `CONSOLIDATED_MIN_WIDTH` (960).
- Existing UI to change it: Settings-screen `.laytile` tiles (select-then-activate).
- `.themepick` / `.viewtoggle` are the shared visual language (inline-flex, 0.5px
  separator, radius-control, bg-elevated, 38x30 segments, gold active fill,
  #14161a ink), per Josh's 2026-08-22 "same standard visual language sizing" ruling.

## The change

1. **Markup** (in `.headright.appright`, before the theme stamp/`.themepick`):
   a `role="radiogroup"` container `.laypick` with two `role="radio"` buttons
   `.layopt data-layout-switch="tabs" | "consolidated"`, each with a stroked
   16-viewBox icon (horizontal-split panel = separate tabs; vertical-split =
   one screen), a `title`, and a visually-hidden label.
2. **CSS**: extend the shared `.themepick`/`.viewtoggle` geometry rules to include
   `.laypick`/`.layopt` (one source of truth, no third copy). Gate visibility to
   `>= 960px` (base `display:none`, shown under `@media (min-width: 960px)`), the
   exact `CONSOLIDATED_MIN_WIDTH` floor.
3. **JS**:
   - Extend `applyLayout` to also sync `[data-layout-switch]` aria-checked, so
     boot paint, Settings-tile changes, and resize all keep the header correct.
   - Add a delegated click handler on `[data-layout-switch]` (matching the header
     theme picker's delegated pattern): `PUT /api/style {layout: want}`, then on
     success `applyLayout(r.layout, true)`. On failure leave the view unchanged
     (engine-down is a whole-board failure state; the header carries no msg slot).

Persistence uses the app's existing server store, NOT a new localStorage key
(one fact, one store).

## Verification

Committed browser-check `docs/browser-checks/render-viewtoggle-header-2154.js`
(headless, sandboxed fixture board), asserting against the REAL control:
- the two-segment control renders in the header at 1400px width, checked segment
  reflects the saved layout;
- clicking "consolidated" -> `html[data-layout="consolidated"]` and
  `body.consolidated` true (settled), the clicked segment aria-checked=true, the
  other false, and `GET /api/style` returns `layout: consolidated` (persisted);
- reload -> the saved consolidated layout is restored and the control shows it;
- clicking "tabs" -> flips back, `body.consolidated` false, aria updated;
- at 800px width the control is hidden (positive control: at 1400px it is shown).

Proven RED before the fix (the control does not exist), GREEN after.
README table row added (`browser-checks-indexed.test.js` requires it).

## #1720 gate

web/ change ships with a new `docs/browser-checks/*.js` assertion. Satisfied.

## Out of scope / deferred

Header promotion (moving the toggles, two-view spacing specs, instance dropdown)
is the next presentation piece under #1704. Instance dropdown contents,
create-new-Kosmos modal, avatar-simplified rows wait on Angel's boundary backend.
