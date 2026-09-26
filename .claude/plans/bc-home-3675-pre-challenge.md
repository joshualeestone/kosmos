---
pre_challenge: true
method: challenge-loop
branch: bc-home-3675
diff_hash: 51856153d2ad3962ef3ac5fad6ac36600f394c21fabc87491ee2be44013786bb
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T08:04:15Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** see per-iteration notes (the itemised ledger for rounds 1 to 5 was held in a session that ended on an account limit; those rounds are recorded here from their fix commits, not from the lost ledger)
**Fixed:** rounds 1, 2, 3 and 5 each produced a fix commit | **Deferred:** 1 (round 6) | **Asked (awaiting user):** 0

Resumption note: rounds 1 to 5 ran in the prior session (commits b813793a..93a924ef after the
rebase onto origin/main at 2026-09-25 02:50 CDT). Round 6 was launched there and lost to the
account limit; it was re-run blind here on the rebased HEAD 93a924ef. Full validation on that HEAD:
9155 tests, 0 fail, subdir audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (prior session)
**Self-generated:** 0
- [WARNING] engine/subscription.js read path — the subscription check read the host ~/.claude.json, not the home seam --> FIXED (commit b813793a: the lib defaults AGENT_WORKFORCE_CLAUDE_CONFIG into the sandbox; fixtures scoped)

#### Iteration 2
**Reviewer model:** unknown (prior session)
- [WARNING] docs/browser-checks/README.md — the manual render-create-made recipe was not sandboxed --> FIXED (commit 1508e5c1)

#### Iteration 3
**Reviewer model:** unknown (prior session)
- [WARNING] docs/browser-checks/lib-sandbox-home.js — an ambient CODEX_HOME was read before the seam; setting it to a sandbox would put the board in the #1488 named-codex-home mode --> FIXED (commit c51e0134: removed rather than set, README recipe updated)

#### Iteration 4
**Reviewer model:** unknown (prior session)
**New findings:** plan citation only
- [CONVENTION] .claude/plans/bc-home-3675.md — plan cited a browser-check run on superseded code --> FIXED (commit 17782a49)

#### Iteration 5
**Reviewer model:** unknown (prior session)
- [WARNING] docs/browser-checks/render-assistant-bubble-3034.js — a board-booting check arriving from main after the rebase was not wired to the lib --> FIXED (commit 86ebd4f1; README; Claude config moved into a lib-made folder)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (deferred), 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] docs/browser-checks/lib-sandbox-home.js:29 — temp home removed only on normal exit, not on SIGTERM/SIGKILL --> DEFERRED: documented in the plan's "Not built here"; a leftover folder holds only fixture data (fixture@example.invalid), no host account, so it is disk clutter, not the leak this card closes
- [NIT] tools/browser-checks.sh:1067 — sb8 fixture setup repeats sb4's three lines
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/subscription.js | BRANCH | subscription check read host config | FIXED | b813793a |
| 2 | 2 | WARNING | docs/browser-checks/README.md | BRANCH | manual recipe unsandboxed | FIXED | 1508e5c1 |
| 3 | 3 | WARNING | docs/browser-checks/lib-sandbox-home.js | BRANCH | ambient codex home read first | FIXED | c51e0134 |
| 4 | 4 | CONVENTION | .claude/plans/bc-home-3675.md | BRANCH | stale run citation | FIXED | 17782a49 |
| 5 | 5 | WARNING | docs/browser-checks/render-assistant-bubble-3034.js | BRANCH | new check unwired after rebase | FIXED | 86ebd4f1 |
| 6 | 6 | WARNING | docs/browser-checks/lib-sandbox-home.js:29 | BRANCH | no signal-time cleanup | DEFERRED | plan "Not built here", fixture-only contents |

### NITs (non-blocking, across all iterations)
- [NIT] tools/browser-checks.sh:1067 — sb8 duplicates sb4's fixture-account lines (iteration 6)

### Strengths (across all iterations)
- [STRENGTH] — Reviewer independently confirmed 57/57 board-booting checks require the lib, and the argv-URL checks are correctly excluded (iteration 6)
- [STRENGTH] — Negative control verified: removing the require from render-settings-nav.js makes the wiring test fail (iteration 6)
- [STRENGTH] — render-talk-fill-2622's secondary fixture account traced against subscription.js and confirmed deliberate (iteration 6)
