---
pre_challenge: true
method: challenge-loop
branch: board-wake-reclaim-4342
diff_hash: 9541709a91d822887b7971b42d6e85ee88580cbc21a062693cdc05c5b473f6b8
validation: passed
subdir_audit: passed
timestamp: 2026-10-07T23:45:50Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 3 actionable-category (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT), plus 4 STRENGTHs
**Fixed:** 0 | **Deferred:** 2 | **Asked (awaiting user):** 0

Card #4342 (bug, claimed:raiden): on macOS the local board is alive-but-wedged after the Mac wakes from
sleep — it holds :16180 but never answers, so the window says "Kosmos is not answering" until a
quit/reopen. Fix (native-app/main.swift): a run-computer `NSWorkspace.didWakeNotification` observer that,
on a CONFIRMED double-timeout of the light `/api/health` probe (~34s: 20s first-probe grace + 4s settle +
10s confirm), reclaim-restarts the board via the watchdog's own `KOSMOS_RECLAIM_BUSY=1 kosmos start
--force`. Any HTTP answer = alive (a busy board is never reclaimed — the #4466 harm avoided); a
refused/`.down` board is left to launchd to avoid racing a mid-boot relaunch. Decision is a pure function
diffed at build by `--kosmos-app-wake-reclaim-selftest`. The macOS analog of Windows' ReplaceBoardIfStuck
(#4543).

This run finalizes the proof on head 52881b808 (rebased onto main-with-#5474). The code is byte-identical
to a tree that earlier converged 7 blind passes (opus+sonnet) and was peer-approved; that earlier loop
never wrote a proof because its final-validation gate was red on an UNRELATED known-red fixture
(cli.sandbox-4636.test.js:159), since fixed by the merged #5474. This finalizing pass ran one fresh blind
opus review (below); the full suite is green on this exact head (16395 tests / 16163 pass / 0 fail /
0 cancelled / 232 skip, validation PASSED hash=9541709a91d8).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty — this loop committed no fixes, so nothing to blame
against; both WARNINGs are BRANCH)
- [WARNING] native-app/main.swift (bounded-mitigation residual) — a *healthy* board blocked synchronously
  for the full ~34s window after wake would be reclaimed, a narrow version of the #4466 harm. --> DEFERRED:
  by design per the plan. The guard is explicitly a BOUNDED mitigation; the categorical CPU-busy check is
  the deferred live-QA follow-up. Documented in the code's doc comment and the plan's GAPS DECIDED, and
  peer-approved. The reviewer itself flagged it as "accepted-and-deferred, not resolved."
- [WARNING] .claude/plans/board-wake-reclaim-4342-20261007T0837.md — no live sleep/wake reproduction was
  possible on the shared box; correctness that a post-wake wedge presents as NSURLErrorTimedOut (not
  reset/refused) rests on an architecture-derived assumption. --> DEFERRED: known limitation documented in
  the plan; the owed live repro on a spare/personal Mac is a follow-up and is FLAGGED in the PR. A
  reset/refused wedge classifies `.down` and falls through to the slower watchdog path (correct, just
  slower), so this is a latency-of-recovery risk, not a data/logic defect.
- [NIT] native-app/main.swift (.down branch) — assumes launchd's PathState KeepAlive relaunches a
  cleanly-exited board; if not, recovery falls to the watchdog's slower path. The comment acknowledges the
  watchdog is the backstop — a conscious conservative choice, not a defect.
**Converged** — zero NEW actionable findings after deferral; no unresolved ASKED findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | native-app/main.swift (bounded guard) | BRANCH | healthy board blocked ~34s is reclaimed | DEFERRED | By design per plan; bounded mitigation, CPU-busy check is the live-QA follow-up; peer-approved |
| 2 | 1 | WARNING | .claude/plans/board-wake-reclaim-4342-20261007T0837.md | BRANCH | no live sleep repro; wedge-as-timeout assumption | DEFERRED | Known limitation documented in plan; owed live repro flagged in PR; reset/refused falls to slower watchdog path, not a defect |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking)
- [NIT] native-app/main.swift (.down branch) — relies on launchd relaunch; watchdog is the acknowledged backstop (iteration 1).

### Strengths (across the run)
- The wake decision is a pure `wakeProbeOutcome(hasHTTPResponse:errorCode:)` diffed at build against a hardcoded 4-row truth table via `--kosmos-app-wake-reclaim-selftest`; the build fails closed on drift or a hung/missing hatch — a genuine gate, not a false-pass (iteration 1).
- The #4466 false-reclaim harm is carefully avoided: the probe hits light `/api/health`, not the heavy `snapshot()` of `/api/status`, so a busy board answers in ms and classifies `.alive`; only a sustained double-timeout reclaims (iteration 1).
- Overlapping-wake serialization is sound: `wakeRecoveryGeneration` is monotonic (cannot latch), captured at entry and re-checked at all three continuations; the gate is re-checked before each probe and before the kill across the ~34s TOCTOU window; `boardStartInFlight` blocks a wake chain while any start is in flight (iteration 1).
- `reclaimStuckBoard` faithfully mirrors the established `loadBoard`/`ensureBoardRunning` lifecycle — the 300s re-arm watchdog (#965) and the #4356 connect-undo placed before the stale-generation guard with balanced bookkeeping, so a reclaim finishing after a switch to Connect is stopped, not orphaned (iteration 1).
