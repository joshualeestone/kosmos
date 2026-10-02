# fieldsettle-4734: render-fields waits on the controls, not on network quiet, and has a floor (kosmos#4734)

Started 2026-10-02 14:50 CDT, Ice Cream Kitty (routed by Splinter).

## Measured first (the card asked for it)
Probe, sandboxed board, webkit and chromium x3, Agent1s load 4.3: 100 fields from DOMContentLoaded; buttons 431-432 at
DOMContentLoaded, 432-434 at load, 434 at networkidle and once settled. The page script (`card`) is ready at DOMContentLoaded.
So 2-3 buttons arrive after load; networkidle caught them in all six runs, and nothing guaranteed it.

## Change (docs/browser-checks/render-fields.js)
- goto waits for `load`, then `settle()`: the page script up and the field and button counts unchanged for 1.5 s. Not settled in
  20 s is a FAILURE (a page that polls would never reach networkidle at all).
- Floors on what was measured: fields >= 50, buttons >= 200 (about half the measured 96 / 372-388), so a page that drew only part
  of itself fails instead of passing over a short list. Today only an EMPTY field list failed.
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
- Round 1: PENDING.
