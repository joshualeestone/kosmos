---
pre_challenge: true
method: challenge-loop
branch: taskchat-992
diff_hash: 32a61e61a3f43c821d16670e2fc0d7212a3134dd83101022f5fb4dca2200755f
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T00:02:53Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (this resumed run; the branch also converged over 6 iterations in a prior session, pre-rebase)
**Converged:** Yes — iteration 4 produced zero new BLOCKER/WARNING/CONVENTION findings (only NITs and strengths)
**Total findings (this run):** 3 actionable (1 WARNING, 1 WARNING→uniform, 1 CONVENTION) + doc/NITs
**Fixed:** 2 code fixes + 1 read-path hardening + 1 doc line | **Deferred:** 3 (with reasoning) | **Asked (awaiting user):** 0

Validation green throughout: node 4726/4726 pass, 0 fail; the shipped shell gate
(tools/run-tests.sh test:shell chain) ran to completion (EXIT=0) as the 6j final gate
on the exact HEAD that will ship.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
- [WARNING] engine/tasks.js — a multi-part task completing via its last part closing (derived progressOf().closed) recorded only `part-closed`, never a task-level `closed` --> FIXED (setPartClosed + setClosed now record on the derived transition; commit d165edb3)
- [NIT] taskchat.992.test.js — addPart-refused had no records-nothing test --> FIXED (test added, commit d165edb3)
- [CONVENTION] engine/taskchat.js — C1 control chars not flattened --> DEFERRED: correct by design (only U+000A splits JSONL; display-escaping is the renderer's job, matching messages.js store-raw posture)
- [NIT] engine/taskchat.js:77 — UTF-16 surrogate-boundary slice --> DEFERRED: cosmetic (JSON escapes/restores; line integrity holds)
- [NIT] engine/tasks.js — `whoSeen` not on `created` --> DEFERRED: folds into the follow-up provenance pass (#2/#3), not piecemeal

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
- [WARNING] engine/tasks.js addPart — the iter-1 derived model was not applied to addPart; adding an open part to a fully-closed task un-completes it (a real task-level reopen) but recorded only `part-added` --> FIXED (addPart records `reopened` on the derived transition; commit b39b7bfa)
- [CONVENTION] engine/taskchat.js read() — `at` not validated as a parseable date (parity with messages.js rowShaped) --> FIXED (Number.isFinite(Date.parse) added; commit b39b7bfa)
- [NIT] surrogate slice --> DEFERRED (duplicate of iter-1)

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] engine/taskchat.js record() — bare `catch {}` has no breadcrumb --> DEFERRED: the bare best-effort catch on the record/write path IS the codebase convention (messages.js's own record/deliver paths use `catch { return false; }` / `catch { /* best effort */ }` with no breadcrumb; no process.emitWarning/debug pattern exists in engine/; the ENOENT distinction cited is on messages.js's READ path, which taskchat.read() already mirrors). Adding a warning would introduce an unmatched new pattern.
- [NIT] engine/tasks.js addPart — comment did not note the explicit-closedAt-wins asymmetry --> FIXED (clarifying comment; commit c6f70fe9)
- [NIT] surrogate slice --> DEFERRED (duplicate)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings.
- [NIT] engine/tasks.js — `Number(n)` vs `made.number`/`changed.number` --> DEFERRED: each form is correct for its context (route param vs already-numeric task field); not an inconsistency to fix
- [NIT] engine/taskchat.js:76-77 — surrogate slice --> DEFERRED (duplicate)
- [NIT] engine/tasks.js — close/reopen/setPartClosed not behind the parts valve --> DEFERRED: pre-existing scope (the close/reopen route is unvalved regardless of #992), does not break the O(1)-append retention claim; recorded as plan follow-up #4

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/tasks.js:setPartClosed | multi-part completion not recorded as task `closed` | FIXED | d165edb3 |
| 2 | 1 | NIT | taskchat.992.test.js | no refused-addPart test | FIXED | d165edb3 |
| 3 | 1 | CONVENTION | engine/taskchat.js:76 | C1 control chars not flattened | DEFERRED | correct by design (renderer escapes) |
| 4 | 1 | NIT | engine/taskchat.js:77 | UTF-16 surrogate slice | DEFERRED | cosmetic; JSON escapes/restores |
| 5 | 1 | NIT | engine/tasks.js:112 | whoSeen not on created | DEFERRED | follow-up provenance pass |
| 6 | 2 | WARNING | engine/tasks.js:addPart | derived model not applied to addPart | FIXED | b39b7bfa |
| 7 | 2 | CONVENTION | engine/taskchat.js:166 | `at` not validated as a date | FIXED | b39b7bfa |
| 8 | 3 | CONVENTION | engine/taskchat.js:136 | record() catch has no breadcrumb | DEFERRED | matches codebase best-effort convention |
| 9 | 3 | NIT | engine/tasks.js:addPart | comment missed closedAt-wins asymmetry | FIXED | c6f70fe9 |
| 10 | 4 | NIT | engine/tasks.js | Number(n) vs made.number | DEFERRED | each correct for its context |
| 11 | 4 | NIT | engine/tasks.js | close/reopen not valved | DEFERRED | pre-existing scope; plan follow-up #4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Strengths (across all iterations)
- Fail-soft contract airtight: record() catches all and returns false; every call sits after the successful projects.mutate/writeParts; the chmod-0o555 test forces a real EACCES and proves tasks.create still returns the task.
- Derived-transition model complete and consistent across setPartClosed, setClosed, and addPart; no missed or double-counted task-level events; no-dup-on-explicit-close-of-complete is real and tested.
- Retention-safe by construction: append-only, per-task file, no read-modify-write — the card's one open question, resolved.
- Keying/collision safety sound (store.safeKey + positive-integer number, `.task-` literal separator); path traversal closed; fail-soft on an all-disallowed-char id.
- Tests assert meaningful outcomes (exact kind sequences, numeric-type preservation, per-task/per-project isolation), not mere existence.
