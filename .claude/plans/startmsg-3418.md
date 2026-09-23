# startmsg-3418 — adapt render-start-agent-3410 to the landed #3418 bootstrap

## Problem
`docs/browser-checks/render-start-agent-3410.js` has been red on origin/main since
#3418 landed (as PR #3429, commit 763cc06fd, "restart reports RESTARTED even when
the relaunch silently failed"). Confirmed by differential: the check fails
identically on clean origin/main and on any branch, so it reddens every PR's CI.

Root cause: Part 7 drives the REAL /restart route against a genuinely-offline
(FOUND.NONE) agent. Pre-#3418 that route REFUSED with "could not start", which the
arm asserted. Post-#3418 the route BOOTSTRAPS the launchd job instead; in the
browser-check sandbox live-execution is dry-run (launchctl is a no-op), so the job
never reports ready and the honest "has not come back yet" line is written — the
same line Part 4's not-ready (Nyx) arm already asserts. The Part 7 assertion was
still expecting the stale "could not start" string.

The check's own Part 7 comment predicted exactly this: "it will go red once #3418
makes FOUND.NONE bootstrap the launchd job, which is the correct signal to update
this arm." This branch is that update.

## Change
`docs/browser-checks/render-start-agent-3410.js` only (test-only, no product code):
- Part 7 wait-for + assertion: `/could not start/i` -> `/has not come back/i`,
  mirroring Part 4's #3418-defense arm. The "no false Started" and button-re-enable
  arms are unchanged, so the check stays fail-capable (red on a regression to the
  old refusal, on a false "Started", or on a stuck-disabled button).
- Part 7 comment + the 'ghost' fixture setup comment updated to describe the
  post-#3418 bootstrap-then-timeout path instead of the retired refusal.

## Decisions
- The mocked-refusal arms (Parts 3/3b, FOUND.OURS 'nyx' with an explicit
  `outcome:'refused'`) legitimately still say "could not start" — a different code
  path (`restartTook` false) — and are deliberately left unchanged.
- OUT OF SCOPE (tracked as a follow-up): the `d-start-wrap` comment in
  web/index.html (~8601-8604) still frames #3418 as pending ("only once Angel's
  #3418 makes the FOUND.NONE branch bootstrap"). That is product code, would trip
  the surface gate + re-run the browser suite, and is unrelated to this test fix.
  It gets its own small change so this branch stays test-only.

## Verification
render-start-agent-3410.js runs green (rc=0, all arms) after the change; red on
origin/main before it. Full node --test suite passes (8102 tests, 0 fail).
