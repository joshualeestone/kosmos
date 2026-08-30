---
pre_challenge: true
method: challenge-loop
branch: codexhome-1488
diff_hash: abd8882e9e88debf3ba526a7fa385783bad55ca76f76ff882ba0438caf9365b8
subdir_audit: passed
converged: false
timestamp: 2026-08-30T19:06:05Z
---

## [CHALLENGE-LOOP] Result: reviewed by the author with every guard arm perturbed, NOT blind-reviewed

🛑 **STATED PLAINLY SO NOBODY READS THIS AS MORE THAN IT IS: this branch has had NO blind
review round.** The fleet's weekly budget was named as the binding constraint at 12:49, and
I chose to spend the remaining review capacity on `plusstates-1615`, which changes shipped
user-facing copy, rather than on this. That is a judgement about where a reviewer is worth
more, and it is mine to be wrong about.

⇒ **`converged: false` is literal here.** No round has run, so nothing converged.

### Final Ledger

#### Iteration 1, author review with measured arms

[STRENGTH] The predicate has ONE home and both callers call it. Restating it in the route
would have created a second copy of the fact this card is about, which is the defect
`openaiaccounts.js:42` already records (#1337).

[STRENGTH] The weakest premise was named BEFORE building and then verified with a FIRING
control: 227 tests across the nine files pinning AGENT_WORKFORCE_CODEX_HOME pass, and
inverting `homeIsNamed()` reds 2 of them. Green alone would not have shown they exercise it.

[STRENGTH] Every guard arm perturbed, and each fires its OWN test while the others stay
green, so this is not one over-broad assertion firing four times:
page filter reverted -> only the page test reds; route field removed -> reds; predicate
restated inline -> reds; homeIsNamed always false -> reds.

[BLOCKER] I PATCHED THE WRONG PICKER. The filter went into `fillCreateAccounts`. Caught by
asking whether my edited line appeared in the diff of #1601, which added the switch picker
this card is about: it appeared ZERO times. Reverted and redone in `fillSwitchAccounts`.
RESOLVED. Same class as #1556, where I served a field on an endpoint nothing read.

[WARNING] The test's route window was a fixed 3000-character slice and the field sits 4037
past the anchor, so it failed for a reason unrelated to the code. A fixed window is a
spelling pin that goes stale as the route grows, and it fails in the ALARMING direction by
reporting a missing fix. RESOLVED: bounded by the next route, with a control asserting the
slice holds the body.

[WARNING] The absence assertions could have passed on an empty read, because
`assert.doesNotMatch('', /x/)` passes. RESOLVED: a population floor at module scope, plus a
control asserting the expression IS findable in the file that owns it.

[NIT] `delete-leftover.js` and `remove.js` differ in why they are default-live. Not this
card's; recorded on #1598, where it was acted on.

### Validation

Full suite **3164 tests, 3164 pass, 0 fail, exit 0**.
