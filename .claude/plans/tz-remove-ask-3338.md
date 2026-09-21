# Plan: remove the time-zone ASK (Josh 0.6.84 feedback, #3338 follow-up)

Branch: `tz-remove-ask-3338` · For the 0.6.85 set.

## Problem
Josh (0.6.84): the time-zone step asks for a city/ZIP, which reads as invasive data
collection ("I don't want to ask for it"). Remove it from onboarding entirely, and from
Settings unless we can auto-detect from the system clock (we can, via Intl).

## Approach
Stop ASKING; keep the value (auto-detected) so agents still know the operator's local time.
1. **Onboarding** (About-you step): remove the tz field (label, search, select, hint) and its
   wiring. On Continue, POST the machine zone (`youTzMachine()`) SILENTLY -- captured, never asked.
2. **Settings**: replace the picker (search + select + Save) with a READ-ONLY display of the
   detected zone (friendly label via `youTzLabel`). `paintYouTz` silently persists the machine
   zone if nothing was ever saved (so agents get it even if onboarding was skipped).
3. Keep `youTzMachine` / `youTzLabel` / `YOU_TZ_FRIENDLY` (used by the display). The picker-only
   helpers (`YOU_TZ_PLACES`/`ZIP3`, `youTzResolve`/`Select`/`FillSelect`/`WireSearch`) become dead;
   deferred to a focused follow-up removal (provably dead: only dead-calls-dead; no test/CI ref).

## Consumer safety
`/api/settings.timezone` (unchanged route) is read only for the operator's local-time label to
agents, which degrades gracefully when unset. Silent capture (onboarding Continue + Settings paint)
keeps that label working with zero asking.

## Tests / browser-check
- `web.timezone-1668.test.js`: rewritten -- read-only display shows the friendly label; silent
  POST only when unset; saved zone wins + no re-POST; unlisted zone falls back to raw IANA.
- `web.firstrun-you(+behaviour)`: About-you now paints TWO fields; the picker is asserted gone.
- `web.file-pickers`: 3 visible Save buttons (tz Save gone).
- `render-firstrun-namestep-1994wiz.js`: asserts the picker's ABSENCE + the silent capture on
  Continue. (Modified, not added/removed, so the 4 browser-check indices are unchanged.)
- No server change; `server.test.js` 306/306 unchanged.

## Verify
- Node: the rewritten tz suite + firstrun + file-pickers + index/reason-grep tests all green;
  server.test.js 306/306. A HEADED verify of the browser-check is the 0.6.85 real-render gate
  (headless can false-pass rendering).
