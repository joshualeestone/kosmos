# pr-browser-gate-2445: run the cut-time browser checks in the per-PR gate

Splinter routed, Baron (#2444) scoped and reviewed. Card #2445.

## Problem
`tools/browser-checks.sh` (63 page-layer checks under `docs/browser-checks/`) runs ONLY at release
cut step 3b (`tools/release.sh`), NOT in the per-PR gate. So a change to a gate's rendered behavior
passes its own PR (green `test.yml`, green challenge-loop) and only fails WEEKS later at cut,
blocking a release for a reason invisible when it merged. Measured 2026-09-07: #2085 added a
`data-checking` state that hid the S3 button on an uncheckable gate row; the `click-first-run` check
clicks that button, so post-#2085 it waited on a permanently-hidden element and timed out. #2085 was
green through its PR and flaked the 0.6.47 cut twice before #2444 fixed the stale check.

## Design decision (answers the card's three open questions)
A new `.github/workflows/browser-checks.yml`: `on: pull_request` with a PATHS filter, `runs-on:
macos-latest`, steps = checkout, setup-node 26, `bash tools/provision-pw.sh` (pins Playwright 1.62.1
+ browsers to `~/work/pw-runtime`), then `KOSMOS_PW_STRICT_VERSION=1 bash tools/browser-checks.sh`.
Advisory like `test.yml` (no required branch protection, #835), so create-pr's CI-watch honors it.

- **Q2 (CI vs local): CI.** The load concern that makes a local run unsafe is CROSS-AGENT Playwright
  starvation on the shared box (browser-checks.sh's own header; Baron measured the cut peak at load
  13.87 with other agents competing). A GitHub Actions runner is a SEPARATE machine with none of that
  fleet load, so the browser cost is paid off the box entirely. This is the load-wrinkle answer.
- **Q1 (full vs subset): a MEASURED headless-robust DOM-state SUBSET (Baron option d, #2445).** The
  first real full-suite run on macos-latest (2026-09-07) FALSE-RED on the timing/animation/paint
  checks: on a slow, headless (SwiftShader software-rendering) runner they are both slow-runner
  -fragile and headless-weak, so they red without a defect. Those stay at the headed cut-time 3b.
  CI runs only the timing-insensitive, headless-robust DOM-state class (the #2085 gate class:
  element present/hidden/clickable/labeled), named in `KOSMOS_BC_CI_ALLOWLIST` on the run step.
  browser-checks.sh runs ONLY the allowlisted checks and HARD-FAILS if the list matches nothing.
  Note the TWO scopings are different axes: the PATHS filter (Q3) scopes WHICH PRs pay; the allowlist
  scopes WHAT RUNS, and therefore what a green covers. A green here is the DOM-state gate, NOT full
  3b coverage. click-first-run (the install-flow clickthrough) is deliberately NOT in the allowlist:
  measured, it clears the Welcome screen then `page.click('#fr-next')` times out "not visible" under
  SwiftShader (the Welcome->Next transition never paints), so it is headless-weak and stays at 3b;
  the install-flow GATE class it exists for is still covered headless by render-gated-next and
  render-connect-skip. The 7-check subset runs in ~3m20s.
- **Q3 (scoping): PATHS filter** on `web/index.html`, `docs/browser-checks/**`, `tools/browser-checks.sh`,
  `tools/provision-pw.sh`, and the workflow file itself. Only PRs touching the rendered surface pay the
  cost (the 7-check subset is ~3m20s + ~2-4 min provision). #2085 touched `web/index.html`, so it WOULD
  have triggered and caught the break.

Runner-self-contained: the checks mock the gates (#2444's own fix depends on mocked
checkable-not-granted gates) and use `test-support/fake-tmux.sh`, so no real-Mac TCC/accessibility is
needed; `test.yml` already proves macos-latest works. No tmux install (unlike test.yml).

## Two eyes-open limits (Baron, carried in the workflow header; neither blocks)
1. **Intra-run contention remains.** CI-isolation removes the cross-agent half only. browser-checks.sh
   (#1079) records that the checks' OWN concurrent board servers starve the heaviest check within a
   single run -- and that is `click-first-run`, the one that flaked the cut. A macos-latest runner is
   SMALLER than the 10-core build box, so it could still exceed its ~30s page.click timeout with zero
   other agents. Mitigated by `run_one`'s retry-once + a 40-min job timeout. No workflow-level
   concurrency knob exists (the contention is a single heavy check booting several board servers, a
   harness concern). Plan: watch the first real runs; if `click-first-run` flakes persistently, file a
   harness card to reduce intra-run board concurrency. Baron holds the freshest context on that check.
2. **Headless CI is SwiftShader software rendering.** The DOM/state checks that matter for the #2085
   class (element present/hidden/clickable) are fully covered headless; compositor/paint/screenshot
   checks are WEAKER than the headed cut-time 3b on real hardware (org BROWSER_TESTING note). So a
   green here catches rendered-BEHAVIOR regressions but is NOT a replacement for the headed 3b on
   paint-level checks. Stated in the header so nobody reads CI-green as identical to a cut 3b green.

## Guard test (tools/test-browser-checks-workflow.sh, in test:shell)
Pins the invariants that make the workflow actually GATE, so a future edit cannot silently un-gate it:
runs browser-checks.sh with `KOSMOS_PW_STRICT_VERSION=1`, provisions via provision-pw.sh, triggers on
pull_request, the PATHS filter LISTS the rendered surface, macos-latest. It runs in `test.yml` on
EVERY PR (even ones that do not trigger the browser workflow), so a broken workflow file is caught.
- 🔑 The path-filter assertion matches the YAML LIST-ITEM form (`- 'web/index.html'`), not the bare
  string: the header comment also names those paths in prose, and a bare-string grep false-passed on
  the comment even with the path dropped from the filter (caught by perturbation). Perturbation-verified:
  dropping a path list-entry OR the browser-checks.sh call reds the test.

## Deferred (noted, not done)
- **Playwright runtime caching** (a cheap speedup): `~/work/pw-runtime` + the browser cache are fresh
  each run, so provision re-installs playwright@1.62.1 + browsers (~2-4 min) every triggered run. An
  `actions/cache` keyed on the pinned version would make most runs a no-op. Deferred: runs are
  path-filtered/infrequent so the saving is minor, and a fresh provision avoids cache-staleness risk
  (a corrupt/partial cache defeating provision-pw's idempotency check). Revisit if CI time becomes a
  concern.
- **Trigger leak (server/engine -> rendered data)**: see the workflow header's caveat 3. Adding
  `engine/**`/`server.js` to the filter would fire the suite on the majority of PRs and defeat the
  load-scoping, so the narrow filter is deliberate and the cut's 3b is the backstop for that class.

## Verification
The PR itself runs the new workflow end to end (the workflow is in its own path filter). Locally:
`bash tools/test-browser-checks-workflow.sh` green + perturbation-verified; `test.yml`'s node suite is
unaffected (this touches CI config + a shell test + package.json, no engine change).
