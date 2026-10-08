---
pre_challenge: true
method: challenge-loop
branch: pluginboard-5309
diff_hash: d03cd32e88afb0f318ef483e51bbf3a61f85abadbcaff9f77b5ef039de0e62a1
validation: passed
subdir_audit: passed
timestamp: 2026-10-08T04:11:43Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (reviewer models opus → sonnet → opus)
**Converged:** Yes
**Total findings:** 1 BLOCKER (6.0 synthetic), 4 WARNINGs, 0 CONVENTIONs, 4 NITs, + strengths
**Fixed:** 5 (the 6.0 orphan + the 4 iter-2 WARNINGs) | **Deferred:** 4 NITs | **Asked:** 0

Card #5309 part 2, slice 1 (engine-only): the per-agent plugin REACH signal the board needs to show the
day-one false-ready state. `engine/pluginreach.js` computes, per agent, whether the plugins the person
installed in their own provider app reach that agent (Claude default = reaches/same folder; non-default
= separate-account-folder; Codex = isolated-runtime by design #4592; other runners = not-applicable;
unreadable/garbage = unknown). Pure `reachFrom` + injectable `reachForAgent`. Names no file inside a
provider folder (shapes unmeasured; part-1 PR #5371 did the same) — the reach CONDITION only, not
specific plugin names; the board UI is slice 2.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty at this point; module code is the branch's pre-loop base)
- [NIT] pluginreach.js — "Never throws" slightly overstated for an undocumented non-string input (not reachable by the only caller) --> addressed by the iter-2 hardening (non-string → UNKNOWN).
- [NIT] pluginreach.js — reachForAgent case-insensitive vs claudeAccountDirOf case-sensitive; a reasonable robustness choice, kept.

#### 6.0 full-suite validation (counts as part of iteration 1)
**New findings:** 1 BLOCKER (synthetic, Origin BRANCH)
- [BLOCKER] engine.reachable.test.js — the #265 guard flagged `reachForAgent` as exported+tested+reachable-from-nowhere, not excused. --> FIXED (commit 71f670583): added a checkable EXCUSED reason naming slice 2 as the coming caller. `reachFrom` stays reachable through `reachForAgent`, so it needs no excuse.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, NITs
**Self-generated:** 0 (findings on the pre-loop module base, Origin BRANCH)
- [WARNING] reachForAgent vs reachFrom normalised the runner differently (lowercase-no-trim vs trim+lowercase); a padded `' claude'` on a non-default folder slipped into the default branch as a **false reaches:true**. --> FIXED (82cf27b9f): the resolver passes the plist configDir unconditionally and reachFrom is the sole runner authority. Regression test added.
- [WARNING] the EFFECTIVE_CCD leak-pin limitation was labelled a "false negative"; it is a false **positive** (over-report of reaches:true). --> FIXED: corrected the label in the module header and the plan.
- [WARNING] `path.resolve` resolves a relative dir against cwd, so a relative configDir could false-match → reaches:true. --> FIXED: a non-absolute (or non-string) dir now returns UNKNOWN; test added.
- [WARNING] the EXCUSED reason cited "server.js around 5309", colliding with the card number. --> FIXED: cites the /api/status per-agent agents map instead.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 acted on (NIT-1 below is on a line the loop wrote, but it is deferred, not acted on)
- [NIT] pluginreach.js header — "a non-absolute home ... maps to UNKNOWN" slightly overstates: in the default-account branch (dir null/''), reachFrom returns reaches:true before the isAbsolute guard. Reviewer confirmed the behaviour is CORRECT and NOT a spurious reaches:true (a default agent genuinely shares the home); only the mechanism wording is imprecise. --> DEFERRED (non-blocking; anti-churn: not re-editing comments each round).
- [NIT] plan — says "12 tests" but the suite has 16 pluginreach tests (17 with the reachable sweep). --> DEFERRED (stale count; correct value recorded here).
**Converged** — zero NEW actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | engine/pluginreach.js | BRANCH | "Never throws" overstated for non-string input | FIXED | 82cf27b9f (non-string → UNKNOWN) |
| 2 | 1 | NIT | engine/pluginreach.js | BRANCH | case-insensitive vs claudeAccountDirOf | DEFERRED | reasonable robustness, kept |
| 3 | 1(6.0) | BLOCKER | engine.reachable.test.js | BRANCH | #265 orphan: reachForAgent reachable from nowhere | FIXED | 71f670583 (EXCUSED entry) |
| 4 | 2 | WARNING | engine/pluginreach.js | BRANCH | runner normalisation mismatch → false reaches:true | FIXED | 82cf27b9f |
| 5 | 2 | WARNING | engine/pluginreach.js + plan | BRANCH | EFFECTIVE_CCD mislabeled false-negative (is false-positive) | FIXED | 82cf27b9f |
| 6 | 2 | WARNING | engine/pluginreach.js | BRANCH | relative dir path.resolve false-match → reaches:true | FIXED | 82cf27b9f (non-absolute → UNKNOWN) |
| 7 | 2 | WARNING | engine.reachable.test.js | BRANCH | EXCUSED reason cited a card-number-colliding line | FIXED | 82cf27b9f (cites the route) |
| 8 | 3 | NIT | engine/pluginreach.js header | SELF | "maps to UNKNOWN" imprecise for default-branch non-absolute home (behaviour still correct) | DEFERRED | non-blocking; anti-churn |
| 9 | 3 | NIT | .claude/plans/...md | BRANCH | stale "12 tests" (actual 16/17) | DEFERRED | correct value in this proof |

### Outstanding questions (ASKED, still unresolved)
- None.

### NITs (non-blocking)
- [NIT] pluginreach.js header: "maps to UNKNOWN" imprecise for the default-branch non-absolute home (iter-3; behaviour correct, not a spurious reaches:true).
- [NIT] plan: "12 tests" is stale; the suite has 16 pluginreach tests / 17 with the reachable sweep (iter-3).
- [NIT] reachForAgent case-insensitive runner vs the case-sensitive claudeAccountDirOf mirror (iter-1; kept as robustness).

### Strengths (across iterations)
- The dangerous direction (false reaches:true) is well-defended: runner normalisation lives in exactly ONE place (reachFrom); the only path to reaches:true is equal resolved absolute homes or a clean unset-dir default; relative/non-absolute/non-string dirs refuse to compare (UNKNOWN); the both-ways CONTROL test prevents a vacuous blanket pass; a padded-runner regression test pins the iter-2 fix.
- reachFrom is total (never throws); reachForAgent swallows readJob/homeDir errors to UNKNOWN; `./create`/`./accounts` are required lazily so the module is side-effect-free at require time.
- Scope matches the plan: no per-plugin naming, no board UI, module exports-only; the single EXCUSED entry is accurate, needed, and does not mask a dead export.
- The EFFECTIVE_CCD over-report is disclosed honestly and consistently in the module header and the plan, with the pure core already accepting the effective dir so slice 2 can close it with the live pane env.

### Validation
Full suite GREEN on the exact head 82cf27b9f (clean worktree, token unset, queued for a quiet slot per
Liu Kang m4763): validation-log `validation PASSED` (stack=typescript, hash d03cd32e88af), node 16647
tests / 16411 pass / 0 fail / 0 cancelled / 236 skipped; one transient shell-shard exit-3 (timeout) was
retried and passed. subdir audit passed. (Earlier 6g attempts flaked only on unrelated timing tests under
extreme box load; not counted.) Local `node --test engine/pluginreach.test.js engine.reachable.test.js`
= 17/17.
