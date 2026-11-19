---
pre_challenge: true
method: challenge-loop
branch: claimpause-8761
diff_hash: 43da8ef845bbf1542bf2982deb8c3b20162e742d27484525bbe220684127f676
validation: focused from the repo root: tools/test-ci-runner-claim-pause-8761.sh (48 checks, PASS; perturbed four times, each perturbation turned it red), tools.shell-shard-4317, tools.every-test-runs, install.reachable-1662, install.local-board (all pass); shell-shard lists checked (Linux gets only bash -n); GitHub CI is the full gate
subdir_audit: passed
timestamp: 2026-11-19T22:05:37Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped at the 8-round review cap (Splinter's 2026-10-31 rule). Round 8 raised three WARNINGs and no BLOCKER; all three were fixed after it (an unreadable tick now resets the two-clear-ticks rule, tested and perturbed; plan wording; the test's call log), so those fixes are unreviewed.
**Fixed:** every BLOCKER and WARNING of rounds 1 to 8, except those documented as open | **Deferred:** NITs listed | **Asked:** 0

Record kept during the run in ~/.cache/claude-handoffs/angel-8724-review-ledgers-20261119.md (section "#8761").
The change adds a standalone watcher (tools/ci-runner-claim-pause.sh), its test and CI wiring. No product code and no
existing tool changes. The Mortals install is PigeonPete's half (agreed on kosmos#8761, m4897).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] the LaunchDaemon refusal could never fire (the daemon stage leaves .service naming the agent) --> FIXED
- [BLOCKER] the test used a daemon shape the setup tool never writes --> FIXED (the real shape; perturbed)
- [WARNING] a nonexistent setup stage named; race overclaimed; unreadable claim silent; .service trust weaker than runner_plist; pgrep stand-in ignored arguments --> FIXED; relay runner --> documented out of scope

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] KeepAlive true not checked before the stop --> FIXED (loaded_always parity, with a control)
- [WARNING] a slow stop read as a restart; an unreadable claim could restart a paused runner; test gaps --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a stop with no Listener up (self-update) --> FIXED (own_listener_re parity)
- [WARNING] a claim clearing while the stop was still ending left the runner down --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the 90 s grace could lose the restart --> FIXED (the marker holds the stopped pid)
- [WARNING] a gap in the claim between phases restarted the runner --> FIXED (two clear ticks)
- [WARNING] a new pid ends the pause for that claim --> documented as open in the header

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] the test would run, and fail, on Linux CI --> FIXED (tools/shell-macos-only.txt)
- [WARNING] the plan described a superseded timer; a planted-marker sentence overclaimed --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] SIGTERM-exits-0 only stand-in tested --> FIXED (named as an on-box measurement in the install recipe)
- [WARNING] a future clear time stalled the restart --> FIXED (49/50 s boundary pinned; perturbed)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] one check ran with the real HOME and wrote a state file there --> FIXED (sandboxed, no-leak check; the stray file, holding only that line, removed)
- [WARNING] "said every tick" was false under the said-once log --> FIXED

#### Iteration 8
**Reviewer model:** sonnet (cap)
- [WARNING] an unreadable tick left an earlier clear on record --> FIXED after the cap (tested, perturbed)
- [WARNING] "never a red job" overclaimed --> FIXED after the cap (best effort)
- [WARNING] the test's call log was never cleared --> FIXED after the cap

### Strengths
- [STRENGTH] Liveness by ps -p, not kill -0, which cannot see another user's live process; tested against pid 1 with a precondition proving kill -0 fails there.
- [STRENGTH] Every tick branch has a test arm that can return the dangerous answer, with controls for KeepAlive and the clear boundary.
