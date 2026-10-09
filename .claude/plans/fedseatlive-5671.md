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
  calls (a project made or joined) follow one rule. Wired in server.js to liveExecution.liveExecutionAllowed().
- After the local link checks (a stale link is still dropped on sight: local, reaches no room), before anything that
  reaches out.
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

(filled in per round)
