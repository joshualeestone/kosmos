---
pre_challenge: true
method: challenge-loop
branch: builtsha-6330
diff_hash: 132eb979c1c3b3e1ee271d371e11c331e5609e69d4e8d6b222f9a6e4119f1ca6
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T00:48:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes, at iteration 8 (NITs only)
**Total findings:** 1 BLOCKER, 12 WARNINGs, plus NITs
**Fixed:** 1 BLOCKER, 12 WARNINGs, most NITs | **Deferred:** 5 (reasons below) | **Asked (awaiting user):** 0

Reviewer models alternate: odd iterations opus, even iterations sonnet (kosmos#2032).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] install/kosmos - shasum escaped a name with a backslash and read a leading dash as an option --> FIXED (f46c4efdc, hash from stdin)
- [WARNING] tools/windows/kosmos-cli.js - a whole-file read refused anything over 2 GiB with a false message --> FIXED (f46c4efdc, 1 MiB chunks)
- [NIT] server.js - a non-string fingerprint was ignored, not refused --> FIXED (f46c4efdc; engine requires a string)
- [NIT] refusal tests passed for the old unknown-option reason --> FIXED (each asserts its own sentence)
- [NIT] stale comments and usage lines --> FIXED
- [NIT] re-mark without --file drops it --> superseded by the sender rule (iterations 3, 5, 6)
- [NIT] history does not record the fingerprint --> DEFERRED (Tasks page history is UI; Josh 11:16)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] install/kosmos - --file "" marked with no fingerprint on the Mac, refused on Windows --> FIXED (caef62cab)
- [NIT] help order differed --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] engine/defaults.js - agents were never told --file exists --> FIXED (2fae767f2, rules paragraph)
- [WARNING] engine/tasks.js - the checker's mark dropped the deliverable's fingerprint --> FIXED (2fae767f2; refined in 5 and 6)
- [NIT] '' accepted; sha256sum fallback; comments; empty-path test message --> FIXED
- [NIT] shape checked before the task lookup --> DEFERRED (CLIs never send a bad shape)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (converged)
- [NIT] a fallback hasher after a partial read hashes the empty rest --> FIXED (dceba27e5, one hasher up front); code changed, so iteration 5 ran
- [NIT] refusal wording --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] engine/defaults.js - rules text changed without a DOCTRINE_VERSION bump (engine/defaults.test.js red) --> FIXED (010d7e87f, v33 logged with its weakest premise, pinned, table regenerated)
- [WARNING] engine/tasks.js - a kept fingerprint was presented as current after its sender re-marked a new version, and typed under the checker's name --> FIXED (010d7e87f, builtFingerprintBy; the rule is decided in the plan, as it moved in rounds 2, 3 and 5)
- [WARNING] Windows task list untested --> FIXED (test added)
- [NIT] leading-dash case never reached the hasher --> FIXED (relative name, cwd)
- [NIT] refusal order --> DEFERRED (as iteration 3)
- [NIT] the CLI does not confirm the board kept it --> DEFERRED (CLI and board ship in one release)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] help said any later mark keeps it --> FIXED (23f562f20, help and rules)
- [WARNING] null matched null: the person's mark kept or dropped by whether the sender had a name --> FIXED (23f562f20: the person keeps, an unnamed agent drops; decided in the plan)
- [WARNING] those sequences untested --> FIXED (engine test; mutant of the round-5 form fails it)
- [NIT] an identical mark from another agent kept the old sender --> FIXED
- [NIT] exit code differed on a hash failure --> FIXED in iteration 7

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] install/kosmos - under set -e a hasher failure ended the script silently (probed end to end) --> FIXED (8ecf34da3, refused with words, exit 2 as on Windows; test with a failing shasum, mutant red)
- [WARNING] engine/defaults.js - `Get-FileHash <file>` table output cuts the hash short (probed) --> FIXED (8ecf34da3, `(Get-FileHash <file>).Hash`, v33 re-pinned)
- [NIT] plan test counts stale --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** - no new actionable findings. NITs left unchanged so the reviewed code is the shipped code: help says "another agent" (named; the plan records the unnamed case); the Mac checks 64 characters, not lowercase (a real hasher prints lowercase, and the board refuses otherwise); no Windows directory test; no What's New entry (agent-facing only).

### Deferred, with reasons
- Shape checked before the task lookup: only a hand-made request sees the order.
- The CLI does not confirm the board kept the fingerprint: CLI and board ship together.
- Task history does not record the fingerprint: history is drawn on the Tasks page, new UI under Josh's 11:16 ruling.
- An agent's EDITED copy of the tasks section is not re-offered the paragraph (no new heading, as doctrine 32).
- Folders and deployed things are out of scope: a file's hash proves sameness only against a copy of that file.

### Tests
server.builtsha-6330.test.js 7 pass; tools.windows-kosmos-cli-570.test.js 48 pass; engine/defaults 29, doctrine-4890 32, doctrine-past-5946 4, builttell-6330 26, task-built-3951 12 pass. Every rule change was checked by a one-line mutant that fails exactly its test.

### Validation history
First full run failed only on the #1777 guard (the new test file branches on win32 and was not excluded); fixed at 7c9e87e53 with an exclusion and its reason. The second run failed 3 CLI timing tests while two suites overlapped on Mortals (time-scale 1.93x); both files pass alone in matching times on the branch and on main. The third run, alone: 21,530 tests, 0 failed.
