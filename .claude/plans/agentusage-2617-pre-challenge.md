---
pre_challenge: true
method: challenge-loop
branch: agentusage-2617
diff_hash: a2cc799de9218c5a12f183fcbd8f4c817718193aef25d24a0246cf51293524d1
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T14:21:26Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes
**Total findings:** 18 (1 BLOCKER, 16 WARNINGs, 1 CONVENTION, many NITs)
**Fixed:** 16 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Validation

Full suite on HEAD: 8453 pass, 0 fail, hash a2cc799de921 (DEVELOPER_DIR set to
CommandLineTools because /usr/bin/python3 is blocked by an unaccepted Xcode
license on this Mac). An earlier run on the pre-fix commit was killed externally
(exit 144) and is not counted.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, several NITs
**Self-generated:** 0 of the above
- [WARNING] server.js:6551 — route sent byFolder, every session working folder --> FIXED (48035e19): stripped; test asserts absent
- [WARNING] engine/usage.test.js:303 — canonicalisation untested --> FIXED (48035e19): real symlink test; identity perturbation red
- [WARNING] engine/usage.js:378 — equal-length shared folders went to first name; broad folder absorbed sessions --> FIXED (48035e19): exact match, `shared` bucket
- [WARNING] engine/usage.js:393 — window-level clamp hid overshoot and let days cancel --> FIXED (48035e19): per-day unattributed and overcount
- [NIT] docstrings, comments, route try/catch, test title --> fixed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
- [CONVENTION] .claude/plans/agentusage-2617.md — no timestamp suffix --> DEFERRED: matches prevailing repo practice (many plans omit it); raised again in iterations 4 and 8 and deferred on the same basis
- [NIT] plan called byAgent pure --> fixed (89771a84)
- Own finding: second frozen file doubled the 3000-day freeze test (44s to 95s) --> FIXED (89771a84): concurrent reads, now ~19s; malformed frozen file kept a rescan, not a throw

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/usage.js:203 — per-row cwd moves work out of the agent after a cd --> FIXED (6b30f94e): keyed by transcript launch folder; measured 6 of 60 sessions multi-cwd
- [WARNING] plan — overclaimed that a `~` agent absorbs nothing --> FIXED (6b30f94e): residual stated
- [WARNING] server.usage.test.js — no test for unread roster or failing split --> FIXED (6b30f94e)
- [NIT] frozen folder contents unasserted, docstring wrap, garbled plan line --> fixed

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] engine/usage.js:349 — corrupt total discarded a good frozen folder split --> FIXED (e8ac3ecc): each half kept independently
- [WARNING] engine/usage.js:174 — dedup winner depended on readdir order --> FIXED (e8ac3ecc): sorted walk
- [NIT] silent catch on split failure --> fixed (logged)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/usage.js:173 — subagent transcripts keyed by their own first cwd; measured 6 of 400 --> FIXED (fb7c849b): inherit parent launch folder
- [WARNING] engine/usage.js:120 — failing folder freeze silently widens every rescan --> FIXED (fb7c849b): logged, plan states the one-time first load
- [CONVENTION] plan claimed status.js parity --> FIXED (fb7c849b): a both-spellings change was tried, perturbation stayed green (canonicalOnDisk is deterministic, so it added nothing), reverted and the claim reworded
- [NIT] leak test scope, roster note, midnight flake (pre-existing pattern, not changed) --> fixed where applicable

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above
- [BLOCKER] engine/usage.js:191 — lastIndexOf broke inheritance for depth-2 subagents --> FIXED (07928eee): first segment; depth-2 test; lastIndexOf perturbation red
- [CONVENTION] comment asserted unqualified inheritance --> fixed with the BLOCKER
- [NIT] readFrozen helper --> fixed

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] dedup-order test cannot see the sort deleted --> FIXED (f33fb60c): test renamed to what it pins, plan states the limit; reversed-sort perturbation red
- [WARNING] unread-roster stub carried no names --> FIXED (f33fb60c): names plus own data and a positive control; gate perturbation red alone
- [NIT] subagents search below root, comment cases, per-half writes, non-object frozen file --> fixed

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (dup of #2), 1 NIT
**Self-generated:** 0 of the above
- [WARNING] engine/usage.js:426 — synchronous realpath per folder in the async route --> FIXED (8e4807d0): byAgentAsync with fsp.realpath; zero-sync-call test; both perturbations red
- [NIT] SUBAGENTS_DIRNAME constant --> fixed

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/usage.js — dedup winner is by path, not by original --> DEFERRED (documented in byAgent doc and plan): Kosmos resumes an agent in its own folder so copies usually share a launch folder; preferring the earliest row would move credit between days and disturb per-model totals this branch never rewrites
- [WARNING] server.js — link-matching claim does not reach agent folders (workerDir never returns a link) --> FIXED (9d696c28): wording corrected
- [NIT] route doc, no-op line, wider sync guard, fixture isolation --> fixed

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.js:6551 | BRANCH | byFolder leaked | FIXED | 48035e19 |
| 2 | 1 | WARNING | engine/usage.test.js:303 | BRANCH | canonical untested | FIXED | 48035e19 |
| 3 | 1 | WARNING | engine/usage.js:378 | BRANCH | shared/broad folder attribution | FIXED | 48035e19 |
| 4 | 1 | WARNING | engine/usage.js:393 | BRANCH | window clamp | FIXED | 48035e19 |
| 5 | 2 | CONVENTION | plan filename | BRANCH | no timestamp | DEFERRED | repo practice |
| 6 | 3 | WARNING | engine/usage.js:203 | BRANCH | per-row cwd | FIXED | 6b30f94e |
| 7 | 3 | WARNING | plan | BRANCH | `~` overclaim | FIXED | 6b30f94e |
| 8 | 3 | WARNING | server.usage.test.js | BRANCH | degraded paths untested | FIXED | 6b30f94e |
| 9 | 4 | WARNING | engine/usage.js:349 | BRANCH | good half discarded | FIXED | e8ac3ecc |
| 10 | 4 | WARNING | engine/usage.js:174 | BRANCH | readdir-order dedup | FIXED | e8ac3ecc |
| 11 | 5 | WARNING | engine/usage.js:173 | BRANCH | subagent keying | FIXED | fb7c849b |
| 12 | 5 | WARNING | engine/usage.js:120 | BRANCH | silent freeze failure | FIXED | fb7c849b |
| 13 | 6 | BLOCKER | engine/usage.js:191 | SELF | depth-2 subagents | FIXED | 07928eee |
| 14 | 7 | WARNING | engine/usage.test.js | SELF | sort test overclaims | FIXED | f33fb60c |
| 15 | 7 | WARNING | server.usage.test.js | BRANCH | roster stub | FIXED | f33fb60c |
| 16 | 8 | WARNING | engine/usage.js:426 | BRANCH | sync realpath | FIXED | 8e4807d0 |
| 17 | 9 | WARNING | engine/usage.js | BRANCH | arbitrary dedup winner | DEFERRED | documented |
| 18 | 9 | WARNING | server.js | BRANCH | link claim | FIXED | 9d696c28 |

### NITs (non-blocking, across all iterations)
- [NIT] engine/usage.test.js — day computed before dailyUsageByModel could straddle UTC midnight (iteration 5; pre-existing pattern)
- [NIT] server.js:6556 — try/catch around create.workerDir cannot currently fire (iteration 10)
- [NIT] plan — the 6-of-400 subagent measurement lives only in the plan (iteration 10)
- [NIT] server.js:6531 — route doc could say rosterRead:false is not null (iteration 10)

### Strengths (across all iterations)
- Per-model frozen totals are never re-derived; each frozen half is kept independently (iterations 2-10)
- Per-day unattributed and overcount cannot cancel (iterations 1-10)
- The per-folder split never leaves the process; asserted, perturbed red (iterations 1-10)
- Launch-folder keying with subagent inheritance at any depth, measured on real transcripts (iterations 3-10)
- No synchronous filesystem call per folder in the route; asserted with a call counter (iterations 8-10)
