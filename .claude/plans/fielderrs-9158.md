# #9158: render-inline-field-errors-2606 is red in a headed hand run; serve it from a sandboxed board

Filed by PigeonPete (14:35 11-26) as "red on main, and nothing runs it". Measured before building, on origin/main
3fb2aec358 with the pinned runtime (~/work/pw-runtime, Playwright 1.62.1, Chromium build 1234, the only one installed):

| run | result |
|---|---|
| headless (HEADED=0, how tools/browser-checks.sh runs it) | 24 passed, 0 failed, rc 0 |
| headed (the check's documented default) | 24 passed, 70 failed, rc 1 (every FAIL a `file://` fetch "blocked by CORS policy") |

So both halves of the card's premise are off, and the defect is narrower and real:
- It IS run: docs/browser-checks/gated.txt line 157 (since #3933, 09-26). tools/browser-checks.sh reads that list at
  run time, so a grep of the runner for the name finds nothing. And the gate is green on it, because the gate runs
  headless.
- It is red in a HEADED run. Full Chrome reports a `file://` fetch refusal as a CORS block; the headless shell words it
  the old way, which the check's console filter (`ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)`) knows.
  A headed hand run, the natural way to look at a change to `.tk-inp` (as #9103 did), is all red and tells nothing.

## Change (docs/browser-checks/render-inline-field-errors-2606.js only, plus its README row)
- Serve the page from a real board in-process (server.js on a sandboxed home, lib-sandbox-home, an empty fleet), the
  way render-occurrences-9142 and the fleet.install([]) siblings do. The page's start-up fetches then answer, so the
  console guard has NO exemption: any console error is a FAIL, in either mode.
- fleet.install([]): without it the sandbox board answers /api/status 500 and /api/community/ready 503 (no roster).
- The first-run guide opens on a new board and holds focus; it is closed with Escape (as a person does) and asserted
  closed. Hiding it from script, as the file:// version did, left focus in the guide, so the "focused" checks failed.
- G0: one console error planted per page and required to be heard (counted, not failed), so a guard that stops
  listening fails rather than passes quietly.
- Teardown in a finally: browser, server, sandbox dirs.

## Rejected
- Widening the console filter to also skip CORS refusals (the card's option 1): keeps the check on file://, where every
  new start-up fetch is a new message to exempt, and a filter keyed on Chromium's wording breaks again when it changes.
- Adding it to gated.txt / the runner: it is already there.

## Not in this card
- 17 other checks copy the same file:// console filter. Measured two headed: render-pjadd-back-2850 shows 38 CORS FAILs
  (green headless), render-agent-sort-4428 shows none. Filed as its own card.

## Measured after the change
- Headless: 28 passed, 0 failed. Headed: 28 passed, 0 failed.
- Controls, each a perturbed copy, each red as it should be: the console listener deaf to errors (G0 fails, both
  themes); an unplanted console error (FAIL console line + G0); the first-run guide left open (guide assertion + the
  two focus assertions).
- Guard suites: 15 *browser-check*.test.js files 121/121; the six sandbox-home/runhome/quiet/beacon/skills/tmpscope
  files 55/55.

## Reviews
- Round 1 (opus): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NIT.
  - WARNING: the header comment retold the card's premise (red on main, nothing runs it), which the measurement above
    disproves. Fixed by cutting the history out of the comment; it lives here.
  - NIT taken: srv.start and the browser launch ran before the try, so a launch failure skipped teardown. Both now
    inside it, with null guards in the finally.
  - NIT taken: two leftover `#firstrun` hides in the evaluate blocks, from the file:// version. Removed; the guide is
    closed with Escape and asserted closed.
  - NIT not taken: one try per teardown step (low value; browser.close now cannot throw out of the finally).
