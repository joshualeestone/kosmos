---
pre_challenge: true
method: challenge-loop
branch: pgrepbytes-9149
diff_hash: 4b9696d1ce43bf69f72cfd1da3e1cf6313e33f720700a8baf7fd2274525baa02
validation: the four touched test files run green on this Mac (test-tunnel-handshake-gate 66/66, test-running-anchor-5470 0 failures, tools.heavy-gate-3805.test.js 47 pass 0 fail, sleep-control guard clean); the full suite is the PR's CI. Not a local full suite: the 0.8.27 cut waits on this fix.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-27T03:33:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Round 2 found no BLOCKER. Its two SHOULD-FIX items were the live bad-byte arms, replaced by stubs as it recommended; that change is test-only and was not given a round 3 (stated, not hidden).
**Fixed:** all findings below unless marked. **Deferred:** 2. **Asked (awaiting user):** 0

**Validation, stated plainly.** No full local suite: the touched test files ran green, each fix was mutated and each mutation reds its arm. CI runs the full suite on the PR.

**Departures from the skill:** reviewers were general-purpose subagents briefed blind, one at a time. Stopped at 2 rounds for an urgent release blocker. The Self-generated line was not measured.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 SHOULD-FIX, 2 NITs
**Self-generated:** not measured
- [SHOULD-FIX] `_kosmos_shell_shards_live` used a plain pgrep (cut quiet-box wait read busy, reproduced) --> FIXED: LC_ALL=C, arm
- [SHOULD-FIX] the anchor test's own pgreps went red in the defect condition (reproduced) --> FIXED: LC_ALL=C
- [SHOULD-FIX] heavy-gate live_snapshot's awk stopped at the bad record, later processes read as not running (reproduced) --> FIXED: LC_ALL=C on both awks, source pin
- [NIT] the gate test's EXIT-trap pkill --> FIXED
- [NIT] the live arms prove nothing on Linux --> FIXED in iteration 2 (stubs are deterministic everywhere)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 SHOULD-FIX, 2 NITs
**Self-generated:** not measured
- [SHOULD-FIX] a live bad-byte arm can outlive its test (not in the EXIT trap) --> FIXED: no live process, a stub
- [SHOULD-FIX] the live arms put the very fault on the shared Mac (April's red tonight) --> FIXED: stubs that refuse unless LC_ALL=C
- [NIT] `_kosmos_drop_test_fixtures`'s `[[ =~ ]]` misses a fixture whose own line holds a bad byte --> DEFERRED: fails toward busy, the safe side
- [NIT] the heavy-gate awk-under-C check tests awk, not the gate --> DEFERRED: the source pin is the guard and can fail (measured)
- (After the PR's first CI: the #8195 pipefail ratchet read the edited anchor-test line as new --> FIXED: its baseline entry replaced. The other tests naming the touched code pass.)
