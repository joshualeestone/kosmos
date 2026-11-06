---
pre_challenge: true
method: challenge-loop
branch: keptline-8051
diff_hash: e8fffd144822a77e1375851d367aa820518e022de35ef64e493203086970e3b4
validation: full suite on 62598eb83b (the reviewed code) 27482 tests, 27071 pass, 1 fail (an isolation test lacking a stub for the new helper); fixed in 5b10a01711 (test only), every test lifting the touched functions rerun 36/36; CI's full suite on the exact head is the gate
subdir_audit: not run (no CLAUDE.md under a changed path)
timestamp: 2026-11-06T05:07:58Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating), the cap. **Converged:** No: round 8, the final whole-branch read, found NITs only (no BLOCKER, no WARNING). Two were taken (comments give reasons, not round numbers), two DEFERRED with reasons below.

**What it is:** #8051 item 1 (Mona Lisa's design call on the card). A New agent within 30 minutes of the "Settings, AI Models" link reopens the half-typed form; it now says "This is where you left off before going to Settings." with Start over. Start over empties the form onto the three-way choice and focuses its first card; the name field is described by the sentence while it shows; Create agent and a role change take it away.

**After round 8:** a one-line test stub (web.create-role-reset-1786.test.js), from the full suite. Test code only.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] Start over dropped keyboard focus --> FIXED (focus to the first choice, as Back does)
- [WARNING] a screen reader never heard the line --> FIXED (name field aria-describedby)
- [WARNING] consolidated layout untested --> FIXED (arm added)
- [NIT] a control that could not fail for its stated reason --> FIXED (real control)
- [NIT] line stayed after Create --> FIXED (Create hides it)
- [NIT] limit arm changed shape --> FIXED (restored, line checks placed separately)

#### Iteration 2
**Reviewer model:** sonnet
- [NIT] consolidated arm asserted only shown --> FIXED (text and description)
- [NIT] hint colour may be faint --> FIXED (label-2)
- [NIT] describedby could clobber a future one --> FIXED (comment: this function owns it)
- [NIT] two untested paths --> DEFERRED: code read, both go through cstep('name') and createEnter or openCreate

#### Iteration 3
**Reviewer model:** opus
- [WARNING] .panel p out-ranked .fhint, so the line rendered as a second blurb --> FIXED (set by id in the hint's type; a size and order check fails on the old page, 13 vs 13)
- [NIT] placement under the blurb --> FIXED (moved directly under the title)
- [NIT] description included "Start over" --> FIXED (points at the sentence)
- [NIT] a weak final assertion --> FIXED (removed)

#### Iteration 4
**Reviewer model:** sonnet
- [NIT] three copies of the line read --> FIXED (one helper; the control asserts the whole line)
- [NIT] negative margin note, Start over wording --> DEFERRED: harmless (about 1px), wording judged clear beside the visible form

#### Iteration 5
**Reviewer model:** opus
- [NIT] Start over test did not check the description cleared --> FIXED
- [NIT] placement, early hide on a client bail-out, dark link colour --> DEFERRED: deliberate (first thing read; they acted; underline and weight carry the link)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] a role change empties the form but the line stayed --> FIXED (refillDetails' reset hides it; check fails on the old page)

#### Iteration 7
**Reviewer model:** opus
- [NIT] padding comment, unreachable path not said, no phone shot --> FIXED

#### Iteration 8 (final whole-branch read)
**Reviewer model:** sonnet
- [NIT] comments named review rounds --> FIXED
- [NIT] Create hides the line before the client bail-outs --> DEFERRED: matches the plan ("once they act on it")
- [NIT] the past-the-window check forces the line on --> DEFERRED: commented; it is what makes the check able to fail

### Controls, both arms
- The new line checks fail on main's page (no element), and the look check fails on the round-2 page (13 vs 13, below the blurb).
- The focus, description and Create-hide checks fail on the round-0 page; the role-change check fails on the round-5 page.
