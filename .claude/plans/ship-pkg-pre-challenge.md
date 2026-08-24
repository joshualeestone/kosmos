---
pre_challenge: true
method: challenge-loop
branch: ship-pkg
diff_hash: c822c106e4925601a8fb3f7a5b0eb3f28222f1d7e784aa688e3303d950088148
subdir_audit: passed
timestamp: 2026-08-24T23:48:13Z
iterations: 6
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** No (stopped at the bound after iteration 6; see below)
**Total findings:** 61 (2 BLOCKERs, 21 WARNINGs, 2 CONVENTIONs, 36 NITs)
**Fixed:** 2 BLOCKERs + 21 WARNINGs + 2 CONVENTIONs + 27 NITs | **Deferred:** 0 BLOCKERs, 0 WARNINGs, 9 NITs (recorded)

**Why stopped rather than converged:** the severity curve is the evidence. Rounds 1 to 5 each found something substantive in code, and round 5 found the worst defect of the branch (the sha depended on the repo root, which every earlier check and three real notarised builds were blind to). Round 6 found one WARNING, an absurd-name edge (a filename containing a newline) that is nonetheless the exact contract the pre-check states, plus NITs. Every finding through round 6 is fixed and every fix carries a control that was proven by mutation to fail on the defect it names (length-only hasher, sectionless hasher, x-bit-blind hasher, absolute-path framing, an erroring decision, a fail-open filter evaluator). Validation after every round: yarn test 1947/1947 (1948/1948 after the rebase onto c81e63a), exit 0, audit clean; the real build notarised three times with matching sidecars; the release-shaped root control (this worktree vs a fresh detached worktree) equal. Continuing past a round whose only warning is a newline in a filename would spend minutes on the shape of the review rather than the code. Bounded on purpose (Angel).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, 4 NITs
- [BLOCKER] release.sh:372 — bare `x="$(curl ... | tr)"` captures under set -e: a 404 on the first read killed the script before the six-read loop retried --> FIXED (a7d7dd1): every fetch into a file inside the if chain
- [WARNING] release.sh:233 — the sidecar was neither gitignored by the site nor committed --> FIXED (site #72 merged; hazard comment names all three files)
- [WARNING] verify-served.sh:120 — nothing bound the served sidecar to the served bytes (mixed edge state passed) --> FIXED (a7d7dd1): two-line sidecar, line 2 = pkg sha256; every reader binds
- [WARNING] pkg-inputs.sh:47 — find hashed dotfiles; the shared checkout's .DS_Store read as stale --> FIXED (a7d7dd1)
- [WARNING] build-installer-pkg.sh:111 — sidecar computed after notarisation, minutes after the inputs were read --> FIXED (a7d7dd1): taken before pkgbuild
- [WARNING] test:51 — "compare:" checks compared variables to themselves --> FIXED (a7d7dd1): dropped
- [WARNING] test:18 — no control that a non-input change leaves the sha alone (an mtime hasher passed) --> FIXED (a7d7dd1): touch, version, dotfile controls
- [WARNING] release.sh:386 — 9c's red named the wrong fact --> FIXED (a7d7dd1): the failing fact is recorded and printed
- [NIT] verify-served comment rc 1 vs 66 --> FIXED; identifier copy --> FIXED (dropped, the build script is hashed); bare shasum vs _pkg_hash --> FIXED where the lib is sourced; verify-served syntax check in test:shell --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 5 NITs
- [WARNING] test:21 — every edit control changed a file's LENGTH; a wc -c hasher passed 25/25 (measured by the reviewer) --> FIXED (4588ed1): same-length control, proven by mutation
- [WARNING] test:43 — the section-move control passed on a sectionless hasher --> FIXED (7ec88c5): order-neutral fixture {a} / b / {c}, proven by mutation (two earlier versions of the control could not fail)
- [WARNING] verify-served.sh:139 — a sidecar with no pkg: line silently skipped the vouch check --> FIXED (4588ed1): said and red
- [WARNING] release.sh:209 — LIVE: the site dist's pkg (18:04) disagreed with its .sha256 --> escalated to Splinter, Baron republished the pair; 3c's "pair broken" arm is the guard
- [CONVENTION] plan named the served host as the oracle; the code decides from the site dist --> FIXED (4588ed1)
- [CONVENTION] "four things" vs three paths --> FIXED (4588ed1)
- [NIT] build clears only the pkg --> FIXED (all three outputs); dead _pkg_fact init --> FIXED; temp dir outside the trap --> FIXED (under BUILD_ROOT); "NOT THE PUBLISHED ONE" on the not-published path --> FIXED (two messages); 3c before 7 costs a notarise on a versions-page abort --> FIXED (moved before step 4 in iteration 3); no .vercelignore read before the deploy --> FIXED (evaluated); dot-directories --> FIXED (pruned); cat failure inside the pipeline --> FIXED (readability pre-check); ppub empty misdiagnosed --> FIXED; verify red until the next release --> stated in the plan
- [NIT] fixture's unreachable no-meta branch --> DEFERRED: explicit, harmless

#### Iteration 3
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 10 NITs
- [WARNING] release.sh:308 — any non-zero exit from the decision read as "current" (fail open; measured with return 3) --> FIXED (fb03aab): exit codes 0/2/other, read under set +e, refuse on anything else, control that reds on return 3
- [WARNING] release.sh:324 — the .vercelignore grep missed six spellings and passed on a MISSING file --> FIXED (fb03aab): evaluated by git on the filter's patterns, missing file refused, seven spellings tested
- [WARNING] release.sh:313 — notarise after step 4's cache-immutable copy: a flake cost a version bump --> FIXED (fb03aab): step 3c, before step 4
- [WARNING] pkg-inputs.sh:59 — the readability loop word-split on spaces --> FIXED (fb03aab): NUL-delimited, control with a spaced name
- [WARNING] test:105 — the "current" control accepted any non-zero exit --> FIXED (fb03aab): asserts rc 2 and the current: prefix
- [NIT] six arms, "five ways" --> FIXED; one-input header parenthetical --> FIXED; exec bit not an input --> FIXED (framed, control); no length framing --> FIXED (framed); stale "5b" --> FIXED; shasum in the test --> FIXED (_pkg_hash); signature check any Developer ID --> FIXED (team id); 9c sidecar fetch without no-cache --> FIXED; 2b map comment --> FIXED; plan's step placement sentence --> FIXED

#### Iteration 4
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] pkg-inputs.sh:161 — the filter evaluator failed OPEN on any error in its subshell (stub git exit 128: rc 0, nothing printed) --> FIXED (6baee39): rc 3 on any error, release refuses, control with a stub git, proven by mutation
- [WARNING] pkg-inputs.sh:164 — the scratch git init read the operator's global core.excludesFile; a global *.pkg made a clean filter read as excluding (measured on this Mac) --> FIXED (6baee39): no global/system config, no template; control plus the control's control
- [WARNING] pkg-inputs.sh:38 — an unsearchable subdirectory hashed as absent (same sha as deleting it, measured) --> FIXED (6baee39): refused, named
- [WARNING] pkg-inputs.sh:85 — a symlinked input hashed as absent --> FIXED (6baee39): refused, named, choice stated
- [NIT] plan "four inputs" --> FIXED; unsourced 16:36 --> FIXED (dropped); abandoned-cut consequence --> FIXED (stated); version metadata note --> FIXED

