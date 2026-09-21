# #3338: friendly time-zone / location capture (kill the city-search confusion)

## The card
Josh, 6.83 feedback: the onboarding time-zone step is a "timezone / city search
confusion." The step (and Settings) presented a raw `<select>` populated from
`Intl.supportedValuesOf('timeZone')` — ~400 IANA identifiers like `America/Chicago`.
You have to know that `America/Chicago` means Central, and there was no working city
search. Splinter ruled: own it end-to-end in the web lane, Intl zone read in the
renderer + static friendly-zones/ZIP data, no engine split.

## What "done" looks like
- The onboarding About-you step and Settings show a SHORT, friendly, US-first zone
  list ("Eastern Time (ET)", "Central Time (CT)", ...), not the raw IANA list.
- The machine zone is auto-detected (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
  and preselected, shown by its friendly label.
- A "search by city or ZIP" input jumps the selection: a city (Dallas, McKinney) or a
  US ZIP (75454) selects the right zone; the select stays the source of truth.
- The saved VALUE is still the canonical IANA id (`POST /api/settings {timezone}`), so
  the server contract and the agent-greeting consumer are unchanged.
- No engine/server file touched.

## Design
- **Static data, renderer-side** (in `web/index.html`, near `youTzMachine`):
  - `YOU_TZ_FRIENDLY`: 7 US zones + 7 common non-US zones, each `{id, label, us}`.
  - `YOU_TZ_PLACES`: curated city + abbreviation -> IANA (incl. Dallas/McKinney and
    ET/CT/MT/PT/AKT/HT abbreviations as exact keys).
  - `YOU_TZ_ZIP3`: conservative first-3-digit ZIP ranges -> zone. ONLY ranges lying
    wholly inside one zone; split-state prefixes (FL panhandle, TN, IN, KS/NE/SD/ND
    borders, El Paso, east OR/ID) are omitted so a ZIP never jumps to the WRONG zone.
- **Helpers**: `youTzLabel`, `youTzResolve` (place -> ZIP -> length-gated label/id
  substring), `youTzSelect` (insert+select, focus-guarded), `youTzFillSelect` (flat
  friendly list), `youTzWireSearch` (input -> jump + onPick callback).
- **Two call sites** reuse the helpers: the first-run step (`frPaintYou`) and Settings
  (`paintYouTz`). Each keeps its own save flow.
- The select is the source of truth; the search is an accelerator. A machine/saved zone
  outside the friendly set is carried in as a raw (but friendly-labelled) option, so
  detection and any previously-saved custom zone are still honored.

## Why a flat list, not optgroups
The 14 entries are few and the labels carry the grouping meaning ("Eastern Time (ET)").
A flat select is simpler, keeps the node stub faithful, and is fully headless-testable.
US zones come first by array order.

## Why the ZIP table is "correct-or-silent"
A hand-built ZIP->zone table is error-prone at split-state boundaries. Rather than risk
a confident wrong jump, omitted/ambiguous prefixes resolve to '' (no jump) and the
operator picks from the friendly list. Verified: every split-state ZIP returns ''.

## Verification
- `web.timezone-1668.test.js` (11 tests): friendly labels, city/ZIP jumps, abbreviations,
  no single-letter jump, no wrong jump, machine-zone default, saved-zone prefill, wiring.
- `web.firstrun-you-behaviour.test.js` (2): the real `frPaintYou` runs to completion
  with the friendly helpers and paints three labelled fields.
- `render-firstrun-namestep-1994wiz.js` (real Chromium): friendly label rendered, search
  input present, "Dallas" -> Central, "90210" -> Pacific, unrecognized -> no move, save
  still POSTs the selected IANA id.
- Full web suite 1512 pass, server 304 pass, page script `node --check` clean.
- Screenshots (headless) show the friendly picker + search on the onboarding step.

## Out of scope / follow-ups
- Pixel styling + night-mode: Josh QAs in-app on the live cut (headless can't match).
- International city coverage is intentionally small (US-focused product); the visible
  select is the correction path for anyone the accelerator does not resolve.
