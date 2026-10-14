---
pre_challenge: true
method: challenge-loop
branch: wn-0750
diff_hash: bb1b747d25441cc57e16e1495aa714917179cbd63daf3421e8b72b962a1532a9
validation: passed
subdir_audit: passed
timestamp: 2026-10-14T23:20:01Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10, sonnet: NITs only)
**Total findings:** 19 actionable (1 BLOCKER, 18 WARNINGs) plus NITs
**Fixed:** 19 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: Mortals full suite on c6fa560212 (this diff), clean: 20632 tests, 0 failed; the browser-check gate passed on
the first commit's Browser-check trailer (run locally before queueing too). Mortals hashed with ids at 9
(0b062798c81b); mortals-validate's ladder matched it to this diff (local bb1b747d2544, git's own length), and
run_or_skip matched it.

### Per-Iteration Breakdown
Each finding, its fix and its reason are in .claude/plans/wn-0750.md (Review ledger and the per-entry notes) and in
the commit messages; summarised:

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] iPad line omitted conditions (saved Tabs choice, touch, folded rail) --> FIXED d73affd34b
- [WARNING] "a project opens on its tasks" (it puts them first) --> FIXED d73affd34b
- [NIT] decision line: a missed run names no agent --> FIXED d73affd34b

#### Iteration 2
**Reviewer model:** opus
- [WARNING] title "Updates stop stealing focus" claimed more than the fix (dialogs still can) --> FIXED 6ac2031b73
- [NIT] "it" referent; "touch iPad"; Needs Your Decision casing --> FIXED 6ac2031b73

#### Iteration 3
**Reviewer model:** haiku
- [BLOCKER] sideways claim without the saved-choice condition --> FIXED 2292e3cb30
- [WARNING] upright claim needed its condition --> FIXED 2292e3cb30
- [WARNING] #6156's landscape default had no recorded basis --> FIXED 2292e3cb30 (recorded: merged at its own noon timeout, stated default)
- [WARNING] decision line overgeneralised --> FIXED 2292e3cb30 ("when one is")
- [WARNING] "self-restart" jargon --> FIXED 2292e3cb30

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] "unless it chose Tabs": who chooses, and where --> FIXED e6e2b5a55f

#### Iteration 5
**Reviewer model:** opus
- [WARNING] "One screen"/"Tabs" are not labels an iPad shows --> FIXED e4c7728a83
- [WARNING] the restart that delivers 0.7.50 runs 0.7.49's code --> FIXED e4c7728a83 ("from the next update on")
- [WARNING] quiet-runs line pointed at a card that does not show it --> FIXED e4c7728a83

#### Iteration 6
**Reviewer model:** haiku
- [WARNING] "opens behind" was an unmeasured visual claim --> FIXED 2d1ca58618 / cd2c99c031 ("no longer takes focus")
- [WARNING] upright 13 inch on One screen --> FIXED ("most")
- [WARNING] the plan kept a superseded premise --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
- [WARNING] Split View / Slide Over --> FIXED 608dcb6a87 ("at full width"; "agent cards")

#### Iteration 8
**Reviewer model:** opus
- [WARNING] "(a View choice of its own)" read two ways --> FIXED d030d8d798
- [WARNING] restart title broader than its line --> FIXED d030d8d798
- [CONVENTION] plan kept superseded paragraphs --> FIXED d030d8d798 (rewritten to its final state)

#### Iteration 9
**Reviewer model:** haiku
- [WARNING] title "Updates ..." could cover the update's dialogs --> FIXED c6fa560212 ("A restart after an update stops taking focus")
- [WARNING] focus claim unmeasured --> FIXED c6fa560212 (the plan says it is reasoned from the activation path)
- [NIT] #6156 in 0.7.49 unverified --> VERIFIED (423bd47759 is an ancestor of the 0.7.49 freeze 7cf7dee0f)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 (NITs only: "most" cards vs iPads; the trackpad claim is unmeasured, only in the plan; two waiting
agents join with a space; the Agents list scope). Converged.

### Process note (disclosed)
One commit (2d1ca58618) carried a stale web/whats-new.json: the build refused a 143-character line, and the chain piped
the build into head, so its refusal did not stop the commit. cd2c99c031 rebuilt it; every later commit checked the
build's own exit code and grepped the built file for the new line.

### Reviewer rotation
sonnet, opus, haiku, repeating: the convergence (iteration 10) is witnessed by a different model from iteration 9.
