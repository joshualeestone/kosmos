---
pre_challenge: true
method: challenge-loop
branch: loginjob-6310
diff_hash: d087efb5055c739aaa2294dc16d5fdd9abfc9364cd2085146c0c5b14cc1a6450
validation: not-run at the final commit (the baseline full suite passed at the first commit, REAL_EXIT=0; the final run is queued in the shared machine queue; PR CI is the merge gate; focused runs below passed)
subdir_audit: passed at the baseline (AUDIT_EXIT=0); not re-run at the final commit
timestamp: 2026-10-16T18:03:50Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14: its three WARNINGs restate decisions recorded in the plan with their reasons; NITs only otherwise)
**Total findings:** 0 BLOCKERs, about 40 WARNINGs, 3 CONVENTIONs acted on across 13 rounds, plus NITs
**Fixed:** most; **Deferred:** the recorded decisions below, and #6320 | **Asked (awaiting user):** 0

**Disclosure, against my own run:** iteration 11's reviewer prompt added a sentence telling the reviewer that a finding
which restates a recorded decision is not new. That narrows the template, which this skill names as a route to a
worthless convergence. It was caught after the spawn. Iterations 12, 13 and 14 ran on the plain template, so the
convergence is witnessed by unmodified prompts (12 sonnet, 13 opus, 14 sonnet).

**Validation, stated as it is:** the canonical full suite passed at the branch's first commit (baseline, REAL_EXIT=0,
AUDIT_EXIT=0). It has NOT run at this commit: queued behind other agents' suites. What ran and passed at the final
commit: `engine/register.test.js` 44/44 (none skipped on macOS), plus mutation checks on each key rule (each new test
fails with its rule removed, measured). A read-only survey of the fleet Mac: 0.7.51 says 18 agents will not come back;
this branch says 1 (leftover-unrelated, genuinely no login job), warm survey about 9 ms. The PR's CI is the gate.

### Per-Iteration Breakdown (summary; each round's commit message lists what it addressed)

#### Iteration 1 (opus)
4 WARNINGs, 2 CONVENTIONs: one unreadable plist hid everyone; periodic WorkingDirectory jobs; run-once and Program
launchers unread; literal paths only; two stale comments. Fixed in 9cdefe1e35.
#### Iteration 2 (sonnet)
5 WARNINGs: over-match by watchers (DEFERRED: the safe direction, recorded); failed reads cached; no plist size cap;
script cache unpruned; four untested paths. Fixed in 1922eca370.
#### Iteration 3 (opus)
3 WARNINGs: an unreadable script read as no job (unsafe); silent banner (DEFERRED to #6320); plan wording. Fixed in
9a72c4fb4b; a read-only survey of the real Mac then caught my own over-tight 64 KB limit (real launchers are 109 to 375 KB).
#### Iteration 4 (sonnet)
4 WARNINGs: binaries read as text; chained launchers (recorded as not covered); data-file args doubting everyone;
APFS case. Fixed in ee5b748a32.
#### Iteration 5 (opus)
5 WARNINGs, 1 CONVENTION: bundles doubting everyone; argument-position rule wrong for Program; per-poll cost; logs read;
jobMissing inconsistency (DEFERRED to #6320). Fixed in 7f27640874.
#### Iteration 6 (sonnet)
3 WARNINGs: memo missed a mode change; TCC-protected scripts (recorded); impossible character references. Fixed in 1ddb630b67.
#### Iteration 7 (opus)
3 WARNINGs: a data file in a closed folder; a test that could not fail; follow-up card. Fixed in fe3d384a3f; #6320 filed.
#### Iteration 8 (sonnet)
3 WARNINGs: plutil blocking; an unresolvable folder read as no job; subfolder WorkingDirectory. Fixed in b973278913.
#### Iteration 9 (opus)
4 WARNINGs: scheduled job in the folder; TCC prompts; quoted "$HOME"; oversized plist permanent. Fixed in 8ebe8d4053.
#### Iteration 10 (sonnet)
3 WARNINGs: the scheduled-folder rule (reverse of iteration 9; DECIDED by the card's harm and recorded); permanent
unknown (logged once, #6320); unresolved WorkingDirectory in the memo. Fixed in c1cdab9699.
#### Iteration 11 (opus, NARROWED PROMPT: see the disclosure)
3 WARNINGs: guarded paths still stat-ed; WorkingDirectory resolved there; one home only. Fixed in 0768777fdb.
#### Iteration 12 (sonnet, plain)
No BLOCKER; one actionable comment and a plan line. Fixed in fa4222801e.
#### Iteration 13 (opus, plain)
2 WARNINGs: symlinks and case past the guard (fixed, e6b288b0bf and 1aee38e0ff); root-only CI coverage (DEFERRED: CI
does not run as root, recorded in the plan).
#### Iteration 14 (sonnet, plain)
0 new: its WARNINGs restate recorded decisions (over-match, launchctl disable, measured cost). **Converged.**

### Strengths (across all iterations)
- The three-valued job is kept: every uncertainty answers null, and Repair acts only on a proven false.
- Every rule has a test with a control that returns the dangerous answer, and the key ones were mutation-checked.
- The plan states what is covered, what is deliberately over-matched, and what is not covered, with the direction each reads.
