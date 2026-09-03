---
pre_challenge: true
method: challenge-loop
branch: open-verb-1957
diff_hash: 2c13da12ef7a4849237d4aba2bb63050b701721314dc6ee4783a28791292a001
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T05:24:42Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind-agent review passes (plus a clean 6.0 baseline)
**Converged:** Yes - iteration 2 produced zero NEW BLOCKERs/WARNINGs/CONVENTIONs (its one WARNING dedups to a deferred iteration-1 concern) and no unresolved ASKED findings.
**Total findings:** 6 (1 WARNING, 1 CONVENTION, 4 NITs) + STRENGTHs
**Fixed:** 2 | **Deferred:** 4 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] .claude/plans/ - No plan file --> FIXED (added open-verb-1957.md)
- [NIT] cli.open-1957.test.js:37 - stubOpen leaks its mkdtemp dirs --> FIXED (rmSync in each finally)
- [NIT] install/kosmos:436 - on an enforcing board the plain-URL fallback loads only the public shell --> DEFERRED (deliberate no-leak tradeoff)
- 5 STRENGTHs: the latent set-e board_token abort is correctly diagnosed and fixed; secret hygiene (plain URL in the message, token only to the opener); set-e handled throughout; the KOSMOS_OPEN_BIN seam is clean and red-capable; removing exec is safe.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (its WARNING dedups), 2 NITs
- [WARNING] install/kosmos:435-436 - enforcing-board manual-fallback degraded --> DEFERRED, DUP of iteration-1 NIT #3. Same concern re-raised at higher severity. My decision (per the decide-it-yourself ruling): keep the plain URL. There is no non-leaky improvement that also helps a genuine open-failure - leaking the token URL into a terminal or support log is worse, the common non-enforcing board works, and the card's scope (silence) is closed. A richer enforcing-board hint is a possible follow-up, not a defect for #1957.
- [NIT] install/kosmos:435 - the "Opening the dashboard" say prints before the opener, so on failure a success-shaped line precedes the die --> DEFERRED (present-progressive is the deliberate and correct phrasing for the headless case, where open exits 0 but nothing visibly opens; "If it does not open, go there yourself" softens it, and the reviewer agreed).
- [NIT] cli.open-1957.test.js - server.close() not awaited in finally --> DEFERRED (harmless: curl uses no keep-alive, the loop drains, node:test exits; no lingering handle observed).
- 5 STRENGTHs: app icon uses `kosmos start` not cmd_open so removing exec is safe; the new root test file is genuinely run (run-tests.sh globs and count-asserts); red-capable against both the historical exec silent-exit-0 and the set-e abort; token never reaches stdout/stderr; the test is hermetic (port 0, own board per arm, seam-stubbed opener, temp dirs cleaned, no injection on the quoted opener/URL).
- **Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | No plan file | FIXED | plan added |
| 2 | 1 | NIT | cli.open-1957.test.js:37 | temp-dir leak | FIXED | rmSync in finally |
| 3 | 1 | NIT | install/kosmos:436 | enforcing-board plain-URL fallback | DEFERRED | deliberate no-leak tradeoff |
| 4 | 2 | WARNING | install/kosmos:435-436 | enforcing-board fallback (re-raise of #3) | DEFERRED | dup of #3; no clean non-leak fix; card scope is silence |
| 5 | 2 | NIT | install/kosmos:435 | say-before-open ordering | DEFERRED | present-progressive is correct for the headless case |
| 6 | 2 | NIT | cli.open-1957.test.js | server.close not awaited | DEFERRED | harmless; no keep-alive, loop drains, node:test exits |

### NITs (non-blocking, across all iterations)
- [NIT] install/kosmos:435 - success-shaped say precedes a possible die (deliberate present-progressive) - iteration 2
- [NIT] cli.open-1957.test.js - server.close not awaited in finally (harmless) - iteration 2

### Strengths (across all iterations)
- The fix correctly diagnoses and closes a second, latent bug: `local _bt; _bt="$(board_token)"` aborts under `set -euo pipefail` on a non-enforcing board (the separate-line form does not mask the substitution's non-zero exit the way `local x=$(...)` would); `_bt="$(board_token || true)"` degrades to the plain URL as intended.
- Secret hygiene: say/die print the plain `$URL`; only the opener receives the token-bearing `_open_url`, so no token reaches a terminal or a support log.
- Removing `exec` is safe: cmd_open is the last statement the dispatcher runs so its exit propagates, the app icon uses `kosmos start` not cmd_open, and `/usr/bin/open` returns promptly with no signal/trap semantics to preserve.
- Hermetic, red-capable test: own fake board per arm on port 0, seam-stubbed opener, temp dirs cleaned; arms 1 and 2 go red on revert to origin/main, and the control pins that silence-plus-exit-0 cannot recur.
