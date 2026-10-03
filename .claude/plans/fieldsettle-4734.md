# fieldsettle-4734: render-fields waits on the controls, not on network quiet, and has a floor (kosmos#4734)

Started 2026-10-02 14:50 CDT, Ice Cream Kitty (routed by Splinter).

## Measured first (the card asked for it)
Probe, sandboxed board, webkit and chromium x3, Agent1s load 4.3: 100 fields from DOMContentLoaded; buttons 431-432 at
DOMContentLoaded, 432-434 at load, 434 at networkidle and once settled. The page script (`card`) is ready at DOMContentLoaded.
So 2-3 buttons arrive after load; networkidle caught them in all six runs, and nothing guaranteed it.

## Change (docs/browser-checks/render-fields.js)
- goto waits for `load`, then `settle()`: the board's FIRST /api/status poll answered (round 1), then the field and button counts
  unchanged for 1.5 s. A poll that never answers, or counts that never settle, within 20 s each is a FAILURE (a page that polls would never
  reach networkidle at all).
- Floors on what was measured: fields >= 50, buttons >= 200 (about half the measured 96 / 372-388), so the WRONG PAGE (a 404, a
  stub, a wrong base URL) fails instead of passing over a short list. Today only an EMPTY field list failed. [CORRECTED round 1: not a
  guard on a dead page script; ~100 fields and ~430 buttons are static HTML, so that page clears both floors.]
- A built-in control per engine: a page that adds 3 fields 1.2 s after load with no request. networkidle must miss them and settle
  must see them; settle missing them stops the run (INSTRUMENT FAILED SELF-CHECK).
- A top-level catch: a throw (e.g. a page that never settles) prints FAIL and FAILED: 1 instead of dying unreported.

## Decided, and why
- Floors at about half, not at the measured count: a legitimately removed control must not redden the check; a broken page must.
- The control lives in the check (like its contrast self-check), so every run re-proves the wait can tell the difference.

## Validation (Agent1s, sandboxed board, 2026-10-02 14:55)
- main's render-fields: OK. New: OK; control "networkidle saw 0 of 3 late fields, settle saw 3" in both engines; settled ~1.7 s on
  100 fields / 434 buttons each time.
- Mutant floor 1000 -> FAIL on the floor (rc 1). Mutant SETTLE_MS 0 -> the control FAILS before measuring (rc 1).

## Weakest premise
The control's late page is synthetic (a timer adding inputs); it proves the wait can see late controls, not that the board ever adds
fields late. The board adds BUTTONS late (measured), which the same settle covers.

## Review
- Round 1 (opus, blind, no browsers): 0 BLOCKER, 3 SHOULD-FIX, all taken. SF1: the counts window could close before the board's first
  /api/status poll answered (networkidle never allowed that), so a slow box measured an unpainted page; settle now awaits that response
  (registered before goto). SF2: `card` defined is no readiness signal (a hoisted declaration); replaced by the answered poll. SF3: the
  floor comment's dead-script claim was false (corrected above). NIT1 taken: `failures` at module scope so the bottom catch prints the
  true count. NIT2 noted: the validation board is the README's plain sandboxed board, not the cut's rich board (render-fields runs on
  the rich board in tools/browser-checks.sh); the counts and timings are this board's.
  Measured 15:03 on the same plain board: main OK; new OK (control 0 vs 3 in both engines, settled 1.6-1.7 s); floor 1000 -> FAIL on the
  floor; SETTLE_MS 0 -> the control FAILS; waiting on '/api/statusX' -> "the board's first /api/status poll did not answer in 20000 ms",
  FAILED: 1, rc 1.
- Round 2 (sonnet, blind, no browsers): 0 BLOCKER, 0 SHOULD-FIX. CONVERGED. Confirmed: tick() runs unconditionally at the end of the
  page script, so the first poll always happens and a script that dies before it now FAILS on the answered-poll wait (the case the
  floors cannot see); the predicate matches only /api/status; the rejection is always handled; module-scope `failures` changes
  nothing else. NITs taken (comment wording only): the 20 s limit applies to the poll wait and the counts window separately (up to
  about 40 s); "what paints the late controls" softened to "probably" (timing measured, cause not). NIT not taken: the control's
  1.2 s timer against the 1.5 s window could misfire under extreme starvation; it fails loud (INSTRUMENT FAILED), never false-passes.
- Full validation (Agent1s, 21:30-21:34 CDT, at 844103b7d): 14469 tests, 14245 pass, 1 FAIL: browser-checks-reason-grep's exact
  emit-site count (235 matched, 232 expected). My miss: the branch added three counted lines to render-fields.js and never bumped
  the shared counter (#5071's race). Rebased onto main (233) and set 236 as measured; the three are the INSTRUMENT FAILED
  SELF-CHECK line, the top-level catch's FAIL line and the closing FAILED: summary, all quotable (the bad list is empty).
  [CORRECTED: my first note on the count named a "floor" line that is not one; fixed in 76ce7fac6.] The test file passes 5/5.
  Both browser-check gates were rc 0 in the same run.
