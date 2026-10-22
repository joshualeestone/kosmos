# snavred-6910: render-snav-head-4979 says WHY Settings > Computer never showed

## Why
kosmos#6910: the nightly full browser-check run has been red on main for two nights (10-21, 10-22) in
render-snav-head-4979, every time in the webkit "consolidated view 1280px" arm (4 of 4 attempts; chromium and
webkit 1000px pass on the same night). After `#userpop-settings` is clicked, `#s-nav button[data-go="mac"]`
"resolved to hidden" for 20 s. This is the same symptom as #5018, whose plan said that if CI still went red
with its wait in place, the cause was something else. It is still red with the wait in place.

The timeout says only "hidden". That does not tell apart a Settings panel that never opened, one that opened and
was hidden again (takeOverDisplayColumn hides #panel-settings for any later overlay), and a nav that is laid out
with no size.

## Change
docs/browser-checks/render-snav-head-4979.js: when that wait times out, the error carries the page state as JSON,
in this order: #panel-settings hidden at the timeout, hidden 300 ms after the click (read beside the wait, used
only if it fails, so "never opened" and "opened, then hidden" differ), and its parent; the first three page errors (80 characters each); the pill's own
size and visibility (or that it is not in the page); every ancestor that hides itself (hidden or display:none);
which children of #panel-projects are showing (the overlay that took the column, if one did); then data-layout,
body classes and URL. The gate's 200-character summary line carries the three Settings fields; the full line is in
the job log. The read has 5 s, so a wedged page cannot turn the timeout into a hang. Nothing else changes; the
pass path is unchanged.

## Decisions
- A diagnostic first, not a guessed fix. #5018 shipped a guessed cause and the red came back.
  Rejected: a retry of the click (it could hide a click that really does nothing), and recording the arm as
  runner noise (it was green in CI through 10-20, so something changed).
- Weakest premise: that the next red reproduces with the same shape, so the diagnostic catches it.
- Would change my mind: a local reproduction, which would let the fix land directly.

## Validation
- node --check passes.
- On this Mac, headless, through queued-heavy.sh, 13:03 to 13:05 CDT 2026-10-22, at 1e159ec3 (before the 300 ms read):
  - three normal runs of the check, both engines: rc 0, 0 FAIL, no SKIPPED, and each shows the three
    "PASS  webkit consolidated view 1280px" lines. **The CI red did not reproduce here**, as with #5018.
  - one forced run of a copy whose wait selector can never match (substituted on exactly that line): rc 2, and the
    diagnostic printed real fields, not evalFailed:
    `chromium consolidated view 1000px mac: Computer pill never showed: {"settingsHidden":false,
    "settingsParent":"panel-projects","pageErrors":[],"pill":{"w":138,"h":34,"visibility":"visible"},"chain":[],
    "shownInProjects":["pj-list-view","panel-settings"],"layout":"consolidated","body":"consolidated fold-a",...}`
    The gate's reason grep quoted it, and its 200 characters reached into the pill field.
