---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0811b
diff_hash: 901ba348d8258c3a41da23318f6ee87ca3085592ed301477a6a7932e814a4958
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T18:29:20Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (first at iteration 2; the text then changed twice after convergence, on the author's check and on an iteration 3 NIT, so iterations 3 and 4 re-reviewed it, and iteration 4 found nothing to change)
**Total findings:** 2 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 8 NITs, plus one finding from the author (Renet Tilley), treated as a WARNING
**Fixed:** 2 (iteration 1's WARNING, the author's finding) | **Deferred:** 1 (iteration 2's WARNING) | **Asked (awaiting user):** 0

Validation: the full suite on Mortals (mortals-validate.sh) for HEAD 67479386ca, entry `"status":"clean"` (a real run), hash 901ba348d825 equal to this proof's diff_hash, base d81b81430b. Node suite: 29,881 tests, 0 failed, 0 cancelled. Shell shards 1/4 to 4/4: 83, 75, 78 and 80 passed. Two earlier queued runs (061486958c, c6c569d30d) were REPLACED while waiting (exit 5), not passed. `tools/whats-new-check.js 0.8.11` passed for mac and windows after every change (mac 5, windows 4). No subdir CLAUDE.md is in the diff.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (no loop fix commit existed yet)
- [WARNING] release/whats-new-pool.json (the #8728 entry) and web/whats-new.json: "a remote sign-in says" named the wrong trigger; signing in to Kosmos+ never shows the sentence, which is for any protected action sent through Kosmos+ --> FIXED (061486958c)
- [NIT] "and it works then" suggested --> declined: the board's self re-ask runs up to 10 to 15 minutes, so a working retry is not promised
- [NIT] two phone icons in a row --> taken, icon shield (061486958c)
- [NIT] empty Review log heading --> filled (061486958c)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] the line names a restart as if it were the only case the sentence appears in (also a crash relaunch, an earlier board's tunnel ending) --> DEFERRED: the line says what happens right after a restart, which is true, and does not say it happens only then; the reviewer called it accurate enough
- [NIT] quoted sentence shortened (fine); [NIT] CST correct in November (no change)

**After convergence, the author's check** (Renet Tilley, Fleet Builders 11:31): only a PROTECTED action is refused, and only until the connector answers; "an action ... says" read as every action, always --> FIXED (c6c569d30d): "a protected action ... may say"

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 BLOCKER/WARNING/CONVENTION findings (NITs only)
- [NIT] "the computer is still starting" paraphrased "Kosmos+ is still starting on this computer" (server.js REMOTE_STEP_UP_STARTING) --> taken (67479386ca), the sentence's own words
- [NIT] other pending cases besides a restart --> not changed, "may" covers them
- [NIT] the plan could quote the sentence's restart clause --> not changed

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both "no change needed")
**Self-generated:** 0 of the above
**Converged**: no new actionable findings, on 67479386ca, the HEAD validated above.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json (#8728 entry) | BRANCH | "a remote sign-in" names the wrong trigger | FIXED | 061486958c |
| 2 | 2 | WARNING | release/whats-new-pool.json (#8728 entry) | SELF | restart named as the only case | DEFERRED | line is true for the case it names and claims no exclusivity |
| 3 | author | WARNING | release/whats-new-pool.json (#8728 entry) | SELF | every action, always, vs protected and may | FIXED | c6c569d30d |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- "and it works then" (1): declined, not promised
- phone icon twice (1): taken, shield
- empty Review log (1): filled
- sentence shortened (2), CST (2): no change
- "the computer" vs "Kosmos+" is still starting (3): taken
- other pending cases (3), plan restart clause (3): no change
- title broader than line (4), rank 8.8 first (4): no change

### Strengths (across all iterations)
- The quoted sentence matches REMOTE_STEP_UP_STARTING and the page shows the error verbatim for every remote_step_up code (iteration 1)
- Untagged is right: engine/remote.js and server.js run on every platform, Windows included (kosmos-tunnel.exe) (iterations 1, 3)
- The rebuilt window is consistent: rank 8.8 first, the four #8740 items in order, the 0.8.08 carry-over pushed out and still pending (iterations 1, 3, 4)
