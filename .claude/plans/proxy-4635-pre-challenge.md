# Challenge-Loop Proof: proxy-4635

## Summary
- Card: kosmos#4635 (priority bug: In a shell with a proxy set, kosmos start kills a healthy board as your own stale Kosmos, and status says not running).
- Branch: proxy-4635
- Target: origin/main
- Test file: cli.proxy-4635.test.js (7 passing tests in 15.6s via `tools/run-tests.sh --only cli.proxy-4635.test.js`)

## Validation Log
Light run on Mortals per fleet discipline:
- `tools/run-tests.sh --only cli.proxy-4635.test.js`: 7 passed, 0 failed, 0 leak warnings.
- `bash tools/test-kosmos-help-exit0-3036.sh`: 21 passed, 0 failed.
- `bash tools/test-kosmos-addr-reclaim-3079.sh`: 12 passed, 0 failed.
- `bash -n install/kosmos`: clean syntax check.

## Challenge Loop Breakdown

### Iteration 1
- Finding: STUB path in test helper was created at ROOT/server.js instead of ROOT/app/server.js. Because running_pid requires matching "app/server.js" in the process command line, the second guard test failed to match running_pid and fell through to reclaim.
- Resolution: Created ROOT/app directory and placed STUB at ROOT/app/server.js, matching canonical Kosmos server path structure. Imported node:http.
- Outcome: All 7 arms pass, including the control proving unfixed code kills the board.

### Iteration 2
- Finding: Verified whether existing no_proxy values (e.g. no_proxy=corp.example) are preserved when 127.0.0.1,localhost is prepended.
- Resolution: Added test arm with `http_proxy: DEAD_PROXY, no_proxy: 'corp.example'`, verifying both status and post pass cleanly without overwriting the caller's list.
- Outcome: Converged.

## Final Ledger
| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BUG | cli.proxy-4635.test.js:30 | SELF | STUB path missed app/ prefix for running_pid | FIXED | Placed at ROOT/app/server.js |
| 2 | 1 | BUG | cli.proxy-4635.test.js:160 | SELF | http module not imported | FIXED | Added import |
| 3 | 2 | COVERAGE | cli.proxy-4635.test.js:88 | SELF | verify preservation of existing caller no_proxy | FIXED | Added arm |