#### Iteration 5
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] pkg-inputs.sh:69 — the build script was framed by its ABSOLUTE path, so the sha depended on the repo root: every cut (a fresh mktemp worktree) would have rebuilt and re-notarised, and verify-served from the shared checkout would read STALE forever; three real builds passed because both sides used one directory --> FIXED (90b8291): repo-relative framing; two-root control (proven by mutation) and a release-shaped control (this worktree vs a fresh detached worktree at a temp root: equal)
- [BLOCKER] test:19 — the determinism control hashed one root twice and could not see the above --> FIXED (90b8291)
- [WARNING] pkg-inputs.sh:98 — an unsearchable input ROOT streamed an empty section (cd failed inside the check) --> FIXED (90b8291): roots checked first, control
- [WARNING] release.sh:215 — the filter check ran after the notarise minutes --> FIXED (90b8291): before the decision
- [WARNING] pkg-inputs.sh:129 and :28 — comments described the intended code (0/1 exit codes; "fresh worktree hashes the same") --> FIXED (90b8291)
- [NIT] two hashers for the pair --> FIXED; error-vs-current arms unnamed --> FIXED; Download button missing from verify-served's derivation list --> FIXED

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
- [WARNING] pkg-inputs.sh:91 — a filename containing a newline passed the NUL-delimited pre-check and was split by the line-delimited stream (hashed as absent, measured) --> FIXED (9f1ed15): refused by name, control
- [NIT] hidden dirs filtered, not pruned (find complained into the release log) --> FIXED (pruned, control); comment credited the wrong instrument for the x-bit claim --> FIXED; whole-mode hasher would pass --> FIXED (chmod g-r control); step 7's existence grep could sit above 3c --> DEFERRED: one wasted round trip on a rare miss, the re-run finds the triple current; plan listed five reasons --> FIXED (six)
- Also found while fixing: the decision block's source edit was never restored, so later base comparisons ran against a different tree --> FIXED (fixture restored, control)
**Stopped at the bound** (see the summary).

