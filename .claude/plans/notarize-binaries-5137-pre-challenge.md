---
pre_challenge: true
method: challenge-loop
branch: notarize-binaries-5137
diff_hash: 660297aec558d611f868420482cc6d8d7ac03ea3b195e615a06ecac8cd08a798
validation: passed
subdir_audit: passed
timestamp: 2026-10-12T09:36:26Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13
**Converged:** Yes. Iteration 13's two WARNINGs did not survive: one was measured false against Apple, the other
repeats a finding already judged harmless in iteration 11.
**Total findings raised:** 1 BLOCKER and 33 WARNINGs across iterations 1 to 13 (duplicates of earlier findings included), plus 49 NITs. Some reviewers wrote
"no violations" lines under CONVENTION; those are not counted as findings.
**Fixed:** most of them, across 12 fix commits (97efb3ad6 .. bc2cf849a) | **Deferred:** 3 named below, plus duplicates | **Asked:** 0

How this proof was written: the loop ran in an earlier session of this agent. This file was rebuilt on 2026-10-12
from that session's transcript (every reviewer's `## Findings` block, read in order) and from the 12 fix-commit
messages. Each iteration's dispositions are as its fix commit and the session's notes record them. Where one
commit addressed several findings, the per-finding split was not recorded separately and is not invented here.

