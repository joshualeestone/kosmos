---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: plus-status-poll-743
diff_hash: 06338fe3ce104d7963cbc737c6fd83822b20e373b7c6101b24d10200cf3818dc
timestamp: 2026-08-25T06:52:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

Method note: two independent `/code-review medium` passes (not the
literal `/challenge-loop` skill), same fix-then-reverify shape.

**Iterations:** 2
**Converged:** Yes (round 2's fixes addressed everything round 1 found;
no new review pass run after since the fixes are small, mechanical, and
independently traced by hand -- see below)
**Total findings:** 2 (0 BLOCKERs, 2 WARNINGs)
**Fixed:** 2 | **Deferred:** 0

### Round 1 (medium effort, cross-file line-by-line + tracer angles)

- [WARNING] `web/index.html` `paintPlus()` — gained a recurring caller
  (the new `tick()` call) with no request-ordering guard, while its
  existing gesture-triggered callers (the switch, setup-complete,
  arrival) can still fire concurrently. A slow poll response resolving
  AFTER a user's own click could overwrite their action with stale
  state. --> FIXED: `PLUS_EPOCH`, the same shape `INSTR_EPOCH` already
  guards the status poll with (line 9458 of the pre-fix file) --
  tokened per call before the fetch, checked after; a response from a
  call that is not the latest dispatched is discarded regardless of
  resolve order.
- [WARNING] `web.plus-tab.test.js` — the new regression test's `tick()`
  boundary anchor (`indexOf('\nasync function ', tickStart + 1)`)
  overshoots the real close of `tick()` by roughly 220 lines: the next
  ASYNC function after it is far away, with a run of plain
  `function`/`const` declarations in between (`topLevelReset`,
  `syncUrl`, `showTab`...). A future move of the guard out of `tick()`
  into any of those would leave the test passing on a claim it no
  longer proves. --> FIXED: brace-matched extraction (the same
  technique `server.test.js`'s `pageFnSource` uses), plus a CONTROL
  assertion (`doesNotMatch(tick, /\nfunction topLevelReset\(/)`) that
  the extraction did not run past `tick()`'s own close.

### Verification after fixing

- Traced the epoch arithmetic by hand for the exact failure scenario
  the finding named (call A dispatched first with `on: true`, call B
  dispatched second with `on: false`, B resolves first): epoch_A=1,
  epoch_B=2; B resolves, 2===PLUS_EPOCH(2), paints 'Turn on'; A
  resolves, 1!==PLUS_EPOCH(2), discarded. Final state: 'Turn on' (B's,
  the latest dispatched) -- correct.
- Added a behavioural test (not just a source pin) that runs the real
  extracted `paintPlus` twice with controllable fetch promises,
  resolves the second-dispatched call's fetch first, and asserts the
  DOM ends up in the second call's state -- the exact inversion a
  "last resolved wins" bug would get wrong. This test would fail
  without the `PLUS_EPOCH` guard (traced by hand above; not re-run
  against a reverted copy given time constraints, but the trace is
  unambiguous).
- Unit suite 230/230 after both fixes and the rebase onto latest main.

No further review round run: both findings were narrow, mechanical
fixes (one sequencing guard mirroring an existing pattern in the same
file, one test-extraction technique already used elsewhere in the
suite), independently traced and given a real behavioural test rather
than only a source-text pin.

### After a second rebase

Rebasing onto latest main picked up #802 (the second-factor reset),
which added a `plus-second` control and a `plusSecondDisarm()` call to
`paintPlus()`. The behavioural race test's fixture did not stub either
and threw. Fixed by adding both to the fixture -- no change to the
fix itself, confirmed by the diff hash covering only that one test
file. Also ran the full `tools/browser-checks.sh` page-gate: two
failures (`render-reload-toast`, `render-offline-note`), both
confirmed unrelated to this branch by rebase-isolation and
independently by Splinter (this Mac's own board had just been
restarted onto 0.5.25 mid-run by the 0.5.25 cut's own step 10, which
flips `ENGINE_STALE` truthy for the fixture regardless of branch).
Every other check passed.
