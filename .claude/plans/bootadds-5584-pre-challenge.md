---
method: challenge-loop
branch: bootadds-5584
diff_hash: b50c01e35110f6b5372636ab9c91faf0aabdbf046a5c2eff7c52cf12c1fc554f
timestamp: 2026-10-08T12:01:00Z
iterations: 5
converged: true
---

# Challenge-loop proof: bootadds-5584 (#5584, the install gate's added-files check at PR time)

`install.boot-adds-5584.test.js` boots the real `server.js` the way `tools/test-install.sh`'s smoke boot does:
- the gate's exported variables, pointed into a sandbox;
- the gate's seeded person data;
- DRY_RUN, with NODE_TEST_CONTEXT set explicitly;
- the gate's first request to `/`.

It then snapshots the added files twice: at the first answer, where the gate takes its diff, and once every
expected file has landed and the set is still, bounded at 45s. It compares them with `EXPECTED_ADDS`, read live
from the gate script. The PR also blesses board-alive.json, the same change as the 0.7.28 cut's installgate-5359.

Blind reviewers alternated Sonnet and Opus for 5 iterations. Rounds 1 to 4 each found real gaps, all fixed. Round
5 found nothing.

**Controls:**
- Main's list without the bless: FAILS, naming `./Kosmos/board-alive.json`. That is the real 0.7.28 defect, re-run
  after each environment change.
- With the bless: PASSES.

**Full validation on HEAD 9557d4d14** (06:10 to 06:58 CDT): 16602 pass, 0 fail, validation rc 0, subdir audit rc
0, attempt 1.

#### Iteration 1
- [WARNING] the sandbox was narrower than the gate's: the Claude config file and root were unset, so trust and
  onboarding could reach the operator's real ~/.claude.json. FIXED 31f9a33c6, with all the gate's exports.
- [WARNING] the settle loop could stop before slow start writes on a loaded machine. FIXED 31f9a33c6: it waits for
  every expected file plus 3s of stillness, bounded at 45s.
- [NIT] the first request had no timeout. FIXED 31f9a33c6.

#### Iteration 2
- [WARNING] ping.json's guard was misnamed: it is createdbeacon's, at listen, not ping.underTest(). FIXED 8986145ae.
  The assertion now targets the real guard.
- [WARNING] NODE_TEST_CONTEXT was inherited, not set, so running the file another way woke the network modules.
  FIXED 8986145ae.
- [WARNING] the test waited longer than the gate diffs, so it could advise blessing a late file. FIXED 8986145ae:
  a first-answer snapshot, with late files reported apart.
- [NIT] the plan's bound. FIXED.

#### Iteration 3
- [WARNING] the child inherited the gate's request log, which in a cut is the operator's real log. FIXED 385e4091a
  (the log stays in the sandbox).
- [WARNING] a directory removed mid-walk threw ENOENT. FIXED 385e4091a.
- [NIT] no answer to the first request now fails clearly; a stale comment. FIXED.

#### Iteration 4
- [WARNING] a repeated EXPECTED_ADDS entry passed here but fails the gate's literal compare. FIXED 9557d4d14.
- [NIT] the no-answer message's bound. FIXED.

#### Iteration 5
- No issues found.
