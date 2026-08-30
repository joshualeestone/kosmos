---
pre_challenge: true
method: challenge-loop
branch: nobinary-1580
diff_hash: 3e8e1d725b960393877b98704d7f5d2c8da35606dec49298d3af304b3b117974
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T13:50:50Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes. Round 5 returned no BLOCKER and no WARNING that a mutation
demonstrates as a defect in this change; its findings were inaccurate statements
in my own comments and plan, fixed in-round.
**Blockers found and fixed:** 4 | **Warnings fixed:** 13 | **Carded, not fixed:** 3

**Criterion, agreed in advance and recorded on the card:** land when a blind
round returns no BLOCKER and no WARNING a mutation can demonstrate, with a clean
suite and the mutation set still red. NITs fixed in-round, no extra round bought.

### Per-round breakdown

#### Round 1 - 2 BLOCKERS
- [BLOCKER] part 2 entirely unpinned: deleting the post-install block left 1671 tests green --> FIXED (positive arm added)
- [BLOCKER] the Accounts button is a second, ungated entry to /api/connect/start --> DEFERRED, carded #1587 (since SHIPPED by another agent)
- [WARNING] UNKNOWN treated as connected after install --> FIXED
- [WARNING] my "three mutations each RED" was true as redness, false as verification: one red was an await-placement artefact --> FIXED, settle() helper added

#### Round 2 - 2 BLOCKERS
- [BLOCKER] the tests were DOWNLOADING THE REAL 281MB PRODUCTION BINARY on every suite run; tests 5-7 in the same file did it right, which hid it --> FIXED, verified with a request witness (0 calls, witness fires on a control)
- [BLOCKER] `accessSync` SUCCEEDS ON A DIRECTORY, so a folder at the binary path reported connected --> FIXED via resolveBin().present
- [WARNING] the plan claimed a mutation that did not go red --> FIXED, arm added

#### Round 3 - 0 blockers, 5 warnings
- a false rationale left standing TWELVE LINES ABOVE its own retraction, and repeated twice in the plan unretracted --> DELETED in all three places
- the resolveBin refinement unpinned (third instance of that gap) --> FIXED, and fixing it exposed that `haveBinary` still disagreed --> both now use one resolver
- test 8 had no local release server --> FIXED

#### Round 4 - 2 BLOCKERS
- [BLOCKER] the directory test asserted `start()`'s IMMEDIATE return and so hid that the SETTLED outcome was identical to main: the change altered the ROUTE, not the OUTCOME --> FIXED
- [BLOCKER] the post-install verification was the same bare accessSync that undid part 1 --> FIXED
- [WARNING] my comment's line numbers were stale and one named a site this branch DELETED --> rewritten to name symbols

#### Round 5 - 0 blockers, 3 warnings, all statement accuracy
- my `haveBinary` rationale measured my own harness: in production, spawning a directory returns EACCES so the probe already handles it --> corrected; the change stays for consistency
- my `canRunClaude` claim was false, and the truth is a real bug --> carded #1595
- test names promised more than the assertions establish --> renamed
- **CONVERGED**

### Mutations, each RED independently (final set)

```
binaryOnDisk forced true                4 RED
post-install gate weakened to accessSync 1 RED
UNKNOWN read as connected                1 RED
!haveBinary guard removed                1 RED
part 2 deleted wholesale                 1 RED
checkLive verification stubbed           2 RED
```

### Verified against the UNFIXED tree

`origin/main`'s connect.js dropped into this tree: **9 tests, 5 pass, 4 fail**,
the failures being the arms that describe the defect. Reproduce with:

```
git worktree add /tmp/vsmain origin/main
cp engine/connect.nobinary-1580.test.js /tmp/vsmain/engine/
cd /tmp/vsmain && node --test engine/connect.nobinary-1580.test.js
```

### Carded rather than fixed

- **#1587** the ungated Accounts entry (SHIPPED by another agent during this loop)
- **#1592** every hand-rolled runnable check accepts a directory; 5 sites across 4 modules
- **#1595** the STUCK screen's escape hatch has never rendered: publicView drops canRunClaude

### The recurring finding, stated once

Four separate times on this branch, my reasoning was correct in a comment while
the demonstration was missing or aimed at a case the mechanism could not reach.
Three times a guard's positive case had no arm. Once a fix was verified at the
point of change rather than the point of outcome, and the settled answer was
unchanged from main.

⇒ **A fix verified at the point of change rather than at the point of outcome is
not verified**, and a rule written in a file protects nobody: this file states
"read the settled phase" 240 lines above the test that violated it, and I wrote
both.
