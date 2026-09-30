---
pre_challenge: true
method: challenge-loop
branch: portraits-4720
diff_hash: 3b3d557ca8b30717beb0921ba3656ab2197b154c1ca01915b62605006fb1f976
validation: passed (full tools/run-tests.sh through validation_log_run_or_skip, run on MORTALS via ~/.cache/claude-handoffs/detached-mortals-validate.sh at 1af68bedb, 09:07 to 09:51 CDT 2026-09-30: node 12569 tests, 12347 passed, 0 failed, 222 skipped; shell green; exit 0; the recorded hash equals diff_hash above)
subdir_audit: passed
timestamp: 2026-09-30T14:53:16Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

kosmos#4720: a prebuilt team member's portrait is downloaded by the board from beside the signed catalogue,
used only when it is the image the catalogue names, and served at GET /api/catalogue/portrait.

**Iterations:** 6, each a separate blind reviewer agent that saw only the branch and the plan.
**Converged:** Yes, at iteration 6: 0 BLOCKER, 0 WARNING (3 NITs).
**Total findings:** 0 BLOCKER, 9 WARNING, 22 NIT across six rounds.
**Fixed:** every WARNING | **Written down as decided gaps:** in the plan | **Asked:** 0

### Iteration 1 (opus): 0 BLOCKER, 3 WARNING, 7 NIT
- [WARNING] the prune's keep list had no test --> FIXED (a second member's kept portrait must survive)
- [WARNING] a portrait whose save fails was downloaded on every ask --> FIXED (held in memory; tested)
- [WARNING] a missing decided gap (a portrait republished under the same name) --> WRITTEN DOWN
- NITs taken: crossSiteRead on the route; the maps keyed by hash AND name; a catch in the route's handler;
  each arm of the WebP test, the declared-size refusal, the gap's expiry and the headers pinned.

### Iteration 2 (sonnet): 0 BLOCKER, 3 WARNING, 3 NIT
- [WARNING] my removal of the 20-byte floor as "redundant" was WRONG (a 16-byte file passes) --> FIXED, pinned
- [WARNING] two prune guards unpinned (keep the portrait just saved; drop an unnamed in-memory one) --> FIXED
- [WARNING] "23 guards each red" overstated --> CORRECTED in the plan
- NITs taken: the 404 body is { error } like the rest of the board; the cap pinned as 524288.

### Iteration 3 (fable): 0 BLOCKER, 1 WARNING, 4 NIT
- [WARNING] the route test's "refused before the board fetches" could not fail --> FIXED (own member per test)

### Iteration 4 (opus): 0 BLOCKER, 1 WARNING, 5 NIT
- [WARNING] that fix raced the download it was meant to catch (red 24 runs of 30) --> FIXED: it waits for a
  stray download and checks nothing was kept. Re-measured: the broken order is red 30 of 30, the unbroken
  file green 10 of 10.
- NITs taken: the second ask's cap, the half-written file and the in-flight key pinned; one dead line removed.

### Iteration 5 (sonnet): 0 BLOCKER, 1 WARNING, 2 NIT
- [WARNING] my iteration 4 change un-pinned the failure map's key --> FIXED (two tests: asked at once, and
  one after the other; each map keyed by hash alone turns its own test red)

### Iteration 6 (fable): 0 BLOCKER, 0 WARNING, 3 NIT. CONVERGED
- The reviewer's own sweep: 51 removals it chose, 44 red; the 7 green ones are named in the plan and left.
- Unmutated, both files green 10 of 10; the three timing-dependent removals red 20 of 20.
- NITs taken in the plan only (no code or test changed after this round).

### What is decided and not built (full reasoning in .claude/plans/portraits-4720.md)
- Redirects are followed, as the catalogue's own download does.
- A portrait republished under the same file name is refused until the board takes the newer catalogue.
- The route answers GET only and can take about 16 s on a slow catalogue address.
- This PR does not change the Team screen: `tcPortrait` exists only on #4709 and moves to the new route
  after that PR is on main. The card stays open until then (the PR says Addresses, not Closes).

### Disclosed against my own work
- Rounds 3, 4 and 5 each found a test that did not pin what my previous fix claimed.
- My first plan said another website could trigger the route with an image tag; that was wrong.
- The validation ran at 1af68bedb; main has moved 3 commits since (one touches server.js, 3 lines, no
  conflict: merge-tree clean). Not re-run: the PR's CI on the merge commit decides.
