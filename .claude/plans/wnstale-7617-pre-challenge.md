---
method: challenge-loop
branch: wnstale-7617
diff_hash: 4a6ac465242f98f6462857639d013655171566a420f34dfb7e9f28d3b19c6c2f
timestamp: 2026-10-30T14:45:24Z
iterations: 4
converged: true
---

# Challenge-loop proof: wnstale-7617 (kosmos#7617: the cut refuses a What's New list the pool no longer builds)

Four blind code reviews, one at a time, each by a fresh agent. Round 4 found no BLOCKER and no SHOULD-FIX; its two
doc NITs were fixed.

#### Iteration 1
The freshness check compared the version field, so a list shared through "also" was refused; a pool that does not
build read as a stale list; 2b-ii did not check the frozen tree. All fixed, with arms in tools.release-gate.test.js.

#### Iteration 2
BLOCKER, fixed: tools/test-whats-new-early-7349.sh (test:shell only, never the node suite) went red: its pool
stand-in had never been asked to build, so its CONTROL arm read stale. The stand-in builds now; new arms for a stale
list (stops before the marker) and an unreadable build (could not compare, exit 2), both red with the call removed.
The reviewer replayed the check over the last 25 main commits touching the list or pool: all match.

#### Iteration 3
SHOULD-FIX, fixed: docs/releasing.md told the operator to run two checks before holding merges. It names the third
and its command (run for real: writes nothing in the tree, highlights equal main's list), pinned in the 3955 test
(red on the old wording). No other test that stubs the pool or runs release.sh is broken by the check.

#### Iteration 4
Two NITs, fixed: "both 1b-ii checks" in the doc and a release.sh comment; the doc's command now says a failed build
stops the cut and uses a mktemp path.

#### Validation
tools.release-gate.test.js + tools.whats-new-check-3955.test.js 80/80 at 7a3a8ab954 (release.sh logic unchanged
since; later commits touch docs, tests and one comment); 3955 9/9 and test-whats-new-early-7349.sh ALL PASS at the
head. The full node and shell suites run in CI on the PR.
