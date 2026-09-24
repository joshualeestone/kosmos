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
- `.github/workflows/browser-checks.yml`: a second job, `browser-checks-full`, on the same
  PR trigger. It runs `tools/browser-checks.sh` with no allowlist (the whole set, headless
  via run_one, the same script and pin as the cut's 3b), with `continue-on-error: true` so
  it is advisory, and `timeout-minutes: 75`. The allowlist job is unchanged.
- Both step names quoted: an unquoted ` #` starts a YAML comment, and the existing step's
  name had been parsing as "... (tools/browser-checks.sh," all along.
- `tools/test-browser-checks-workflow.sh`: per-job invariants (the allowlist job gates;
  the full job is advisory, allowlist-free, strict-pinned, on macos-latest) and a guard that
  no step name is cut short. Red under each of three injected regressions.

## Rejected
- Covering-only (the surface map): misses the CSS class, measured above.
- Replacing the allowlist job with the full set: the fast DOM-state green means something
  specific, and the full set has runner-fragile timing/paint checks.
- Making the full job gating now: its baseline on an unchanged tree is unknown, and a red
  that is usually noise trains people to ignore red.

## Weakest premise
That the runner false-red set is small and stable. The PR's own run is the first
baseline (main plus a workflow-only change, so any red there is the runner). It is
recorded on #2518, and it gets repeated before any check is called runner-fragile, because
a 1-in-5 flake does not show in one run.

## Proof
- Ruby YAML parse of both jobs; tools/test-browser-checks-workflow.sh green, and red under
  each injected regression (unquoted step name, continue-on-error false, an allowlist on
  the full job).