### Final Ledger
| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release.sh:372 | bare curl capture under set -e killed the retry loop | FIXED | a7d7dd1 |
| 2 | 1 | WARNING | verify-served.sh:120 | sidecar not bound to bytes | FIXED | a7d7dd1 |
| 3 | 2 | WARNING | test:21 | length-only hasher passed the suite | FIXED | 4588ed1 |
| 4 | 2 | WARNING | test:43 | sectionless hasher passed the control | FIXED | 7ec88c5 |
| 5 | 3 | WARNING | release.sh:308 | error exit read as current (fail open) | FIXED | fb03aab |
| 6 | 3 | WARNING | release.sh:324 | filter grep spot check, passed on a missing file | FIXED | fb03aab |
| 7 | 3 | WARNING | release.sh:313 | notarise after the immutable copy | FIXED | fb03aab |
| 8 | 4 | WARNING | pkg-inputs.sh:161 | filter evaluator failed open | FIXED | 6baee39 |
| 9 | 4 | WARNING | pkg-inputs.sh:164 | global gitignore leaked into the evaluation | FIXED | 6baee39 |
| 10 | 5 | BLOCKER | pkg-inputs.sh:69 | sha depended on the repo root | FIXED | 90b8291 |
| 11 | 5 | BLOCKER | test:19 | determinism control blind to the root | FIXED | 90b8291 |
| 12 | 6 | WARNING | pkg-inputs.sh:91 | newline in a name hashed as absent | FIXED | 9f1ed15 |
(the remaining warnings and conventions are listed per iteration above, all FIXED)

### NITs (non-blocking, across all iterations)
- Deferred: the fixture's unreachable no-meta branch (2); step 7's existence grep above 3c (6); the rest fixed as listed.

### Strengths (across all iterations)
- Every control proven by mutation to fail on the defect it names (rounds 2 to 6).
- Exit-code contracts fail closed at every caller (rounds 4 to 6).
- 3c decides from the site dist, 9c reads the wire and names the failing fact, the two-line sidecar binds inputs to bytes (rounds 3 to 6).
- Frozen-tree discipline holds through 3c; a mid-notarise failure leaves the site dist untouched (every round).
