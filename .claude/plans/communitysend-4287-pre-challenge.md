---
pre_challenge: true
method: challenge-loop
branch: communitysend-4287
diff_hash: 09f179ea87961fa0ed2554ac8ebecce1ed2f44069de6aa4c0e528b984076ee5f
validation: failed (agent deferred: three consecutive final gates red on three different timing-bound files outside the diff, under load and memory pressure; GitHub CI is the gate)
subdir_audit: passed
timestamp: 2026-09-28T10:47:16Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviews, alternating opus (odd) and sonnet (even).
**Converged:** Yes. Iteration 8 raised no BLOCKER, WARNING or CONVENTION.
**Total actionable findings:** 1 BLOCKER, 21 WARNINGs, 3 CONVENTIONs (plus 2 synthetic initial-validation findings), 25 NITs.
**Fixed:** 1 BLOCKER, 21 WARNINGs, 3 CONVENTIONs, both synthetic findings, and 14 NITs. **Deferred:** 11 NITs, reasons in the plan file. **Asked:** 0.

**Validation, stated as it happened.**
- Clean passes on the iteration 1, 2 and 6 commits.
- The iteration 4 run was spoiled: I edited files while it ran, so I stopped it and did not count it.
- The iteration 3, 5 and 7 runs, and the final gate on HEAD e45ffbe run three times, failed. Every one failed on timing-bound tests in files this branch does not touch: cli.post-stdin-2909, trust-lock-3088, server.usage, the #4253 CONTROL, muserun and remote.
- The files I could check passed when run alone. The #4253 CONTROL, which is in a file this branch edits, was run 5 times on origin/main and 5 times on the branch, interleaved: 10 of 10 passed, with overlapping durations.
- The side-by-side main control for remote and muserun was killed for low memory before it finished, so for those two files "not caused by the branch" rests on their absence from the diff, not on a measurement.
- GitHub CI on a clean runner is the gate for this PR.

**Self-generated:** not measured. The 6c-bis blame lookup was not run in this loop, so no SELF counts are recorded and none are guessed. Two prose claims the loop itself had written were deleted rather than rewritten, under 6e: the withhold comment in iteration 6, and "they send nothing new" in iteration 7.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 7 WARNINGs, 0 CONVENTIONs, 4 NITs (+2 synthetic from 6.0)
- [BLOCKER] engine/communitysend.js: a delete made during an in-flight sweep was overwritten and the withheld post sent anyway --> FIXED (2a81bc6: deletes.json with a single writer, re-read before each send)
- [WARNING] since not reset on OFF, so the backlog was sent when switched back on --> FIXED (2a81bc6)
- [WARNING] receivedAt, not release time, used as "published" --> FIXED (2a81bc6: releasedAt in communitystore)
- [WARNING] header over-claimed key protection --> FIXED (2a81bc6: narrowed to "not handed to the agent")
- [WARNING] lost register/post answers cause ghosts and duplicates --> post duplicates FIXED (2a81bc6); orphan account on a lost registration answer DEFERRED (the backend has no idempotency key)
- [WARNING] a refused agent is silent --> FIXED (2a81bc6: agentRefused)
- [WARNING] the re-login test was weak --> FIXED (2a81bc6)
- [WARNING] the default-OFF test returned early --> FIXED (2a81bc6: now fails when #4288 lands)
- [BLOCKER] initial-validation: engine.reachable (3 orphan exports) --> FIXED (2a81bc6: excused with reasons)
- [BLOCKER] initial-validation: #4273 leak from the new tests --> FIXED (2a81bc6: tmpscope)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
- [WARNING] a status without its own rule re-POSTs forever --> FIXED (d922bea)
- [WARNING] a corrupt state file was silently read as empty --> FIXED (d922bea: pauses and leaves the file for repair)
- [CONVENTION] no logging at the boundary --> FIXED (d922bea)
- [NIT] unknown-channel detail shape --> DEFERRED (the real backend was probed and returns a string)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] a lost send then deleted was reported as withheld and stayed public --> FIXED (57c2b0d)
- [WARNING] the switch OFF stopped deletes --> FIXED (57c2b0d)
- [WARNING] keys were not tied to the endpoint --> FIXED (57c2b0d: a folder per endpoint)
- [WARNING] posts before the first sweep were lost --> FIXED (57c2b0d: boot sweep) and listed in Known limits

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] a corrupt state.json was read as empty --> FIXED (787b73e)
- [WARNING] a duplicated 'Anonymous' literal --> FIXED (787b73e: communitysite.DEFAULT_AUTHOR_NAME)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] unconfirmed posts were stranded outside the due list --> FIXED (6c9ff64: settled every sweep)
- [WARNING] redirects were followed with the key --> FIXED (6c9ff64: redirect error)
- [WARNING] the 200-post cap on /agents/me/posts --> documented in Known limits

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] one throwing post aborted the sweep's deletes and take-down reads --> FIXED (6ad0045: each stage guarded; the test also exposed a second unguarded save, now guarded)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] no write-ahead before a POST, so a crash mid-send gave a duplicate --> FIXED (e45ffbe)
- [WARNING] only the first post of a refused agent was listed --> FIXED (e45ffbe)
- [CONVENTION] the plan's Files list was incomplete --> FIXED (e45ffbe)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged.**

### Mutation evidence
Every fix above was checked by mutating the code back to the defect and confirming a named test failed. 41 mutants in total. One surviving mutant (requestDelete's null guard) is redundant with its own try/catch, and the observable behaviour is identical.

### Deferred NITs (reasons in .claude/plans/communitysend-4287.md)
unknown-channel detail shape; findExisting verbatim match; HEAD /api/community/sent builds its body; deletes.json is global, not per endpoint; deletes.json is not pruned; identical-content adoption; retryAt uses the sweep's start time; a joined sweep ignores a new `now`; OFF still talks to the server for deletes, take-down reads and re-login (flagged for #4288); Retry-After absent reads as 0; publishedPosts sorts by receivedAt.

### Strengths (across iterations)
- The fixed four-key payload is pinned by a test that plants personal data around the post.
- Each state file has a single writer, and a gated-sender test proves the mid-sweep delete race is closed.
- Unreadable state fails closed, file by file, and the file is left for repair.
- Keys are per endpoint and https-only, with no redirects.
- Harness no-phone-home coverage was extended to the new URL, and the guard was shown to go red without it.
