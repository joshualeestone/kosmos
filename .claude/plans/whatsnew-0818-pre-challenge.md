---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0818
diff_hash: b1d7340adac99fc41e42ac7c56b053273c84a6b503c864779d611a3290e39053
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T18:51:35Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: its one WARNING was read against the code and deferred; nothing else new)
**Total findings:** 4 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs)
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0

Process notes, stated so nobody reads more into this than happened:
- 6.0's initial validation was started beside the iteration 1 review, not before it, and was stopped
  unfinished when finding 1 arrived. Validation was then stopped twice more when copy changes landed
  (no edits under a running validation). The only validation that ran to the end is the one on the
  final HEAD b9eff8d3ee (hash b1d7340adac9, matching diff_hash): 30,725 node tests, 30,141 pass,
  0 fail, 0 cancelled, the 4 test:shell shards, rc 0; subdir audit rc 0. That run is also 6j's gate.
- Finding 1 came from a colleague's read (Renet Tilley, m6199), not from the iteration 1 reviewer,
  which reported nothing. It is in the ledger as iteration 1 because it arrived during it.
- The first iteration 3 review was stopped before it reported, because the copy owner's wording
  changed the line under review; iteration 3 below is the re-run on the final text.
- Copy commits from the owner's read (bc372fae3c, b9eff8d3ee) are loop commits and are in
  ITER_COMMITS.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (from Renet Tilley, see above), 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] release/whats-new-pool.json (company line) - "lists what it reports and never sends" is false for every member who joined before #8942 (acceptedNever returns [] for them) --> FIXED (bc372fae3c, Mona Lisa's wording)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the company line was last written by bc372fae3c; it is user copy, not a code comment, and was rewritten with the copy owner, who approved the result)
- [WARNING] release/whats-new-pool.json (company line) - "which AI providers are allowed" is shown only while a providers_allowed list is in force (server.js:13893) --> FIXED (534cf53262; final words Mona Lisa's, b9eff8d3ee)
- [WARNING] release/whats-new-pool.json (browser clean-up line) - servers left by 0.8.17 used the shared output folder and are never matched, so the old pile is not cleared --> FIXED (534cf53262, "From now on")
- [NIT] .claude/plans/whatsnew-0818.md - cite the darwin gate for the Mac-only claim (taken)
- [NIT] .claude/plans/whatsnew-0818.md - the real weakest premise is per-member scope, not platform (taken)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the line was last written by b9eff8d3ee)
- [WARNING] release/whats-new-pool.json (company line) - "what it reports there" shows as Reported: only while reporting --> DEFERRED: read web/index.html:58319. In every not-yet-reporting state the existing Settings sentence says what it reports ("once it has read this computer's identity", "cannot report to your company yet", "Your company asks it to report nothing", "once Kosmos has your company's current terms"), so the line is true for every member. Also the plan's named weakest premise.
- [NIT] plan's conditional provider clause matches server.js and web/index.html:36117 (no change)
- [NIT] browser line's mac tag matches engine/agent-browser-config.js:21 (no change)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json (company line) | BRANCH | "never sends" false for pre-#8942 members | FIXED | bc372fae3c |
| 2 | 2 | WARNING | release/whats-new-pool.json (company line) | SELF | provider note only with a list in force | FIXED | 534cf53262, b9eff8d3ee |
| 3 | 2 | WARNING | release/whats-new-pool.json (browser line) | BRANCH | 0.8.17 leftovers never matched | FIXED | 534cf53262 |
| 4 | 3 | WARNING | release/whats-new-pool.json (company line) | SELF | Reported: line only while reporting | DEFERRED | web/index.html:58319 covers every other state |

### NITs (non-blocking, across all iterations)
- [NIT] plan: cite the darwin gate (iteration 2, taken)
- [NIT] plan: weakest premise is per-member scope (iteration 2, taken)
- [NIT] plan: provider clause matches the code (iteration 3)
- [NIT] pool: browser line mac tag matches the code (iteration 3)

### Strengths (across all iterations)
- The committed web/whats-new.json is byte-identical to an offline build of the committed pool, the cut's #7617 check (all three iterations reproduced it)
- Platform tags match where the code acts; no em dash in any spelling in any changed file (iterations 2, 3)
- The plan names its weakest premise and the rejected alternative (iterations 1, 3)
