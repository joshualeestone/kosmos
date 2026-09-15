# Plan: browser-gate-ci-armed-2518 -- keep the PR-time browser-check gates ARMED in CI (#2518)

## The gap (this is the CI-integration half of #2518)

#2518's umbrella is "cut-time-only browser checks stale silently because no PR gate catches them."
PigeonPete built the durable mechanism: each browser-check declares the web tokens it asserts
(`// Browser-check-surface:`), and `tools/lib/browser-check-surface-gate.sh`
(`kosmos_browser_check_surface_gate`) refuses a `web/index.html` change that touches a mapped token
without updating that check. Its coarse sibling is #1720's `kosmos_browser_check_gate`. Both run
inside `tools/run-tests.sh`, which `.github/workflows/test.yml` runs on every PR.

The remaining half, this branch's claim (Baron Draxum, per the plan's ownership line and PigeonPete's
"#2518 stays open under Baron's CI-integration claim" comment): VALIDATE that those gates actually
FIRE in CI, and GUARD that they keep firing.

Measured, not assumed: both gates diff `origin/main...HEAD` and are FAIL-SOFT (return 0 when they
cannot resolve that range). Locally every clone has `origin/main`, so they fire. In CI, `origin/main`
exists only because `test.yml` sets `fetch-depth: 0` (checkout@v4 then fetches the all-heads refspec
`+refs/heads/*:refs/remotes/origin/*`). The default depth fetches only the triggering branch, so
`origin/main` is ABSENT and BOTH gates fail-soft to a vacuous pass while CI stays green. Confirmed in
CI run 35013011226 (members-avatar-circle-3110): the checkout log shows `main -> origin/main` and the
surface gate executed against the branch diff. But `test.yml`'s comment (tagged #1794) explains
`fetch-depth: 0` only as #1025's range resolution, so a future refactor of that range logic could
drop it and silently disarm both gates. Nothing guarded that. That is the
`a-fix-to-the-update-path-cannot-arrive-through-it` /
`a-test-nothing-runs-is-an-unarmed-guard` hazard.

## The fix (this branch)

`tools/test-ci-gate-armed-2518.sh` -- a static, no-browser guard that runs in `test:shell` on every
PR (even PRs that do not touch the rendered surface, so a PR that disarms the gate is caught). It pins:

1. `test.yml` checks out with `fetch-depth: 0` (so `origin/main` resolves and the diff gates are
   non-vacuous). Anchored on the YAML key line so a prose mention cannot false-pass; asserts exactly
   `0`, so `fetch-depth: 1` reds too.
2. `test.yml` runs `tools/run-tests.sh` on a NON-comment line (tolerates a multiline `run: |` block;
   a `#`-prose mention does not satisfy it).
3. `run-tests.sh` sources-and-invokes BOTH gate functions, each matched on a NON-comment line, so a
   commented-out gate call (which leaves the `&& <fn> )` substring in the file) cannot false-pass.
4. Both gate libs exist and parse.

Part B perturbs temp copies (remove/alter `fetch-depth`; comment out the run-tests invocation and each
gate call, using a `|`-delimited sed address where the pattern contains a `/`) to prove each Part A
assertion reds when broken, so the guard cannot pass vacuously.

Wired into `test:shell` as an EXECUTED test (not `bash -n` only), satisfying the
`tools.every-test-runs.test.js` meta-guard. Modeled on the sibling `tools/test-browser-checks-workflow.sh`
(#2445), which pins the analogous invariants for `browser-checks.yml`.

## Why not the alternatives

- A scheduled full-3b headless CI run false-reds on the timing/paint checks (SwiftShader), which is
  why CI runs only the DOM-state allowlist. The surface gate is precise AND fully no-browser, so it
  has no false-red risk by construction -- that discharges the "false-red history" concern in my
  ownership line.
- Growing the surface map to the full ~133 checks is PigeonPete's ongoing batch work under the same
  umbrella. This branch does not touch the map; it guards the CI arming, which is orthogonal and
  non-colliding.

## Test

- `bash tools/test-ci-gate-armed-2518.sh` -> all arms pass incl. red-capability perturbations.
- `node --test tools.every-test-runs.test.js` -> registration meta-guard green.
- Full suite `bash tools/run-tests.sh` -> exit 0.

## Scope / ownership

Closes the CI-integration / gate-arming half of #2518. The umbrella #2518 stays OPEN for PigeonPete's
surface-map growth. PR references it non-closing (`Addresses #2518`).

## Acceptance

A future change that drops `fetch-depth: 0` from `test.yml`, or removes/comments out either gate call
in `run-tests.sh`, reds this guard at PR time instead of silently disarming the browser-check gates.
Validation green; the guard proven red-capable by its own Part B.
