---
pre_challenge: true
method: challenge-loop
branch: ranoutwait-6383
diff_hash: b7088c3af008f3832634e28dc4bd5b7b887a5125d8ea90e1296fa432615f6152
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T16:02:24Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs)
**Fixed:** 1 (in the paired relay branch) | **Deferred:** 1 | **Asked (awaiting user):** 0

App half of kosmos#6383. The tunnel half is joshualeestone/kosmos-relay#430 (branch ranoutwait-6383), reviewed in the
same loop; its proof is in that repo. Either merge order is safe.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION-note (plan present, no defect), 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] web/index.html:50321 — The Allow card says press Try again while, for a moment, the joining computer may not show the button yet (its next round has not reported needs_retry, so it says "Kosmos is checking with your other computer"). --> DEFERRED: the window is seconds. A's code is worked out after B's (A codes on B's reveal), so A's lapses later than B's, and B's next round (the page polls every few seconds) shows Try again. Recorded in the relay plan's Known limits.
- [NIT] crates/tunnel/src/devices.rs:73 (relay repo) — the code_wait doc did not list code_ran_out. --> FIXED in kosmos-relay 30d42a92
- [NIT] engine/remote.js CODE_WAITS — the trailing "#6383: code_ran_out" comment repeats the identifier. Left: it marks which entry the card added.
- [NIT] web/index.html:50420 — `.replace(/<name>/g, name)` with a string replacement expands `$&`; pre-existing, and computer names are [a-z0-9-] (NAME_RULE), so no `$` can reach it.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the `$&` replacement NIT, re-raised)
- [NIT] docs/browser-checks/render-connect-sheet-4637.js:23 and README.md:354 — header and README row describe the wait lines generically; still accurate, no index change needed.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:50321 | BRANCH | A says Try again seconds before B shows the button | DEFERRED | seconds-long; A's code lapses after B's; relay plan Known limits |

### Validation
- Full validation on Mortals at b80f69e9: status clean (ran, not skipped), hash b7088c3af008, recorded locally.
- Both browser-check gates (#1720 coarse, #2518 surface): 0.
- engine/remote.joincode-4794.test.js: 18/18; mutant (code_ran_out dropped from CODE_WAITS) red 17/1.
- render-connect-sheet-4637.js gained a code_ran_out arm (exact sentence, no code, Allow disabled, Not me enabled); run by PR CI's browser-checks job.

### NITs (non-blocking, across all iterations)
- see the per-iteration lists above

### Strengths (across all iterations)
- the Allow-card line names the same "Try again" button as the joining computer's screen, on the right computer (iterations 1, 2)
- the name is askEsc'd before substitution; no new injection path (iterations 1, 2)
- the engine test keeps the `<b>bad</b>` control, so the pass-through assertion can fail both ways (iteration 1)
