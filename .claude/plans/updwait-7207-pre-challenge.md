---
pre_challenge: true
method: challenge-loop
branch: updwait-7207
diff_hash: 4cb4dfd99aecb77a2e3ad08da3d112b7733d2f12fb2477f0b79955c36e953518
validation: focused-passed; full-suite run 1 red (5 mine, fixed; 4 unrelated), see below
subdir_audit: passed
timestamp: 2026-10-26T17:07:34Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs, accepted in the plan)
**Fixed:** every WARNING from iterations 1-4 except one decided (the restart screen covers the dialog while the board
is down: documented, not changed) | **Asked:** 0

Validation (6j), stated as it happened:
- Focused, on the rebased head (base b085909327): web.update-unanswered-7207, server.test.js,
  web.movestop-offers-6231, web.account-stopmove-6214: 391 tests, 391 pass, 0 fail, rc 0. Browser check
  render-update-toast rc 0 (drives answering, restarted and deadline; red against the old page and against each removed
  guard). Browser-check surface gate (#2518) rc 0, with per-check overrides for render-dialog-gutter-4506 (52 passed on
  this branch) and render-layer-gutter-4494 (13 passed on this branch).
- Full local suite, once (11:1x-11:52 CDT, at b9242dc): 24285 tests, 9 failed, EXIT=1. FIVE were this branch's: two
  server.test.js harnesses and two web.movestop-offers-6231 harnesses that lift the dialog without the globals the press
  now reads, and web.account-stopmove-6214 reading a fixed 4000-character window; all fixed in f86174a (now 82f88db
  after the rebase) and passing above. The browser-check surface gate red (#6791's shell test) is fixed by the
  overrides above. The other three (cli.refused-retry-6968 x2, server.community-read-soon-5636 timing) do not touch
  this change; 6968 passes alone. A second full run was queued and withdrawn at 12:03 with the queue 9 deep; PR CI
  carries the full suite. Not recorded as a local pass.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] Reload (the new deadline one and the existing 409 one) also fired the press listener and POSTed an update
  --> FIXED (reload-only mark; browser check red with it removed, "1 extra POST")
- [WARNING] close and reopen during a wait could leave two waits, or a Roll back wait on an Update dialog --> FIXED
  (UPD_WAIT_GEN)
- [WARNING] "restarted" with the version from before unknown --> FIXED (requires it)
- [WARNING] the restart screen covers the dialog while the board is down --> DECIDED, documented (that screen is the
  signal then)

#### Iteration 2
- [WARNING] the generation was taken after a POST that can hang, so a reopened dialog was written into --> FIXED
  (taken before the POST, with focus)
- [NIT] wording, focus, served-version baseline --> FIXED

#### Iteration 3
- [WARNING] a stale press that came back refused (409) still wrote into the reopened dialog --> FIXED (both branches
  stand down; a stale success still raises the overlay on purpose)
- [WARNING] no browser coverage of restarted or the deadline --> FIXED (both driven; deadline Reload asserts no POST)

#### Iteration 4
- [WARNING] the version and boot from before were read after the POST, where the page's poll may already have seen the
  updated board --> FIXED (pressedOn, taken before the POST; the wait never reads the live values). The first version
  of this fix redeclared `before` and broke the page script; the browser check caught it, fixed in 2fe9377, and the
  unit test now parses the whole page script.

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (a timing read in pressNoAnswer; text-only wiring
tests), accepted in the plan.
**Converged**: no new actionable findings.

### Weakest premise
That /api/status's bootedAt is stable per board process, so "same boot" means the board never went away.
