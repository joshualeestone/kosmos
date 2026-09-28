---
pre_challenge: true
method: challenge-loop
branch: agyhooks-4353
diff_hash: 4e8e976072335f9d5069706478c2311e4b2145e473b50353f23444b71050bb2c
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T18:27:35Z
iterations: 17
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 17
**Converged:** Yes (iteration 17: its one WARNING is the board-start vs supervisor-launch race, deferred since iteration 9; NITs otherwise)
**Total findings:** 29 actionable (1 BLOCKER, 23 WARNINGs, 5 CONVENTIONs), and NITs
**Fixed:** 26 | **Deferred:** 3 (one race, raised in iterations 9, 13, 15 and 17) | **Asked (awaiting user):** 0

The 6c-bis provenance lookup (git blame per finding) was NOT run this loop, so "Self-generated"
reads "not measured". Reviewer model alternated opus / sonnet. The per-iteration commits were
squashed into one commit and rebased cleanly onto main before the final validation; the history is
kept at origin agyhooks-4353-presquash.

### Per-Iteration Breakdown
- **1 (opus):** [BLOCKER] engine/create.js:1331 readPlistJob gained `workdir`, breaking a strict-shape test --> FIXED 516043621 (readJob unchanged). [WARNING] bridge not checked --> FIXED 516043621 (nothing written without it). [WARNING] nodeBin is not the supervisor's spelling --> FIXED 516043621 (only an ABSENT entry is written). [WARNING] setImmediate does not take work off the loop --> FIXED (comment says deferral, not offload; 598edd28f).
- **2 (sonnet):** [CONVENTION] plan Design stale --> FIXED 054d0db40.
- **3 (opus):** [WARNING] process.execPath dies at a Homebrew upgrade --> FIXED b63c02874 (allowance.stableNode). [WARNING] version probe awaited per agent with a grandchild hang --> FIXED b63c02874 (bounded; the hang claim was measured false and deleted), later REMOVED with the probe (f7ee5c07e).
- **4 (sonnet):** [CONVENTION] CLAUDE.md module map --> FIXED a94750331. [CONVENTION] root test naming --> FIXED a94750331 (engine/agyrefresh.test.js).
- **5 (opus):** [WARNING] plan vs code --> FIXED 4e691b2c7. [WARNING] after-await re-check covers one agent --> FIXED 4e691b2c7, then moot (probe removed). [WARNING] successful writes leave no trace --> FIXED 4e691b2c7.
- **6 (opus):** [WARNING] tool hooks chosen from the on-disk agy, hot-loaded into an older process --> FIXED f7ee5c07e (Working/Idle only; probe removed).
- **7 (sonnet):** [WARNING] race comment understates the cost --> FIXED c6826b72c.
- **8 (opus):** [WARNING] node-path comment contradicts the header --> FIXED 33dbb6c95.
- **9 (sonnet):** [CONVENTION] third copy of the plist ProgramArguments parse --> FIXED 4272173c0 (create.plistArgs). [WARNING] board-start vs supervisor race --> DEFERRED (soft, self-heals at the next launch, stated at the write site and in the plan; a lock would need the supervisor's cooperation).
- **10 (opus):** [WARNING] "fire-and-forget" but blocks board start --> FIXED 598edd28f (setImmediate). [WARNING] a board-written entry is never repaired --> FIXED 598edd28f (a stale node or bridge counts as absent).
- **11 (sonnet):** [WARNING] an unparseable Stop command read as hooked --> FIXED 40b5b619f (mutant-controlled).
- **12 (opus):** [WARNING] server.js .catch swallowed failures silently --> FIXED 0de6ad77a (logged); NITs taken: PreInvocation required, fallback comment, plan names plistArgs.
- **13 (sonnet):** [WARNING] race --> DEFERRED (dedup of 9). [CONVENTION] commit subjects --> FIXED by the squash (one `#4353:` commit).
- **14 (opus):** [WARNING] comment gave the wrong reason for the bridge check --> FIXED bd4989dfc. [WARNING] a repair drops the tool hooks a current supervisor wrote --> FIXED bd4989dfc (hadToolHooks; both arms tested, mutant-controlled).
- **15 (sonnet):** [WARNING] race --> DEFERRED (dedup of 9). [CONVENTION] hand-rolled inverse of shQuote --> FIXED 6dde6aa00 (agyhooks.shUnquoteAll, round-trip test, mutant-controlled).
- **16 (opus):** [WARNING] agyhooks header stale after the repair change --> FIXED 520091b2b. [WARNING] server.js comment stale in both halves --> FIXED 520091b2b; NIT taken: a dead PreToolUse handler counts as broken (it would deny ask_question; mutant-controlled).
- **17 (sonnet):** [WARNING] race --> DEFERRED (dedup of 9). NITs only otherwise.
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/create.js:1331 | not measured | readPlistJob shape | FIXED | 516043621 |
| 2 | 1 | WARNING | engine/agyrefresh.js:64 | not measured | bridge unchecked | FIXED | 516043621 |
| 3 | 1 | WARNING | engine/agyrefresh.js:74 | not measured | node spelling churn | FIXED | 516043621 |
| 4 | 1 | WARNING | server.js:17598 | not measured | setImmediate claim | FIXED | 598edd28f |
| 5 | 2 | CONVENTION | plan:9 | not measured | plan stale | FIXED | 054d0db40 |
| 6 | 3 | WARNING | engine/agyrefresh.js:107 | not measured | execPath at upgrade | FIXED | b63c02874 |
| 7 | 3 | WARNING | engine/agyrefresh.js:66 | not measured | serial version probe | FIXED | b63c02874, f7ee5c07e |
| 8 | 4 | CONVENTION | CLAUDE.md:85 | not measured | module map | FIXED | a94750331 |
| 9 | 4 | CONVENTION | agyrefresh-4353.test.js | not measured | test naming | FIXED | a94750331 |
| 10 | 5 | WARNING | plan:7 | not measured | plan vs code | FIXED | 4e691b2c7 |
| 11 | 5 | WARNING | engine/agyrefresh.js:66 | not measured | partial re-check | FIXED | 4e691b2c7 |
| 12 | 5 | WARNING | server.js:17598 | not measured | no success trace | FIXED | 4e691b2c7 |
| 13 | 6 | WARNING | engine/agyrefresh.js:77 | not measured | tool hooks on old agy | FIXED | f7ee5c07e |
| 14 | 7 | WARNING | engine/agyrefresh.js:67 | not measured | race cost understated | FIXED | c6826b72c |
| 15 | 8 | WARNING | engine/agyrefresh.js:113 | not measured | node comment | FIXED | 33dbb6c95 |
| 16 | 9 | CONVENTION | engine/agyrefresh.js:92 | not measured | third plist parse | FIXED | 4272173c0 |
| 17 | 9 | WARNING | engine/agyrefresh.js:129 | not measured | check-then-write race | DEFERRED | soft, self-heals, documented |
| 18 | 10 | WARNING | engine/agyrefresh.js:43 | not measured | blocks board start | FIXED | 598edd28f |
| 19 | 10 | WARNING | engine/agyrefresh.js:14 | not measured | never repaired | FIXED | 598edd28f |
| 20 | 11 | WARNING | engine/agyrefresh.js:38 | not measured | unparseable Stop hooked | FIXED | 40b5b619f |
| 21 | 12 | WARNING | server.js:17611 | not measured | silent catch | FIXED | 0de6ad77a |
| 22 | 13 | CONVENTION | commit log | not measured | subjects | FIXED | squash |
| 23 | 14 | WARNING | engine/agyrefresh.js:20 | not measured | wrong reason | FIXED | bd4989dfc |
| 24 | 14 | WARNING | engine/agyrefresh.js:38 | not measured | repair drops tool hooks | FIXED | bd4989dfc |
| 25 | 15 | CONVENTION | engine/agyrefresh.js:44 | not measured | second derivation | FIXED | 6dde6aa00 |
| 26 | 16 | WARNING | engine/agyhooks.js:6 | not measured | header stale | FIXED | 520091b2b |
| 27 | 16 | WARNING | server.js:17596 | not measured | comment stale | FIXED | 520091b2b |
| 28 | 13,15 | WARNING | engine/agyrefresh.js | not measured | race (re-raised) | DEFERRED | dedup of 17 |
| 29 | 17 | WARNING | engine/agyrefresh.js | not measured | race (re-raised) | DEFERRED | dedup of 17 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- readEntry parses hooks.json twice per agent (15, 17)
- refreshAtBoardStart's win32 return and wiring not unit-tested (15, 16)
- the git-project refusal is filtered by message text (14)
- a missing bridge returns [] with no log line (17)
- brace-counting wiring test can be fooled by a brace in a string (12, 14)

### Strengths
- Measured, not assumed: agy re-reads hooks.json mid-session (card comment, with a control)
- One parse of the plist (create.plistArgs) and one inverse of shQuote (shUnquoteAll)
- Never throws; nothing written without the bridge; git projects refused; never under the dry run
- Every negative test has a control that reads hooked, and each fix was checked by a mutant

### Validation
Full kosmos suite on the squashed, rebased commit (hash 4e8e97607233): 11413 tests, 11248 pass,
0 fail (validation-log PASSED); subdir audit passed. An earlier run was red on one agyrefresh row that
passed alone (stale hash mid-edit), and one was stopped for a peer's live test agents (#3011 guard).
