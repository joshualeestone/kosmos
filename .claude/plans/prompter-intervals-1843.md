# Plan: Prompter interval set -> {5,10,15,30,60}, default 15 (#1843 item 5)

## Goal (what will be true when done)
The Settings > Automation "Prompter" interval selector offers exactly
**5, 10, 15, 30, and 60 minutes**, with **15** selected by default, and a stored
`17` from an older build falls back to 15 rather than driving the runner at the
retired period.

## Why
Josh, #1843, 2026-09-03 (verbatim): *"instead of 5, 10, 17, and 60 minutes,
could we make it just 5, 10, 15, 30, and 60?"* This is item 5 of a five-item
directive. Items 1-4 already shipped on `main`:
- Item 1 (move "Agents talking" box into Automation, delete its top-level tab): #2054.
- Item 2 (Auto-save checkbox -> toggle): done.
- Item 3 (Prompter checkbox -> toggle, green on / grey off): done.
- Item 4 (all automation ON by default): heartbeat + autohandoff ON via #2013;
  the remaining half (notify/ping) is coupled to #2020 and is **Josh's call only** —
  out of scope here.

Item 5 is the last buildable item on the card.

## Design
`engine/heartbeat-setting.js` `INTERVAL_CHOICES` is the single source of truth. It
is served to the web `<select id="hb-interval">` via `/api/heartbeat-setting` as
`intervals`, and drives the runner delay in `server.js`
(`setting.intervalMinutes * 60 * 1000`). Changing the one frozen constant
propagates to both the UI and the runner, so there is one edit, not two systems to
keep in sync.

The old default 17 mirrored the fleet's own launchd cadence (StartInterval 1020s);
it is not one of the customer-facing choices Josh asked for, so it is retired. The
new default is **15** (the nearest clean member of the new set). A stored 17 is now
out-of-set, so `read()` falls it back to the default exactly like any invalid value
— the existing validation path already handles this; no migration code needed.

## Changes
- `engine/heartbeat-setting.js`: `INTERVAL_CHOICES [5,10,17,60] -> [5,10,15,30,60]`,
  `DEFAULT_INTERVAL 17 -> 15`; header comment updated to Josh's ruling.
- `web/index.html`: the two `paintHeartbeat`/`saveHeartbeat` client fallbacks
  `|| 17 -> || 15` (a fallback to a value no longer in the option list would be
  wrong).
- `engine/heartbeat.js`: stale "17-min default" comment -> "15-min default".
- Tests (`engine/heartbeat-setting.test.js`, `server.heartbeat-1722.test.js`,
  `web.heartbeat-1722.test.js`): fixtures/assertions updated off the retired 17;
  added a migration test asserting a stored 17 falls back to 15, plus a
  `INTERVAL_CHOICES.includes(17) === false` control.
- `docs/browser-checks/render-prompter-label-1843.js`: extended to drive the real
  DOM and assert the dropdown renders 5/10/15/30/60 as "N minutes" with 15
  selected, in both themes (satisfies the #1720 web-change gate).

## Verification
- `node --test` on the four heartbeat test files: 48 pass.
- The browser-check passes headless in both light and dark against the real
  rendered board (options `['5','10','15','30','60']`, default `'15'`).
- Full-suite validation: green.

## Scope boundary / what I rejected
- Item 4's notify/ping flip: **not** touched — it is coupled to controls Josh
  removed (#2020) and only he can reconcile.
- Renaming the internal `hb-*` ids / `/api/heartbeat-setting` route: rejected —
  #1843 item 1 deliberately kept the internals; this is a surface + set change only.
- Adding migration code for stored 17: unnecessary — the existing out-of-set
  fallback in `read()` already handles it.
