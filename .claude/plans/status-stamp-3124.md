# #3124 - Agent-status freshness stamp is vacuous

Branch: `status-stamp-3124` · card: joshualeestone/kosmos#3124 · lane: board/identity (Renet Tilley)

## Problem
Josh, #admin 2026-09-15: "are we actually really refreshing anything there,
because I've never seen it say anything other than that?" The Agent-status stamp
always reads "Refreshed just now" and can never show staleness.

Root cause (confirmed by reading source, not just the card):
1. `web/index.html` computed the stamp age from `data.checkedAt`, which the
   server (`engine/status.js` `snapshot()`) stamps with `new Date()` at
   response-build time. `snapshot()` re-scrapes every request, so on any live
   board `age = now - checkedAt` is ~network latency ~= 0. The stamp could only
   ever read "just now"; the `age > 30` stale band and every `freshWords` band
   above the 5s floor were dead code on the success path.
2. The stamp was painted only when data ARRIVED (the success path, and the catch
   path's "could not refresh"). A stamp that repaints only on arrival cannot, by
   construction, indicate the ABSENCE of new data - the one thing it exists for.
   Class: "a guard whose condition became always-true still looks like a guard."

Note: the catch path already repaints "could not refresh" + stale on a failed
poll, so the card's premise #2 ("success-only repaint") was partially stale; the
live core is premise #1 (age pinned to ~0) plus the fact nothing ages the stamp
between polls.

## Fix (client-side, `web/index.html` only)
Age the stamp on the OBSERVER'S clock, on its own timer:
- `LAST_STATUS_OK_AT` - client-clock instant of the last successful poll (client
  clock at both ends also drops the two-clock skew `freshWords` guards for).
- `STATUS_POLL_FAILED` - set by the catch path so the ager does not overwrite
  "could not refresh".
- `ageCheckedStamp()` - shared render helper (keeps the exact
  `checked.innerHTML = '<span>Agent status</span><b>' + freshWords(age) + '</b>'`
  line the freshness-stamp test pins).
- Success path: record `LAST_STATUS_OK_AT = Date.now()`, clear the fail flag,
  render through the ager. Catch path: set `STATUS_POLL_FAILED = true`.
- `setInterval(ageCheckedStamp, 1000)` next to the 5s `setInterval(tick, 5000)`.

Result: a healthy 5s board cycles 0..5 and honestly reads "just now" most of the
time but visibly ages; a board that goes quiet (hung request, suspended tick)
ages past 30s → stale (wavy) → minutes → the intended behaviour.

## Out of scope (decided, not missed)
- `engine/status.js` still emits `checkedAt` (honest: it IS the response-build
  time). It has no remaining client consumer, but removing it touches the server
  and its tests for no behaviour gain - left in place.

## Verification
- `web.freshness-stamp-ages-3124.test.js` (new): drives `ageCheckedStamp` for
  fresh / stale-band / failure-guard / no-poll-yet, and source-asserts the 1s
  wiring plus that the `data.checkedAt` source is gone. Negative control: the
  file is 0-pass / 6-fail against pre-fix origin/main.
- `web.freshness-stamp.test.js` and all `web.*.test.js` (1470) still pass.
- Live pw-runtime proof: the 1s timer ages the stamp with no new poll
  (just now → 29s → 30s → 32s + stale), the failure guard holds, and a recovery
  poll clears it. `Browser-check` trailer records this.
