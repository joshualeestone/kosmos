# fedseatlive-5671: federated seats wait for live execution too

Card: kosmos#5671 (found in review of #5670; Splinter routed it 05:20). The federated-seat sweep (fedseats.ensureAll,
at start and every minute) and the person-triggered ensure calls start a seat only when the board is enrolled in
Kosmos+, but never checked the board's live-execution opt-in, which the company rollup and the board's other outward
sweeps wait for.

## Done looks like

No seat is started, and the coordinator is not asked for edges, until live execution is stated; with it, a seat starts
as before; the board wires the gate; a test proves both arms.

## Decision (reversible)

- Gate inside fedseats.ensure (an optional `allowed()` dep beside `enrolled()`), so the minute sweep and the route
  calls (a project made or joined) follow one rule, and at the top of ensureAll (review 1: its owner-room check asks
  for edges without going through ensure). Wired in server.js to liveExecution.liveExecutionAllowed().
- In ensure, after every local check (a stale link dropped, a removed project's link forgotten), before the seat.
- Rejected: a NODE_TEST_CONTEXT check (live-execution.js explains why an inherited env var is the wrong key) and gating
  only the timer (the route calls would stay inconsistent).
- No production change: server.js states live execution on the real-start path (before start(), line order checked),
  on every supported platform (darwin, win32, linux).
- Weakest premise: a board whose platform gate refuses live execution would now seat no federated project; today no
  supported platform does, and such a board refuses agent operations anyway.

## Verification

- engine/fedseats.test.js: the new test (no seat and no edge request without the gate, CONTROL a seat with it, the
  board's wiring) is red when the gate is removed; the file 196/196.
- server.federation / fedmembers / fedmsg tests, fixture discipline and the Windows and name guards: 319/319.

## Review log

- **Round 1 (opus):** 0 blockers, 1 warning, 2 NITs.
  - W fixed: ensureAll's owner-room check (checkRoom -> revokeCheck) asked Kosmos+ for edges every minute for a sealed owner room with a pinned member, without going through ensure. The pass now waits for live execution at its top, as the company rollup's tick does; the test seeds such a room so its "asked nothing" assertion can fail (red by mutation of the new gate).
  - NIT fixed: the per-seat gate now sits after the removed-project cleanup (local), as the plan said.
  - NIT left: the wiring check reads server.js's text; the start order was checked by hand and by the reviewer.
  - Recorded, not changed: ensureAll has the same gap for `enrolled()` (it predates this card; a signed edges request from an unenrolled board is refused by the coordinator).
- **Round 2 (sonnet):** nothing above NIT. Converged. No path reaches Kosmos+ or starts a seat while allowed() is false (each traced). Left: the top-of-pass return also defers two LOCAL cleanups (stopping a seat whose link is gone, which cannot exist before the first allowed pass; dropping a stale #3851 link), invisible on a real board, which states live execution before start(); the wiring check reads server.js's text (round 1's NIT).
