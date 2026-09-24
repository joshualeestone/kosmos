# bc-full-ci-2518 (#2518, CI-integration half)

## Problem
CI's browser-checks job runs only the headless-robust DOM-state allowlist. Every other
check (render-fields, render-thread, render-push-718, ...) ran first at the release
cut's 3b, so a PR that broke one merged green and blocked the next cut. Live instance
2026-09-24: #3493 (a CSS contrast change in web/index.html) broke render-fields on both
engines, merged green, and blocked the 0.6.91 staging cut.

## Measured before choosing (origin/main 21c3c64a)
- The surface map covers 71 of 195 browser checks. render-fields, render-thread and
  render-push-718 are not mapped.
- `git show 9628a617a -- web/index.html | tools/bc-surface-map.sh covering` returns only
  render-plus-blue-1615.js, so "run the covering checks" would not have caught #3493
  (CSS; the map is DOM ids). Control: `pj-alltasks` resolves to render-alltasks.js.

## Change
- New `.github/workflows/browser-checks-full.yml`: triggered ONLY by `schedule` (nightly,
  09:30 UTC) and `workflow_dispatch` (on demand, any branch). It runs `tools/browser-checks.sh`
  with no allowlist (every check, headless via run_one, the same script and pin as the cut's
  3b), `timeout-minutes: 75`, and `cancel-in-progress: false`.
- `browser-checks.yml` is unchanged except for quoting its step name: an unquoted ` #` starts
  a YAML comment, so the name had been parsing as "... (tools/browser-checks.sh," all along.
- `tools/test-browser-checks-workflow.sh`: pins the allowlist job by parsed YAML, since the
  whole-file greps can be satisfied by any job. Pins the full workflow's triggers to exactly
  schedule + workflow_dispatch, with no allowlist, strict pin, provision and macos-latest.
  Adds a raw-line guard against unquoted ` #` in step names. Fails under CI without ruby, and
  prints a visible SKIP elsewhere.

## Rejected
- Covering-only (the surface map): misses the CSS class, measured above.
- A per-PR full job (review iteration 1, two blockers): a red check run on a PR stops
  /merge-on-green even with job-level continue-on-error; the full set false-reds on this
  runner (browser-checks.yml header, 2026-09-07); a 30-75 minute job on each of about 129
  weekly runs contends for the account's macOS runners; and cancel-in-progress would kill
  it on every re-push. Nightly gives up the PR-time signal and moves first detection from
  "the next cut" to "the next morning".
- Replacing the allowlist job with the full set: its fast DOM-state green means something
  specific.

## Weakest premise
That a nightly red gets seen before the next cut. GitHub notifies the actor behind a
scheduled run's failure, not the fleet. The cut preflight does not yet read the last
nightly result; that is the natural follow-up if nightly reds go unseen.
Second: the runner false-red set. The 2026-09-07 first full run false-red on timing/paint
checks. Repeated nightly runs on an unchanged main measure the current set; none is called
runner-fragile from a single run.

Found, not fixed here (outside this change): browser-checks.yml's header says the cut's 3b
is "headed", in five places, but the cut runs it headless (run_one sets HEADED=0;
release.sh labels step 3b "headless").

## Proof
- tools/test-browser-checks-workflow.sh green, and red under five injected regressions: the
  allowlist job's run line deleted (the review's repro), its runs-on changed, pull_request
  added to the full workflow, an allowlist on the full job, and an unquoted step name.
