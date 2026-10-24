---
pre_challenge: true
method: challenge-loop
branch: winusage-6570
diff_hash: ae630e844f1cac6963a898c1db6a168a34d6d97c819f933ce749cd7ab7879bf3
validation: passed
subdir_audit: passed
timestamp: 2026-10-22T05:57:16Z
iterations: 5
converged: true
---

## Challenge loop: five fresh blind review rounds, separate subagents

Each round was a new subagent with no memory of the earlier ones, given the diff against origin/main and the plan,
asked for actionable defects only. Fixes were committed between rounds.

### Round 1: four findings, all fixed
- [SHOULD-FIX] latestWins still refused a live reading whose reset was earlier than the stored one (a folder re-signed
  to another account): fixed, a different window is taken while its reset is ahead; test added.
- [SHOULD-FIX] weeklyBlockedOf still said "not-wired" (will not update, offer set-up) under a live Windows reading:
  fixed, no reason on win32; accountsweekly.test.js and server.allowance-3946.test.js updated with platform arms.
- [SHOULD-FIX] the weekly meter had no data-resets, so the retry and on-show look missed its reset: fixed
  (acct-usage-week in ACCT_RESET_SEL); browser-check assertion added.
- [NIT] main()'s production wiring untested: fixed, a main() test that fails with the wiring removed (control run).

### Round 2: three NITs, two acted on
- History could mix two accounts and skew the calibration on a downward step: fixed, history restarts.
- Two agents racing on one account: documented in record().
- The win32 arm in server.allowance-3946.test.js never runs in CI (the file is excluded on Windows CI): kept on
  purpose, it is what makes the file honest when run on a Windows box, as done here.

### Round 3: one SHOULD-FIX and two NITs, all fixed
- A HIGHER figure from another account with a reset within a day kept the old rows: history now restarts on any change
  of reset time (60 s epsilon; measured: one account's reset is one fixed time a day apart).
- Default-folder guard comment overstated (a Scheduled Task carries no AGENT_WORKFORCE_HOME): reworded.
- The account folder was resolved once at start: now asked at each reading; test added.

### Round 4: two NITs, both fixed
- The same figure under a moved reset was skipped: now recorded.
- usageDirFor treated an omitted runner as non-Claude: an omitted runner means Claude, as in win32launch.

### Round 5: NO ACTIONABLE FINDINGS

## Validation (this Windows box)
- engine/win32usage-6570.test.js 15/15; with the fix reverted 7 of the first 9 fail (the end-to-end one: "both
  readings are on the row: {w:null,f:null}"); with only main()'s wiring removed the main() test fails.
- Related suites (18 files, 334 tests): the same 60 failures, by name and reason, as a clean origin/main checkout
  (pre-existing on this box: bash/setup.sh and download-check arms).
- Browser check render-account-usage-6108 (Chromium via the box's Edge shim; WebKit not available here, CI runs it):
  228 PASS; with the page fix reverted the #6570 assertions FAIL.
- Browser-check gates (tools/lib/browser-check-gate.sh, browser-check-surface-gate.sh): pass.
- Live: a real claude.exe stream-json turn on the default account, through the worktree's reader and publisher into a
  sandbox account folder seeded with the real folder's stale 96%: reads back weekly 4%, five-hour 19%.
