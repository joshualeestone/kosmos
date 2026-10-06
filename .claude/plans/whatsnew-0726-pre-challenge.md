---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0726
diff_hash: 5aa52eb343126c33c5b86993e5f27063abf385408ed659c4de7e1a7dd3bb0a86
validation: partial (Mortals full suite at a2cc0f342, same diff hash: node 16012 tests, 0 fail; red ONLY on the #1720 browser-check trailer gate, fixed at 1a5a245bf and both gates run alone pass. The rerun was withdrawn at 18:40 to free Mortals for the 0.7.26 cut Josh asked for now; the cut's step 3 runs the full suite at the pin, which contains this change)
subdir_audit: passed
timestamp: 2026-10-06T23:42:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus Mona Lisa's copy check, twice)
**Converged:** Yes
**Total findings:** 13 (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 8 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json:6 - "It says when it last ran and when it runs next" read as Kosmos running the task; Kosmos does not start the job (engine/taskrepeat.js) --> FIXED (a053ef749)
- [WARNING] web/whats-new.json:24 - the Gemini cap holds only Kosmos's own automatic sends and counts per computer, not per Google account --> FIXED (a053ef749: "Kosmos sends work to")
- [CONVENTION] plan - the left-out list missed #5354, #5254, #5388, #5387, #5383 --> FIXED
- [NIT] plan - times quoted from messages, not from date --> FIXED (dropped)
- [NIT] org chart limits (PNG/JPEG, pinned Codex) --> no change (the line says "a picture" and "can")

Mona's copy check (between iterations 1 and 2): line 3 rewritten in active voice (taken as hers); line 1 "reminded" overpromises (the nudge needs an idle agent and the Prompter on).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (line 1 from iteration 1)
- [WARNING] web/whats-new.json:7 - "reminded each time it is due" depends on the agent nudge, which is conditional --> FIXED (a2cc0f342: "When it comes due, it is open work for its agent again", agreed with Mona)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] x3 (Token Usage speedup is for Claude transcripts; org chart Claude-first; PR #5414's "one Google account" framing) --> no change, each consistent with the line
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:6 | BRANCH | repeat line implied Kosmos runs it | FIXED | a053ef749 |
| 2 | 1 | WARNING | web/whats-new.json:24 | BRANCH | Gemini cap overstated | FIXED | a053ef749 |
| 3 | 1 | CONVENTION | plan | BRANCH | left-out list incomplete | FIXED | a053ef749 |
| 4 | 1 | NIT | plan | BRANCH | message times | FIXED | a053ef749 |
| 5 | 2 | WARNING | web/whats-new.json:7 | SELF | "reminded" conditional | FIXED | a2cc0f342 |
| 6 | - | gate | (commit messages) | BRANCH | #1720 browser-check trailer missing (Mortals run) | FIXED | 1a5a245bf |

### Validation
- tools/whats-new-check.js 0.7.26: mac 4, windows 3. engine/whatsnew.test.js 12/12.
- Mortals full suite at a2cc0f342 (diff hash 5aa52eb3, identical to this proof's): 16012 tests, 15780 pass, 0 fail;
  the run's only red was the #1720 trailer gate. Fixed by an empty trailer commit (1a5a245bf); the coarse and the
  surface browser-check gates run alone both pass.
- The rerun was withdrawn so the 0.7.26 cut (Josh 18:32: "as soon as we can") could take Mortals; the cut runs the
  full suite at its pin, which includes this change.
