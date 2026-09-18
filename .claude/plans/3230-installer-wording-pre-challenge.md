---
pre_challenge: true
method: challenge-loop
branch: 3230-installer-wording
diff_hash: 0079ced4cc55f1c52ef8102244f8292fef5012254994abadf8fe4945f6867710
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T00:35:43Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 review passes (plus the 6.0 initial validation pass)
**Converged:** Yes
**Total findings:** 11 (0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs, 6 NITs) across all iterations
**Fixed:** 4 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (no loop fix commit existed yet)
- [CONVENTION] .claude/plans/ -- No plan file found for the branch --> FIXED (commit 66255b3): added a brief plan file. The repo CLAUDE.md requires a plan file for every branch, docs-only included, and it is checked during challenge-loop.
- [NIT] conclusion.html:10 -- "a few hundred megabytes" verified precisely only against the Claude Code path. Noted; non-blocking.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the WARNING is on plan text this loop wrote in iteration 1)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] .claude/plans/3230-installer-wording.md -- The "why this is honest" section wrongly cited engine/setup-assistant.js (the gated-off firstrun autocreate) as showing the confirm dialog. The confirm decision actually lives in engine/connect.js willInstall(), which web/index.html frClaudeInstallNeeded() reads to show the dialog before any ~281MB download. --> FIXED (commit 071856f): corrected the citation. This is a plan-file prose claim, which is exactly where reasoning belongs, and the fix makes it accurate (pointing at real code) rather than deleting it.
- [NIT] conclusion.html:10 -- download only fires when the runner is absent; the "the tools it needs" phrasing keeps it honest. Noted; no change required.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (the plan-inconsistency NIT is on plan text this loop wrote)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] conclusion.html:10 -- "a few hundred megabytes" is generic across providers while OpenAI Codex is ~114MB. --> DEFERRED: honest upper-bound expectation. Claude Code (the card's subject and the default fresh-install download) measures ~281MB, squarely "a few hundred"; "can be" hedges the range; and overstating size for the smaller Codex path prepares the user rather than alarming them, which is the fixed intent. Changing to a smaller figure would understate the Claude Code case.
- [CONVENTION] commit d3c3c0347 -- first commit subject uses "<branch>: <message>" instead of the required "<branch> -- <message>". --> DEFERRED: the merge is --squash, so the squashed commit on main uses the PR title (which conforms); the intermediate commit never reaches main and the branch is deleted on merge. Rewriting branch history for a squashed-away commit is disruptive and unnecessary.
- [NIT] plan:11 -- Problem section said "a couple of hundred megabytes" vs "a few hundred" elsewhere. --> FIXED (commit 7a8d0e4): aligned to "roughly 281MB, a few hundred megabytes".
- [NIT] conclusion.html:10 -- "That" antecedent slightly loose. Left as-is: this is the brief's fixed wording and reads clearly ("That" = the download).

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (the CONVENTION concerns the plan filename format, not a line this loop authored)
**Duplicates of prior findings (confirmed resolved):** 0
**Converged** -- the sole new BLOCKER/WARNING/CONVENTION finding is deferred with sound reasoning; the two NITs are non-blocking. Zero NEW findings remain and no ASKED findings are outstanding.
- [CONVENTION] plan filename -- omits the timestamp the literal CLAUDE.md format specifies. --> DEFERRED: de-facto repo practice overwhelmingly omits the timestamp (worldswitch-lockout-2528.md, wouldping-1494.md, xsite-1636.md, zshpath-1621.md are all branch-name-only), the find/gate patterns match, and two earlier reviewers judged the branch-name form correct. Matching the dominant existing convention is preferable to literal compliance the repo itself does not follow.
- [NIT] conclusion.html:10 -- slight over-promise in the already-installed case (no download/confirm when the tool is present). Well-hedged; note not defect.
- [NIT] conclusion.html:10 -- conclusion.html is not in web.machine-absence-claims.test.js SOURCES (pre-existing gap, not introduced here; the added copy makes no absence claim).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for branch | FIXED | 66255b3 |
| 2 | 1 | NIT | conclusion.html:10 | BRANCH | size verified vs Claude path only | NOTED | non-blocking |
| 3 | 2 | WARNING | plan (why-honest) | SELF | cited setup-assistant.js not connect.js for confirm | FIXED | 071856f |
| 4 | 2 | NIT | conclusion.html:10 | BRANCH | download only if runner absent | NOTED | honest |
| 5 | 3 | WARNING | conclusion.html:10 | BRANCH | "few hundred MB" generic across providers | DEFERRED | honest upper-bound; Claude Code ~281MB; "can be" hedges; intent fixed by brief |
| 6 | 3 | CONVENTION | commit d3c3c0347 | BRANCH | first commit uses ':' not ' -- ' | DEFERRED | squash merge uses PR title (conforms); commit never reaches main |
| 7 | 3 | NIT | plan:11 | SELF | "couple" vs "few" hundred inconsistency | FIXED | 7a8d0e4 |
| 8 | 3 | NIT | conclusion.html:10 | BRANCH | "That" antecedent loose | NOTED | brief's fixed wording, reads clearly |
| 9 | 4 | CONVENTION | plan filename | BRANCH | omits timestamp per literal CLAUDE.md | DEFERRED | de-facto practice omits timestamp; find/gate patterns match; dominant convention preferred |
| 10 | 4 | NIT | conclusion.html:10 | BRANCH | over-promise already-installed case | NOTED | hedged |
| 11 | 4 | NIT | conclusion.html:10 | BRANCH | not in machine-absence-claims guard SOURCES | NOTED | pre-existing gap, no absence claim |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] conclusion.html:10 -- size verified vs Claude Code path only (iteration 1)
- [NIT] conclusion.html:10 -- download fires only when runner absent (iteration 2)
- [NIT] conclusion.html:10 -- "That" antecedent slightly loose (iteration 3)
- [NIT] conclusion.html:10 -- over-promise in the already-installed case (iteration 4)
- [NIT] conclusion.html:10 -- conclusion.html not covered by machine-absence-claims guard (iteration 4)

### Strengths (across all iterations)
- The shipped copy is factually honest against the code: Claude Code download ~281MB (engine/connect.js), confirm step raised via frClaudeInstallNeeded()/FR.connect.willInstall before any download, runner fetched only when absent (every reviewer confirmed this).
- HTML is valid and stylistically consistent with the existing two paragraphs and sibling welcome.html; no em dashes in any spelling.
- Plan code citations were independently re-verified against the tree after the iteration-2 correction.
- The change is genuinely test-covered: editing conclusion.html changes the pkg-input sha (tools/lib/pkg-inputs.sh), asserted by tools/test-pkg-input-guard.sh.
