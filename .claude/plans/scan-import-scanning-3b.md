# scan-import-scanning-3b - two-phase import scan: scanning:true retry + tccUnavailable (Josh 0.6.42 #3/#4, half b)

## The problem this completes

Josh's #3/#4: agents in the protected folders (~/Documents, ~/Downloads, ~/Desktop) were not
surfaced. The fix has two halves, done with Ice Cream Kitty:

- **Half (a), shipped (#2390):** re-run the disk scan on a late file-access grant edge (async S2 grant
  landing after the person reached the find-agents screen).
- **Half (b), this branch (front-end) + Kitty's #2391 (engine, merged 86cdd120):** the engine now
  routes the TCC-root walk through the app-identity hatch. Because `discover.scan()` is synchronous,
  it cannot block on that hatch, so `/api/scan-import` is now TWO-PHASE:
  - `scanning: true` = partial (non-TCC rows returned now, the hatch's rows land a beat later, ~1s).
  - `bounded.tccUnavailable: true` = complete, but the protected folders could not be read (no app /
    the hatch gave up). The engine self-limits (it gives up to tccUnavailable rather than reporting
    scanning:true forever).

This branch is the front-end consumer of that contract.

## What this branch does (web/index.html)

- `fetchImportScanComplete(onPartial)`: fetches `/api/scan-import` and, while it reports
  `scanning: true`, RETRIES a few times (~`FR_IMPORT_RETRY_MS`, default 500ms, a `let` for tests)
  until the result is complete, calling `onPartial(result)` each round so the non-TCC rows show
  immediately rather than a blank wait. A hard fetch failure (`out === null`) returns immediately and
  is NOT retried here - that is the grant-edge hiccup half (a)'s poll already retries. The engine's
  self-limit bounds the loop; the retry cap is a backstop.
- `frScanAgents` granted path uses it, with a generation-guarded partial repaint. `FR_SCAN_FULL` now
  requires `scanning !== true`, so a partial never stops half (a)'s grant-flip poll, while a complete
  result (including `tccUnavailable`) is full and the poll stops - retrying would not help until a
  later re-scan.
- `populateFoundImports` (create-form import mode) uses it too, with a per-call `FR_IMPORT_POP_GEN`
  guard so a mode re-pick during the ~2s retry cannot let a stale partial paint over the newer state.
- tccUnavailable hint ("Could not scan Documents, Downloads, or Desktop this time.") shown in
  `frPaintScan` (rows-present) and `populateFoundImports`.

## Decisions / rejected

- Retry the front-end on `scanning: true` (Kitty's contract) rather than blocking the engine: the
  engine is synchronous by design, and a partial-now / complete-soon UX beats a blank spinner.
- Treat `tccUnavailable` as COMPLETE (full, poll stops), not as a failure to retry: Kitty's contract
  says it "self-heals on a later re-scan", and an immediate retry would hammer a hatch that already
  gave up. Rejected: keep retrying tccUnavailable (busy loop, no progress).
- A hard fetch failure is NOT retried by fetchImportScanComplete (only `scanning:true` is): a hard
  failure is half (a)'s grant-edge hiccup, already retried by the poll; retrying it here too would
  double-retry.

## Flagged for Josh (deliberately NOT built)

The S9 EMPTY create-arm + `tccUnavailable` case. Josh's standing ruling on that arm is that it
"stays silent... never a report on our own uncertainty" (the reason the find-agents link was removed
twice). A tccUnavailable hint there would be exactly such a report, so it would violate the ruling.
This branch leaves the empty create-arm silent when tccUnavailable (it self-heals on a later
re-scan). Whether the empty create screen should say "could not scan Documents" when tccUnavailable
is a product decision only Josh can make - raise it with Josh/Mona rather than silently overriding
his ruling.

## Weakest premise

The retry cadence (~500ms x a few) assumes the hatch answers in ~1s (Kitty's stated norm). If the
hatch is consistently slower, the front-end retries could exhaust before it answers, leaving a
partial that half (a)'s poll then retries later. Bounded and self-healing, but the exact cadence may
want tuning against real hatch latency once observed on a fresh install.

## Copy

The tccUnavailable hint wording is a plain honest placeholder; it may want Mona Lisa's copy review.

## Tests

`docs/browser-checks/render-firstrun-scan-on-grant-1652.js` scenarios 9 (scanning:true shows the
partial then the retry lands the complete set, marked full) + 10 (tccUnavailable is a complete scan,
full, single call, with the hint). Rides 0.6.45.

Relates to #3/#4 (half a, #2390), #2125/#2391 (Kitty's engine half b), #1652 (import).
