---
pre_challenge: true
method: challenge-loop
branch: donewhenfield-5152
diff_hash: 8e63ae8fbc27aa8cb2dc7a54de7031deb3351b2c922b8464416ad5b712c8c63f
validation: passed (rebased on origin/main; full node suite 17334 tests, 17101 pass, 0 fail, exit 0; both browser-check gates pass; every new test file red on origin/main (24 of 24 at round 0) and each later arm red/green against its fix)
subdir_audit: passed
timestamp: 2026-10-09T03:50:57Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (opus and sonnet alternating, each blind)
**Converged:** Yes (iteration 6: nothing above CONVENTION; its two conventions and one NIT fixed)
**Total findings:** 0 BLOCKERs, 13 WARNINGs, about 8 CONVENTIONs, about 20 NITs
**Fixed:** every WARNING except round 3's assignee gate, which round 4 showed could not hold and which was removed by decision (in the plan); the other decisions kept are in the plan with reasons | **Asked (awaiting user):** 0

The change (kosmos#5152 slice 1): a task's "done when" as its own field, doneWhen: null or 1 to 3 one-line checks of at most 200 characters, with control, format, invisible and unassigned characters refused by Unicode property. Agents set it with `kosmos task add ... --done "<check>"` or the new `kosmos task done-when <project> <n> "<check>" ... | --clear`, in both CLIs. `kosmos task list` prints the checks on their own indented line with who set them. The new route POST /api/project/<id>/task/<n>/done-when names its caller and refuses an agent not on the project. Checks set from the screen are the person's and no other caller may change them. A closed task returns 409, and a webhook cannot set checks. The task page's history says each change in words, and the same-text note compares checks. The full per-round log is in .claude/plans/donewhenfield-5152.md.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] the Mac CLI cut every refusal at its first double quote --> FIXED (sentences with no quote; refusal arms on both CLIs).
- [WARNING] an agent could overwrite the person's checks --> FIXED (doneWhenByPerson, 403, inside the write).
- [NIT] x6: Created line, You, control characters, one helper, screen and webhook arms --> FIXED; rate limit and guide masking DECIDED.

#### Iteration 2 (sonnet)
- [WARNING] direction overrides and invisible characters passed --> FIXED.
- [WARNING] the list did not say who set the checks --> FIXED (set by).
- [CONVENTION] the screen mark's strength --> DECIDED (stated in the plan).

#### Iteration 3 (opus)
- [WARNING] `task add <p> --done x` filed a task named --done --> FIXED (both CLIs).
- [WARNING] tag characters, soft hyphen and lone surrogates passed --> FIXED (by Unicode property).
- [WARNING] a check could forge a set-by mark --> FIXED (brackets folded).
- [WARNING] the assignee could rewrite another agent's bar --> FIXED, then REMOVED in iteration 4 (see there).

#### Iteration 4 (sonnet)
- [WARNING] x3: the assignee gate failed on name spellings, an unnamed write and unassign-then-retake --> RESOLVED by removing the gate (decision in the plan: the transcript and the list attribute every change; the person's mark is the protection that holds).

#### Iteration 5 (opus)
- [WARNING] a task sentence could forge the person's mark on the task's line --> FIXED (checks on their own indented line).
- [WARNING] no HTTP arm sent an agent token against the person's checks --> FIXED.

#### Iteration 6 (sonnet)
- [CONVENTION] x2: file map row, helper above its header --> FIXED.
- [NIT] a zero-width non-joiner, needed by Persian and Indic text, was refused --> FIXED.

### Verification
- Full node suite on the rebased branch: 17334 tests, 0 fail, REAL_EXIT=0.
- Both browser-check gates (coarse #1720, surface #2518) pass; the one page change (two tkActPhrase cases) carries its Browser-check trailer and a lifted-function test, red on main's page.
- Controls: every new test file ran red on origin/main (24 of 24 at round 0); later arms checked red/green against the code before each fix.
