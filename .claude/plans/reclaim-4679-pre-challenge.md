## [CHALLENGE-LOOP] Summary

**Iterations:** 4, blind, alternating Opus and Sonnet review perspectives.
**Converged:** Yes. Iteration 4 raised no new actionable findings.
**Total findings:** 8 actionable (0 BLOCKERs, 5 WARNINGs, 3 CONVENTIONs), all resolved.
**Fixed:** 8 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation:**
- `tools/test-kosmos-addr-reclaim-3079.sh`: 20/20 tests pass (decision matrix, own install real listener reclaim, second install real listener keep, stranger listener keep).
- `cli.start-reclaim-4679.test.js`: 1/1 pass in 4.5s (KOSMOS_RECLAIM_BUSY=1 start refuses without killing second install stub; status exits 1 stranger instead of exit 4 busy).
- `cli.sandbox-data-4796.test.js`: 3/3 pass (#4796 data root compliance).
- `tools/test-board-watchdog-2955.sh`: 38/38 pass (watchdog backoff and crash-loop handling).
- Zero em dashes: verified across all code, tests, and documentation.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION
- [WARNING] install/kosmos:625: an older caller passing 3 arguments to `_kosmos_reclaim_decision` could cause unbound variable error under `set -u` or behave unexpectedly -> FIXED: `_ours="${4:-0}"` defaults missing argument to 0 (keep, fail-safe).
- [WARNING] install/kosmos:609: `ps -o command=` without `-ww` can truncate long command lines on macOS if parent shell has a narrow window width -> FIXED: changed to `/bin/ps -ww -o command= -p "$_pid"`, matching setup.sh lines 2803 and 4323.
- [CONVENTION] install/kosmos:1134: generic "Another app" message does not tell the user that the holder is another Kosmos install of theirs -> FIXED: added specific branch dying with "Another Kosmos install of yours on this computer is already using port $PORT. Quit that board, or set KOSMOS_PORT to a different number."

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION
- [WARNING] install/kosmos:451: `_health_no_answer` classified any same-uid Kosmos process as `busy`, causing `kosmos status` to report another install's board as ours (busy, exit 4) -> FIXED: added `[ "${_lours:-0}" != 1 ]` check so another install's non-answering board is classified as `stranger` (exit 1).
- [WARNING] install/kosmos:614: `KOSMOS_HOME` fallback when invoked in an environment where `KOSMOS_HOME` is unset -> FIXED: uses `"${KOSMOS_HOME:-$HOME/.local/share/kosmos}/app/server.js"`.
- [CONVENTION] tools/test-kosmos-addr-reclaim-3079.sh: test did not assert `ours=0` on real second install listener -> FIXED: added Arm 1 asserting `ours=0` and decision `keep` against real second install server.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
- [WARNING] bin/board-watchdog.sh: verify that a watchdog running with `KOSMOS_RECLAIM_BUSY=1` against another install's board does not spin in a tight restart loop -> VERIFIED: `board-watchdog.sh` increments `FAILS` on every attempt and enters `MAX_FAILS` backoff/cooldown (lines 62-66, 255); verified by `test-board-watchdog-2955.sh`.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION
- [CONVENTION] em dash audit: verify zero em dashes (`\u2014`, `\u2013`, or `--` used as dash) across all modified files and plans -> VERIFIED: automated python check confirms zero em dashes.
- Converged.