Validation: one final full validation through tools/queued-heavy.sh on HEAD bc2cf849a, `FINAL-VALIDATION v=0 a=0`
(turn 03:55:36 to 04:31:16 CDT; node 19,374 tests, 0 fail). An earlier run (iteration 7) was voided because the tree
changed under it. The lib was also proven against Apple's notary service for real: every arch slice's cdhash was in
ticketContents, and the served prod 0.7.38 binaries flipped from "Unnotarized Developer ID" to notarized, while a
control signed with the same certificate stayed unnotarized.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (session default)
**New findings:** 1 BLOCKER, 3 WARNINGs
**Self-generated:** 0 of the above
- [BLOCKER] tools/test-notarize-binaries-5137.sh:1 - the test was not wired into test:shell --> FIXED (97efb3ad6)
- [WARNING] tools/lib/notarize-binaries.sh:47 - KOSMOS_NOTARIZE=0 was a convention only --> FIXED (97efb3ad6): release.sh refuses a cut with the opt-out or a seam exported
- [WARNING] tools/build-kosmos-bundle.sh:738 - every cut now waits on Apple with no retry --> FIXED (97efb3ad6): retry a submit that returns no id
- [WARNING] tools/lib/notarize-binaries.sh:15 - "each binary's own cdhash" only partly true for kosmos-tunnel --> FIXED (97efb3ad6): every arch slice checked, matched only inside ticketContents

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- [WARNING] tools/release.sh:717 - the first contact with Apple is after the bump --> FIXED (30282afb7): step 1c makes one authenticated notarytool request
- [WARNING] tools/lib/notarize-binaries.sh:105 - greedy id parse --> FIXED (30282afb7): first matching key
- DEFERRED (a NIT-level point raised here and again in iteration 9): KOSMOS_SECRETS_MAP_BIN is not refused. The preflight prints "not probed", and a wrong key fails closed at Apple.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION
- [WARNING] tools/lib/notarize-binaries.sh:137 - a non-final status after submit gets no second look --> FIXED (696cc0e45): wait once more
- [WARNING] tools/test-install.sh:13 - the documented dev-build recipe fails without the notary key --> FIXED (696cc0e45): the hint names KOSMOS_NOTARIZE=0
- [CONVENTION] .claude/plans/notarize-binaries-5137.md - the out-of-scope card was not named --> addressed in 696cc0e45 (the unsealed Kosmos.app is #5896)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 6 WARNINGs raised; per the session notes, two were duplicates of deferred or fixed items
- [WARNING] tools/lib/notarize-binaries.sh:181 - the ticket parse stops at the first `]` --> FIXED (8c53354f8): a nested array is pinned to refuse
- [WARNING] tools/lib/notarize-binaries.sh:192 - the quoted hash matches anywhere in the ticket --> FIXED (8c53354f8): matched only as a cdhash value
- [WARNING] tools/build-kosmos-bundle.sh:733 - notarize runs on every build --> FIXED (8c53354f8): verified that the four tests that run the build never reach the step
- [WARNING] tools/release.sh:726 - an empty export is refused --> FIXED (8c53354f8): the guard says an empty export still counts
- the remaining two (log fetch `|| :` on Invalid; `exit 130` trap) were duplicates or correct as written, per the session's notes

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION
- [WARNING] tools.release-gate.test.js:696 - the harness env does not clear the refused names --> FIXED (aa42fe19c)
- [WARNING] tools/build-kosmos-bundle.sh:737 - notarizing mid-build ahead of cheap local gates --> FIXED (aa42fe19c): notarize just before packing
- [CONVENTION] .claude/plans/notarize-binaries-5137.md:6 - the plan said submit --wait --> FIXED (aa42fe19c)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs. The probe-bin one repeats a documented deliberate choice; the parse-limit one repeats iteration 4.
- [WARNING] tools/lib/notarize-binaries.sh:137 - an empty retry list under set -u --> FIXED (7edcd2b50): tested to make exactly one try

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs
- [WARNING] docs/releasing.md:84 - the runbook said step 1c never contacts Apple --> FIXED (90966edfc)
- [WARNING] tools/lib/notarize-binaries.sh:366 - the post-acceptance log fetch has no retry --> FIXED (90966edfc)
- DEFERRED: a wall-clock bound on history/submit. The seams are shell functions, which a perl alarm wrapper cannot exec, and notarytool's own network timeouts apply.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- [WARNING] tools/lib/notarize-binaries.sh:92 - the probe passes on any "history" text and ignores the exit status --> FIXED (29e9beb7d): exit 0 and a history key with an array value (Apple puts "message" first, measured)
- [WARNING] tools/release.sh:726 - the probe-bin seam is not refused --> FIXED (29e9beb7d): the runbook says why

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 WARNING (the other repeats KOSMOS_SECRETS_MAP_BIN, deferred since iteration 2)
- [WARNING] docs/releasing.md:293 - the hand-stamp timing ignores the wait on Apple --> FIXED (fdef6a88b), and the doc's "at most" claim removed

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 1 WARNING new (the other two repeat iterations 3 and 4)
- [WARNING] tools/lib/notarize-binaries.sh:186 - a log fetch that exits 0 with no ticketContents --> FIXED (822cacb0e): retried

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 WARNING
- [WARNING] tools/build-kosmos-bundle.sh:956 - a keyless build runs the whole build first --> FIXED (db9f6d514): key checked before staging. Also corrected a retry comment: one upload can reach Apple twice, which is harmless because only the id the script holds is waited on and checked.

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 1 WARNING new
- [WARNING] tools/lib/notarize-binaries.sh:104 - helpers relied on the caller's `||` to keep set -e from aborting before the message --> FIXED (bc2cf849a): tested with a bare call under set -euo pipefail
- DEFERRED (the second WARNING, duplicate uploads on a retry): the iteration 11 reasoning stands.

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 after deduplication
- [WARNING] tools/lib/notarize-binaries.sh:162 - a rejected submission whose wait prints no parseable status. The reviewer flagged it as unconfirmed. Measured against Apple's real Invalid submission af1ffa3e: `notarytool wait` prints `{"status":"Invalid",...}` with rc=0, so the status is parsed. Not an issue (DEFERRED, measured).
- [WARNING] tools/lib/notarize-binaries.sh:140 - a retry can upload the same zip twice. Duplicate of iteration 12's deferred item.
**Converged** - no new actionable findings.

### NITs (non-blocking, across all iterations)
- 49 NITs across the 13 passes. The ones taken are named in the fix commits (deterministic test scratch, a ran() helper fix, reflowed sentences, header names for the notary key and opt-out).

### Strengths (across all iterations)
- Acceptance requires Apple's ticket to list each arch slice's own cdhash, not just an Accepted status
- Fails closed at every unreadable point (no id, non-final status, unparseable ticket, nested array)
- Proven against Apple for real, with a control
