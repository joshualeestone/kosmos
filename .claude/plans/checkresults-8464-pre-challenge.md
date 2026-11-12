---
pre_challenge: true
method: challenge-loop
branch: checkresults-8464
diff_hash: b4bae7a1f36adaa0da3ba9f07d9d17962630ba6769c81e01dbd729706eae2047
validation: passed
subdir_audit: passed
timestamp: 2026-11-12T20:21:09Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 20 (0 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs, 12 NITs)
**Fixed:** 6 WARNINGs and 3 NITs | **Deferred:** 3 WARNINGs | **Asked (awaiting user):** 0

6.0 baseline validation: passed (28297 pass, 0 fail). 6g ran the touched suites by explicit file name after
each fix commit (engine, server, both CLIs, doctrine pin, nudges: all green); the full sequence ran at 6.0 and
again at 6j on the final HEAD (passed, hash b4bae7a1f36a), per the one-full-suite-per-branch rule.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] engine/tasks.js:1026 — every check reported UNMET let a bare built mark through --> FIXED (ac30fce2be): a bare mark needs every check reported met; an unmet one gets its own refusal asking what is left
- [WARNING] engine/tasks.js:1026 — one agent's reports satisfy another agent's bare mark --> DEFERRED: the requirement is that the task says how its checks went; each report names its agent, and the plan records that any member may report
- [NIT] engine/tasks.js:1704 — CHECK_HOW_MAX duplicated DONE_CHECK_MAX and the length was checked before trim --> FIXED (ac30fce2be)
- [NIT] install/kosmos, tools/windows/kosmos-cli.js — two copies of the how sanitizing rule (results agree)
- [NIT] engine/tasks.js:120 — comment wording drift ("agent says met") --> FIXED (ac30fce2be)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (cited lines blame to branch commits before the loop)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] engine/defaults.js:516 — rules v49 said the note is optional once every check is reported; the engine needs reported MET --> FIXED (b8de7bb2c4), plan and test title too, v49 re-pinned (unreleased)
- [WARNING] engine/agentnudge.js:175,184 — both nudges suggested a bare built mark that an unmet report refuses --> FIXED (b8de7bb2c4)
- [WARNING] install/kosmos:6072, tools/windows/kosmos-cli.js:134 — the check help line split done-when from its --clear line --> FIXED (b8de7bb2c4)
- [WARNING] server.js:26217 — how was stored without the setup guide's secret masking the built note gets --> FIXED (b8de7bb2c4), guideMasked
- [NIT] install/kosmos:6512, tools/windows/kosmos-cli.js:1356 — list counts used a looser shape test than show and the page --> FIXED (b8de7bb2c4)
- [NIT] install/kosmos:6205, tools/windows/kosmos-cli.js — an option-looking how was stored --> FIXED (b8de7bb2c4), refused on both CLIs with a test
- [NIT] web/index.html:73255 — tkMemberName unguarded beside the typeof-guarded helper (the page always defines it)
- [NIT] engine/tasks.js:1124 — the mixed case (one unreported, one unmet) gets the generic refusal

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (engine/tasks.js:1024 blames 46384d0ac9, :1721 blames 1172fbb42c, neither a loop commit)
- [WARNING] engine/tasks.js:1024 — a stale "met" report can satisfy a later bare mark --> DEFERRED: Kosmos records a change of work only as new parts, a reopen or the mark coming off, and all three drop the reports; a checker's re-mark is not new work, and a staleness signal Kosmos does not have would be new scope
- [WARNING] engine/tasks.js:1721 — guideMasked could lengthen a 200-character how past the limit --> DEFERRED: only the setup guide's secret-shaped text, and the outcome is a refusal with nothing stored unmasked (the safe direction)
- [NIT] engine/tasks.js:1710 — CLIs take one digit; fine while DONE_WHEN_MAX is 3
- [NIT] engine/taskactphrase.js:55 vs web/index.html — the page prints how unquoted, as its done-when phrase does (text rendering, parity test covers the kind)
- [NIT] tools/windows/kosmos-cli.js:2084 — no local one-line pre-check; the server refuses
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/tasks.js:1026 | BRANCH | all-unmet reports let a bare mark through | FIXED | ac30fce2be |
| 2 | 1 | WARNING | engine/tasks.js:1026 | BRANCH | another agent's reports satisfy a bare mark | DEFERRED | task-level requirement; reports name their agent |
| 3 | 1 | NIT | engine/tasks.js:1704 | BRANCH | duplicate limit, untrimmed check | FIXED | ac30fce2be |
| 4 | 1 | NIT | engine/tasks.js:120 | BRANCH | comment wording | FIXED | ac30fce2be |
| 5 | 2 | WARNING | engine/defaults.js:516 | BRANCH | rules said reported, engine needs met | FIXED | b8de7bb2c4 |
| 6 | 2 | WARNING | engine/agentnudge.js:175 | BRANCH | nudges suggested a refused bare mark | FIXED | b8de7bb2c4 |
| 7 | 2 | WARNING | install/kosmos:6072 | BRANCH | help line split done-when from --clear | FIXED | b8de7bb2c4 |
| 8 | 2 | WARNING | server.js:26217 | BRANCH | how not masked for the setup guide | FIXED | b8de7bb2c4 |
| 9 | 2 | NIT | install/kosmos:6512 | BRANCH | list count shape test looser | FIXED | b8de7bb2c4 |
| 10 | 2 | NIT | install/kosmos:6205 | BRANCH | option-looking how stored | FIXED | b8de7bb2c4 |
| 11 | 3 | WARNING | engine/tasks.js:1024 | BRANCH | stale met report satisfies a later mark | DEFERRED | work changes drop reports; no other signal |
| 12 | 3 | WARNING | engine/tasks.js:1721 | BRANCH | mask could lengthen past the limit | DEFERRED | setup guide only; refusal is the safe outcome |

### NITs (non-blocking, across all iterations)
- [NIT] two copies of the how sanitizing rule in the CLIs (iteration 1)
- [NIT] tkMemberName unguarded in a lifted test (iteration 2)
- [NIT] the mixed unreported/unmet case gets the generic refusal (iteration 2)
- [NIT] CLIs accept one digit for the check number (iteration 3)
- [NIT] page phrase prints how unquoted (iteration 3)
- [NIT] no local one-line pre-check in the Windows CLI (iteration 3)

### Strengths (across all iterations)
- doneWhenResults is a separate index-aligned field: doneWhen stays strings, no reader changes, no migration (all three)
- reports drop exactly when what they describe changes, with an unchanged-wording control (iterations 1, 2)
- keeping reports out of BUILT_FIELDS, pinned by a test, because setBuilt rebuilds from withoutBuilt (iterations 1, 2)
- agent words never reach innerHTML: textContent and text nodes on the page, q() quoting in task show (all three)
- every route refusal tested at HTTP level, with the agent-token-plus-screen-headers control (iteration 2)
