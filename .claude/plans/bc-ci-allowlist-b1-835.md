# bc-ci-allowlist-b1-835 - expand the per-PR browser-checks CI allowlist (batch 1)

## Source
#835 (cut-efficiency): a broken render check should fail at the PR, not at the release
cut's 3b. `browser-checks.yml` runs only a headless-robust DOM-state SUBSET per PR
(`KOSMOS_BC_CI_ALLOWLIST`); the ~138 other `render-*` checks run only at cut, so a
break in one of them causes the one-at-a-time cut abort this card targets. This is the
first batch of an incremental expansion.

## The mechanism (why adding names is the whole change)
`KOSMOS_BC_CI_ALLOWLIST` is a FILTER over checks the driver already knows how to invoke
(`tools/browser-checks.sh:696` skips any check not in the list; a listed check runs via
its existing invocation). So expanding coverage = adding names; no per-check harness
wiring. Two safety nets make it self-validating:
- `browser-checks.sh:1567`: a listed name that never ran (misspelled, or gated behind a
  board the CI path does not boot) is reported FAILED.
- This PR edits `.github/workflows/browser-checks.yml`, which is in that job's own path
  filter, so the EXPANDED set runs on the runner in THIS PR's CI. A candidate that
  headless-false-reds (paint/timing) or never-runs turns this PR's own CI red before
  merge. The CI is the classifier.

## Change
Add three verified DOM-state candidates to the allowlist:
- **render-engmode-gate-2131** - hidden/visible gate arms (element present/hidden);
  regression guard; reads fs/os, no live board.
- **render-discovery-gate-2651** - asserts `hidden` on the discovery panels on load vs
  after an explicit press; drives the real paint fns against stubbed
  /api/found-agents + /api/scan-agents, no server.
- **render-createnav-2190** - hermetic (file://, no server); asserts SCREEN state after
  the create click; explicitly does NOT assert the loader animation's visual quality
  ("we only assert the loader was started as state"), i.e. deliberately paint-independent.

Each was chosen by reading its header and confirming it asserts DOM state
(present/hidden/clickable/labeled/screen), not paint/geometry/screenshot/timing - the
class the workflow header documents as false-red on the runner's SwiftShader software
rendering.

## Excluded while shortlisting (recorded so a later batch does not re-add them)
- render-github-door - needs two boards booted with special env (AGENT_WORKFORCE_GH_BIN,
  fake-gh/vercel markers, verify ports); likely "never ran" in the CI path.
- render-connect-win32-install-570 - asserts `.fr-cmd` "renders with real area" =
  geometry/computed-layout, headless-fragile.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN
  means all three run and pass headless; a RED naming one of them means drop it (with the
  driver's reason) and re-push. Merge only on green.
- The node unit suite is unaffected (yaml-only change); test.yml stays green.

## What I rejected
- A larger batch: more candidates = more chance one reds and needs a diagnostic CI
  iteration. A small confident batch minimizes iterations on a backed-up runner and
  establishes the pattern; later batches add more the same way.
- Making the check required / branch protection: that is the card's decision-gated
  residual (public-repo required+path-filter deadlock + all-18 merge-cadence change;
  private repos need Josh's Pro/make-public money call). Out of scope for this in-lane PR.

## Weakest premise
That all three run green headless on the runner. If one does not (false-red or never-ran),
this PR's own CI catches it before merge and I drop that name - the change is
self-validating, so a wrong pick costs an iteration, never a bad merge.
