---
pre_challenge: true
method: challenge-loop
branch: nativeagents-6838
diff_hash: 222e0afe17943c97d9250edcf0220de3893c0d22b4f38e6e665cf290df8d2864
validation: passed
subdir_audit: passed
timestamp: 2026-10-21T16:51:12Z
iterations: 25
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 25 (17 on the pre-spec code, which converged at iteration 17; 8 more after Mona Lisa's slice 1
spec landed and the code was rebuilt to it).
**Converged:** yes. Iteration 25 (sonnet) returned no BLOCKER, WARNING or CONVENTION finding.
**Reviewer models:** alternated opus and sonnet across iterations (18 opus, 19 sonnet, 20 opus, 21 sonnet,
22 opus, 23 sonnet, 24 opus, 25 sonnet; the same alternation earlier in the run).

### Validation (6j)

The diff touches only ios/ and this plan; no file the node suite runs or reads is changed (12 files: ios/Kosmos/*,
ios/LogicTests/*, ios/README.md, .claude/plans/nativeagents-6838.md). The kosmos validation helper (full node suite)
measures nothing in this diff, so the meaningful checks were run instead, at a4cc0002ee:
- ios/LogicTests/run.sh: VERDICT: PASS 374/374 (BoardLogic plus the BoardClient loop driven by a fake Kosmos+ and Mac).
- xcodebuild Debug, Release, and the store-shots configuration (DEBUG KOSMOS_STORE_SHOTS): BUILD SUCCEEDED, no Swift
  warnings (only the two standing tool notices: AppIntents metadata, ONLY_ACTIVE_ARCH).
- Release binary carries none of the Debug-only switch strings: strings | grep -c KOSMOS_SAMPLE_AGENTS is 0 in
  Release and 2 in Debug (the control), measured at a4cc0002ee.
- Not measured, named in the plan: a native POST admitted by the real gate, a real Set-Cookie, real timing. These
  are measured on the first TestFlight run.

### Per-Iteration Breakdown

#### Iterations 1 to 17 (pre-spec code)
Reviewer model: alternating opus and sonnet. Findings shrank to none at iteration 17. Two real loop bugs were
introduced by my own fixes in this stretch and caught by review: restoring an ended kept cookie (iteration 12)
and Try again restoring it again (iteration 13). Loop tests were added from iteration 12.
- [WARNING] BoardClient.swift: ended kept cookie restored on reconnect --> FIXED, with loop test
- [WARNING] BoardClient.swift: Try again restored the dead cookie --> FIXED, with loop test

#### Iteration 18 (opus, first on the spec diff)
Self-generated: 10 of 10 (all in the new spec code).
- [WARNING] ContentView.swift: store-shot build opened on Agents --> FIXED (358ebf6)
- [WARNING] AgentsView.swift: list dropped while reconnecting --> FIXED (358ebf6)
- [WARNING] BoardClient.swift: pictures fetched inline; failures retried forever --> FIXED (358ebf6)
- [WARNING] AgentsView.swift: word did not wrap at the largest text sizes --> FIXED (358ebf6)
- [WARNING] AgentsView.swift: Try again label unreadable under the ink tint --> FIXED (358ebf6)
- [WARNING] ContentView.swift: cold-launch notification tap did not open Board --> FIXED (358ebf6)
- [WARNING] four more layout and copy warnings from the spec --> FIXED (358ebf6)

#### Iteration 19 (sonnet)
- [BLOCKER] BoardClient.swift: a cancelled picture fetch was recorded as a failure --> FIXED (74bd44a), loop test
- [WARNING] x4: not answering ended the loop; self-recovery --> FIXED (74bd44a), loop tests, two mutants red

#### Iteration 20 (opus)
- [WARNING] x4: no session opens on Board; earlier list drawn as not current; account check used the shown list's
  owner; unknown states quiet --> FIXED (4803a1f)

#### Iteration 21 (sonnet)
- [WARNING] x5: refresh mid-connect; handoff from a stopped run; picture failures unbounded; VoiceOver lacked
  "not updating"; empty earlier list --> FIXED (c5cc9b8)

#### Iteration 22 (opus)
- [WARNING] x3: sample data not fresh; refresh mid-reconnect; reconnect that finds the Mac not answering never
  retried --> FIXED (32bc200c04)

#### Iteration 23 (sonnet)
- [WARNING] ContentView.swift: Keychain read on every redraw to pick the start tab --> FIXED (789fa4ffb3)
- [WARNING] BoardClient.swift: a cancelled pull counted as a failed read --> FIXED (789fa4ffb3)

#### Iteration 24 (opus)
- [WARNING] AgentsView.swift:36 list drawn from four switch branches, so a phase change reset the scroll and
  cancelled a pull --> FIXED (a4cc0002ee, shownList)
- [WARNING] .claude/plans/nativeagents-6838.md:80 said the red set mirrors needsPerson exactly --> FIXED (a4cc0002ee)

#### Iteration 25 (sonnet)
No BLOCKER, WARNING or CONVENTION. Converged.

### Final Ledger

| # | File | Severity | Iteration | Status |
|---|------|----------|-----------|--------|
| 1 | BoardClient.swift | BLOCKER | 19 | FIXED |
| 2 | AgentsView.swift (scroll) | WARNING | 24 | FIXED |
| 3 | plan wording | WARNING | 24 | FIXED |
| 4 | ContentView.swift start tab | WARNING | 23 | FIXED |
| 5 | BoardClient.swift cancelled pull | WARNING | 23 | FIXED |
| 6 | iterations 18 to 22 warnings (26) | WARNING | 18-22 | FIXED |

### Outstanding questions
None.

### NITs (non-blocking, across all iterations)
- AgentsView.swift: UIImage decoded in the row body on each redraw; cache the decode (deferred, plan).
- BoardClient.swift: banner wording alternates during the 15 s retry behind a list.
- BoardClient.swift: a pull can clear a re-sort a reconnect asked for.
- PushNotificationManager.swift: sign-out while Agents is open clears the kept record, the running list stays
  until the next start.
- ios/README.md: the sample switch alone can land on the sign-in page on a fresh simulator.
- AgentsView.swift: the dot's ring straddles its edge (14pt drawn).
- BoardClient.swift parseMacs: a JSON boolean would read as a number for retired_at.
- Switching tabs during Allow restarts the handoff.
- LogicTests: no loop test for refreshNow while unreachable, a cancelled pull, or the 15 s retry.

### Strengths (across all iterations)
- The bearer session and handoff token never follow a redirect; cookies live in a private in-memory jar.
- The generation guard is checked after every await that writes state.
- Status words and needsPerson match engine/cardlabel.js and engine/status.js case by case.
- The loop runs on an injected environment and is driven by a fake Kosmos+ and Mac in the tests.
