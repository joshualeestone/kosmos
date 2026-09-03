# Plan: #2047 — Settings must not render a definite switch position when it cannot read the setting

## Problem
On a 403 board (server.js's board-token gate returns HTTP 403 with a JSON body
`{error:...}`), Settings flag-readers that did `await (await fetch('/api/X')).json()`
would parse the error body as a real setting. `r.on === true` is false, so the switch
rendered a confident OFF nobody set — and for auto-update that OFF tells the user
"nothing will arrive to fix this," steering them toward the manual remedies the same
403 has disabled. Reported by Josh on cabal9.

## Root cause / class
The readers relied on the `catch` for their unreadable branch, but a 403 does NOT
reject — it resolves with `ok:false` and a parseable body, so `.json()` succeeds and
the catch never fires. The class is "every Settings flag-reader that renders a definite
state from an `/api/*` read."

## Scope decision
The sibling readers were already made 403-safe by other cards:
- `ah-toggle` (auto-handoff) and `hb-toggle` (heartbeat) + its notify-off hint — #2054
- `tell-toggle` (ping) and `notify-toggle` (notify) — #2020 (built 403-safe from start)

The only remaining gaps were three readers, which this branch fixes:
- `refreshAutoUpdate` (auto-toggle, /api/autoupdate) — the reported one
- `refreshEngMode` (eng-toggle, /api/engmode)
- `paintLimits` (lim-toggle, /api/limits)

Deliberately excluded: `paintYouTz` (/api/settings timezone) also 403s but degrades to
the machine zone with an explicit "Save to confirm" affordance — a value picker, not a
false switch position — so out of "definite switch position" scope.

## Fix
Check `res.ok` and route a non-ok HTTP status into each reader's EXISTING unread branch
(`paintSwitch(null)` + "we could not read this setting"). `res.ok` (HTTP status) is the
right discriminator: a corrupt/absent read is a 200 with `{on:default, ok:false}` (the
engine's honest "safe default in force") and must keep its switch; a 403 is a different
status intercepted before the route runs. So the `{ok:false}` path is untouched.

## Test
`web.settings-unread-2047.test.js` — for each of the three readers, a 403 arm asserting
no definite position (hidden, no aria-checked, message says "could not read") with a
200 control arm proving the real value still renders. Verified red-capable: against
pre-fix code the three control arms pass and the three 403 arms fail.

## Acceptance (from the card)
- On a 403 board the toggle renders "we could not read this setting" — not ON, not OFF. ✓
- The `ok:false` the backend returns is untouched (200 path). ✓
- The test fails if a definite position renders on an unreadable read, with a 200 control. ✓
