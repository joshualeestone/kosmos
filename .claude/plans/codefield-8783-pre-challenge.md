---
pre_challenge: true
method: challenge-loop
branch: codefield-8783
diff_hash: dda6a83b5706b35b88c66c07feefee33e43017ad085890d80a80353832b0247f
validation: focused from the repo root: server.connect.test.js (69 pass) and all web.*.test.js (3,791 pass, before the later small edits); design shots at iPhone SE, iPhone 15 and desktop with the stricter verify (0 errors); perturbed (reveal removed: its test fails; unprefixed mask removed: its test fails); GitHub CI is the full gate
subdir_audit: passed
timestamp: 2026-11-20T02:54:10Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped at the 8-round cap with no BLOCKER open. Round 8's one WARNING (a comment wider than its guard) was fixed after it (comment only).
**Fixed:** every BLOCKER and WARNING | **Deferred:** NITs listed in the ledger | **Asked:** 0

Ledger: ~/.cache/claude-handoffs/angel-8724-review-ledgers-20261119.md ("#8783 codefield"). Design approved by Mona Lisa.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] the late link pushed the field back down --> FIXED (reveal on the new link, the whole box)
- [WARNING] link and field both visible; a source-text test --> FIXED (behavioural tests)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the shot verify could not fail; the observers were untested --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the ResizeObserver watched a 1px hint; a tall box could hide the field --> FIXED; the mask on iOS unmeasured on a device --> DISCLOSED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the unprefixed mask check could not fail --> FIXED (anchored; perturbed)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the reveal stopped the row inside the fade --> FIXED (44px scroll margin; verify requires clear of the fade; re-shot)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] an unbacked comment --> FIXED (dropped)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the order was not asserted --> FIXED; the double reveal --> documented as intended

#### Iteration 8
**Reviewer model:** sonnet (cap)
- [WARNING] a comment wider than the stamp guard --> FIXED after the cap (comment only)

### Strengths
- [STRENGTH] The field is never focused, and a test pins it.
- [STRENGTH] The shot verify measures geometry against the body and the fade, so it fails on the real defect.
