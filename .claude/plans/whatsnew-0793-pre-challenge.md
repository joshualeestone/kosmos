---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0793
diff_hash: 06baba7e91de69763b417796ad544a9600d09ae366df847f995f9266e92ea1fa
validation: passed (Mortals full suite, 27518 tests, 0 fail, entry clean for this hash, base 5937a9b8d9; then rebased on main 0a8ed9bfee, which adds only #8094, no file in common, the diff hash unchanged. A 6j call after the rebase started a local suite on Agent1s instead of skipping and was stopped; no local entry was written)
subdir_audit: passed
timestamp: 2026-11-06T06:54:12Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6's only WARNING duplicates iteration 4's deferred finding)
**Total findings:** 6 actionable (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs), 11 NITs
**Fixed:** 5 | **Deferred:** 1 | **Asked (awaiting user):** 0

Before iteration 1, a separate blind check read each new line against the code: four were true; the Windows line was overstated (said once, at switch-on) and was rewritten in the reviewer's words.

Disclosure: iteration 5's prompt added one sentence telling the reviewer that What's New lines are highlights, to be judged on the ordinary case. It was added after iteration 4's deferred finding. Iteration 6 used the standard prompt and raised that finding again (a duplicate of the deferral).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json #8039 line: "files your settings import" sends a person to the Settings screen; it is the agent's instructions. --> FIXED (iteration 1 commit)
- [NIT] #8040 "keeps what you typed" broader than the code --> FIXED in the same commit (later dropped, iteration 2)
- [NIT] plan: PR and card numbers both --> FIXED
- [NIT] plan: list what else is left out --> FIXED
- [NIT] the Windows slot's trade --> recorded as a decision

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the WARNING cites iteration 1's rewording, a prose claim: deleted, not rewritten)
- [WARNING] #8040 "Back within 30 minutes, your form is kept" had no stated starting point. --> FIXED by deleting the clause; the line says only where the refusal shows and its link.
- [NIT] Windows line covers only the refused case --> folded into iteration 3's fix
- [NIT] #8090 has no commit subject --> plan already gives #7504

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the plan's cost sentence)
- [WARNING] the title "Windows says when..." reads as Windows itself showing a notice. --> FIXED: "Settings says when crash recovery is not set up".
- [WARNING] the plan misstated what the Windows slot costs. --> FIXED (then found wrong again, iteration 5)
- [NIT] the line did not fit the not-yet and could-not-check cases --> FIXED: "has not set itself to reopen"
- [NIT] "imported files" in the title --> left: the line clears it
- [NIT] the git-repo-above-the-folder case --> see iteration 4

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] #8039 "you can start it without them" does not hold for an agent folder inside a git repository rooted above it (no button; the terminal ending). --> DEFERRED: the line is true for the ordinary agent folder; the case is the #8039 plan's own named residual, and a highlight that lists it would be longer than the limit and less clear.
- [NIT] "a link to connect one" opens Settings, AI Models --> left: that is where one connects
- [NIT] #8039 on Windows not verified --> left: route and screen-read are generic

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the plan's cost sentence again)
- [WARNING] the plan's "what the Windows slot displaces" was wrong (two rank-16 items tie, newest first). --> FIXED by deleting the claim; the plan says how to measure it.
- [NIT] "new agent" narrower than the code --> left

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 (its WARNING is iteration 4's deferred finding; 2 NITs)
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json #8039 | BRANCH | "your settings" misleads | FIXED | iteration 1 commit |
| 2 | 2 | WARNING | release/whats-new-pool.json #8040 | SELF | kept-form clause ambiguous | FIXED | clause deleted |
| 3 | 3 | WARNING | release/whats-new-pool.json Windows title | BRANCH | reads as Windows speaking | FIXED | iteration 3 commit |
| 4 | 3 | WARNING | .claude/plans/whatsnew-0793.md | SELF | slot cost misstated | FIXED | iteration 3, superseded by #6 |
| 5 | 4 | WARNING | release/whats-new-pool.json #8039 | BRANCH | git repo rooted above the folder | DEFERRED | #8039's named residual |
| 6 | 5 | WARNING | .claude/plans/whatsnew-0793.md | SELF | slot cost wrong again | FIXED | claim deleted |

### NITs (non-blocking, across all iterations)
- "imported files" in the #8039 title (iteration 3): left, the line clears it.
- "a link to connect one" opens Settings, AI Models (iterations 4, 6): left.
- "new agent" narrower than the code (iterations 5, 6): left.
- #8039 on Windows not measured (iteration 4): left.
- plan has no heading for notesOnly (iteration 6): left.

### Strengths (across all iterations)
- The built web/whats-new.json is byte-identical to the tool's output (every iteration).
- notesOnly only on the two agent commands; #8068's mover hold rightly left out (every iteration).
- No em dash in any of five spellings; lengths within limits; unique titles (every iteration).
