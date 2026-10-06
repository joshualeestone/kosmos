---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0726
diff_hash: a548793aeba35f0c54bfb234180496dd0557907c2d28d06d87cf9bacd1318d9c
validation: partial (Mortals full suite at a2cc0f342, which differs from this head only in line 1's wording, a data string: node 16012 tests, 0 fail; red ONLY on the #1720 browser-check trailer gate, fixed at 1a5a245bf and both gates run alone pass. The rerun was withdrawn at 18:40 to free Mortals for the 0.7.26 cut Josh asked for now; the cut's step 3 runs the full suite at the pin, which contains this change)
subdir_audit: passed
timestamp: 2026-10-06T23:42:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (plus Mona Lisa's copy check, three times)
**Converged:** Yes
**Total findings:** 16 (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 10 NITs)
**Fixed:** 8 | **Deferred:** 0 | **Asked (awaiting user):** 0

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

Mona's copy check 18:34: APPROVED; recommended line 1 name missed runs (#5416 merged 17:06, ships in this cut). Taken (d4da19c9c).

#### Iteration 4 (the line 1 change)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] web/whats-new.json:7 - "A missed run shows in red" was true on main but the branch base predated #5416 --> FIXED (rebased onto origin/main: 9ea9f6ccb is an ancestor; "Missed the run due" and the .tsk-repeat.missed red rule are in web/index.html; the cut pins main after this merges, which contains #5416)
- [NIT] plan "checked against main ~15:30" for the missed-run part --> FIXED (plan row says it was checked after the rebase)
- [NIT] "When due, it is open work again" and hourly/daily/weekly confirmed --> no change
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json:6 | BRANCH | repeat line implied Kosmos runs it | FIXED | a053ef749 |
| 2 | 1 | WARNING | web/whats-new.json:24 | BRANCH | Gemini cap overstated | FIXED | a053ef749 |
| 3 | 1 | CONVENTION | plan | BRANCH | left-out list incomplete | FIXED | a053ef749 |
| 4 | 1 | NIT | plan | BRANCH | message times | FIXED | a053ef749 |
| 5 | 2 | WARNING | web/whats-new.json:7 | SELF | "reminded" conditional | FIXED | a2cc0f342 |
| 7 | 4 | WARNING | web/whats-new.json:7 | SELF | branch base predated #5416 | FIXED | rebase |
| 6 | - | gate | (commit messages) | BRANCH | #1720 browser-check trailer missing (Mortals run) | FIXED | 1a5a245bf |

### Validation
- At this head (rebased on main): tools/whats-new-check.js 0.7.26: mac 4, windows 3. engine/whatsnew.test.js 12/12.
- Mortals full suite at a2cc0f342 (differs from this head only in line 1's text): 16012 tests, 15780 pass, 0 fail;
  the run's only red was the #1720 trailer gate. Fixed by an empty trailer commit (1a5a245bf); the coarse and the
  surface browser-check gates run alone both pass.
- The rerun was withdrawn so the 0.7.26 cut (Josh 18:32: "as soon as we can") could take Mortals; the cut runs the
  full suite at its pin, which includes this change.
