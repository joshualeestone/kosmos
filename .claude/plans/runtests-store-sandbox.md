# runtests-store-sandbox -- sandbox the store data root for the node test suite

## Problem

The 0.6.55 cut keeps aborting at step 3 (the node suite) on engine/heartbeat.test.js
(`rowsFrom maps the REAL board stateConfidence field`, boardRows returned 7, expected 1). It is a
mortals-env-dependency: the test reads live machine state.

engine/status.js snapshot() surfaces agents from three sources: live panes (tests sandbox these via
test-support/fleet.js's setPaneSource), the created-never-run arm (setCreatedSource), and
**panelessKeys()** -- agents with a sender token + a live heartbeat but no pane, read from
`sendertoken.keys()` + `liveness.alive()`, BOTH keyed off `store.ROOT` (the real data root).
sendertoken and liveness capture their directory from store.ROOT AT MODULE LOAD, so there is no
runtime seam a fixture can reach. On the cut box (mortals runs the live fleet, and the operator was
mid-import via #2678), those real agents (johnnycage/kano/raiden/scorpion/sonyablade/subzero -- token
+ beat, no pane) leak into EVERY fixture's snapshot(), and heartbeat.test.js's hermetic assertion
reds. It passed at earlier cut moments only because the box then had zero such agents.

(A prior attempt, #2696, sandboxed setCreatedSource in fleet.install -- the WRONG source. It was
validated on a box with no imported agents, so it false-passed; it is merged but inert. The real
leak is panelessKeys, which no per-installer seam reaches.)

## Fix

tools/run-tests.sh points the store data root at an empty per-run dir BEFORE node loads, by exporting
`AGENT_WORKFORCE_HOME=<empty tmpdir>`. store.ROOT is then empty for the whole node suite, so
sendertoken/liveness/createdroster all read empty and panelessKeys()/the created arm surface nothing
live. This fixes the WHOLE "test reads live data root" class in one place, not just heartbeat.

AGENT_WORKFORCE_HOME is the LOWEST-precedence store-root seam (AGENT_WORKFORCE_DATA and a per-test
AGENT_WORKFORCE_HOME both override it), so a test that self-sandboxes is unaffected; only tests that
would otherwise read the REAL live data root change, and those were non-hermetic by construction.
run-tests.sh runs as its own subprocess, so the export never reaches the other test:shell scripts.

## Verification (MUST be on mortals, the box that fails -- not a clean box)

- With the store root sandboxed, `boardRows([mara])` returns 1 and engine/heartbeat.test.js passes
  17/17 on mortals (verified by hand with AGENT_WORKFORCE_HOME=<tmpdir>).
- Full node suite via the patched tools/run-tests.sh green ON MORTALS (blast-radius check: any node
  test that asserted on the real data root / real agents was already non-hermetic).
- Then the cut clears step 3.

## Follow-up

This is a big step toward the systemic answer (run the cut as a separate macOS user with an empty data
root). File that as a named initiative-card after 0.6.55 ships.
