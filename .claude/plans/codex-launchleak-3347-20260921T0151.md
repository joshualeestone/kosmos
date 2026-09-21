# #3347 -- codex tests leak real LaunchAgents (sibling of #3011)

## Problem
A full `run-tests.sh` created REAL plists in the operator's `~/Library/LaunchAgents`
-> phantom agents on the fleet board + the #3011 leak-guard reds the whole suite. Root cause:
engine tests that write agent plists via `create.plistPath` (which resolves
`agentsDir() = process.env.AGENT_WORKFORCE_LAUNCH || ~/Library/LaunchAgents`, create.js:238)
without setting AGENT_WORKFORCE_LAUNCH to their sandbox. #3011 fixed ONE such test
(status.codex-observed-2413); this is the wider CLASS.

## Emitters found (by measurement, not the #3347 candidate guess)
A sandboxed full-engine run (AGENT_WORKFORCE_LAUNCH -> tmp) leaked 11 plists from THREE tests:
- engine/status.codex-account-home-2906.test.js -> beta/delta/echo/gamma/golf/hotel/india/juliet/malformed (9)
- engine/status.openai-ring-2257.test.js -> roo-the-cat (1)
- engine/create.win32-launch-570.test.js -> macjob (1)
Each had its own SANDBOX + set AGENT_WORKFORCE_{DATA,HOME,WORKERS,...} but MISSED AGENT_WORKFORCE_LAUNCH.

## Fix
Added the #3011 pattern to each of the three: after their existing sandbox env setup,
`process.env.AGENT_WORKFORCE_LAUNCH = path.join(<their sandbox>, 'LaunchAgents')` + `fs.mkdirSync(..., {recursive:true})`.
Minimal, matches the proven #3011 fix. The existing run-tests.sh leak-guard remains the regression
backstop (reds if any future test leaks), so no new shared helper was required.

## Verified
- 3 fixed tests pass (9/9, 7/7, 10/10, 0 fail).
- Full engine suite sandboxed leaks 0 plists (was 11).
- Running the 3 tests with NO env override leaves real ~/Library/LaunchAgents unchanged (72 -> 72).
- status.codex-observed-2413 (the #3011 fix) confirmed NOT leaking in isolation.

## Rejected / notes
- A suite-wide AGENT_WORKFORCE_LAUNCH default in run-tests.sh would be more regression-proof but
  RISKS breaking tests that assert agentsDir()/the real default (machine/status/create/ etc. ref it);
  per-test #3011 pattern is lower-risk and matches the established convention.
- #3347 named codex{notworking,ok,once,resolve,stale}; those are status.codex-observed-2413's
  fixtures (already guarded by #3011). The reproducible current leakers are the 3 above; the codex*
  names were stale residue (cleaned) and are guarded, so not re-emitted.
