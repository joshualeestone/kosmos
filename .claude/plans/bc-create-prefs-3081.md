# Plan: #3081, a browser check for the remembered create defaults

## Finished looks like
A committed headless browser check proves, on a real page, that after an agent is made with a
non-default Claude account and model, reopening Create (after a reload) shows both pre-selected
and still changeable; the check runs in tools/browser-checks.sh and in the CI DOM-state gate; and
it goes red when the remembered choice is absent.

## Why
The fix (#3094, 377ce091d) is in prod 0.6.92. The card stayed open on needs-browser: the only
evidence was a source test (web.create-prefs-3081.test.js). This is the behavioural observation
the card asked for, done headless via pw-runtime.

## Change
- `docs/browser-checks/render-create-prefs-3081.js`: boots its own fixture board (every state
  root a temp dir, #3675 sandbox home with two fixture Claude accounts), opens Create, picks the
  second account and a non-default model, answers the create POST with outcome 'created' via a
  page route (nothing launches), reloads, reopens Create, asserts provider/account/model.
- Wired into the runner's self-booting loop, the README index, and KOSMOS_BC_CI_ALLOWLIST
  (it asserts select values and localStorage only: DOM state, no paint or timing).

## Measured
- 10/10 PASS headless on this Mac.
- Red control: clearing localStorage before the reopen makes "last account pre-selected" and
  "last model pre-selected" FAIL (the model falls back to sonnet). Reverted after.

## Weakest premise
The create answer is stubbed, so the save path is exercised from the page's own handler on a
synthetic 'created' outcome, not from a real launch. The save reads only `result.outcome`, so
the stub covers it; a future change that saves from a later step (e.g. after the watch) would
not be seen here. OpenAI's async per-account model restore is not covered (no OpenAI fixture).

Stacked on bc-home-3675 (#3702) for the sandbox lib; rebase onto main after it merges.
