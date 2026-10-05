---
pre_challenge: true
method: challenge-loop
branch: firstpost2-5285
diff_hash: bb2db88420b112fff020e5e96d10e3a48f40b2a8d6300a5c18d5bceafdf6c464
validation: passed locally: the 9 federation test files (engine/fedseats, fedseal, federation, fedmembers, federation-owncode-4649, server.fedmembers-4649, server.federation-3311, server.fedmsg-3311, engine.reachable) 322/322 on this branch at 12:49 CDT, off-queue by Splinter's 12:46 call (no browser; every server test binds port 0). engine/fedseats.test.js 187/187 on the pre-cherry-pick branch. Mortals FULL on this exact head before merge.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T17:49:15Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

Built on main + #5253 (a local merge) because both touch engine/fedseats.js; cherry-picked onto main once #5253 merged
(7 commits, clean), plan renamed for this branch. Reviews ran on the pre-cherry-pick commits; the cherry-pick changed
no code.

**Iterations:** 7 blind reviewers, read only (Opus 1, 3, 4; Sonnet 2, 5, 6, 7). **Converged:** round 7, 0 BLOCKER, 0 WARNING.
**Disclosed:** round 1 found my first version could still release a post with the false "nobody joined" in a race;
round 2 found a 10 s window that refused posts outright (the same bug class); round 5 found the quiet hold left the
person no line in an outage; round 6 found the once-flag I added for that had its own stuck exit. Each fixed; the design
was settled once at round 3 (one rule for every exit) rather than per finding.

### Round summaries
- 1 (Opus): BLOCKER stale "waiting" answer releases a post --> FIXED (release only by an answer asked after the hold)
- 2 (Sonnet): WARNING instant refusal inside the window; WARNING post held while a check is out waits 60 s --> FIXED (schedule, follow-up)
- 3 (Opus): WARNINGs lone post after "did not ask", wall-clock ordering, sharedEdges per-room cost --> FIXED (monotonic order, follow-up on every unusable answer, signed-out release); per-room cost ACCEPTED and stated
- 4 (Opus): WARNINGs failed answer ('reconnecting') not followed up; two lines per outcome; stale #5191 comment --> FIXED (quiet hold, one line)
- 5 (Sonnet): WARNING outage silent for the hour --> FIXED (one held note)
- 6 (Sonnet): WARNINGs once-flag stuck; note over-promised --> FIXED (per-post mark; "held until Kosmos+ can be reached to say whether anyone has joined")
- 7 (Sonnet): 0 BLOCKER, 0 WARNING; NITs (multi-post note untested; mark is on the outbox entry) DEFERRED

### Guards and their killing mutants (scratch copy)
hold instead of refuse; freshness (mono); notBefore; connect clears joinWait; window cap; window and follow-up; askedAt; held-only scheduling; reconnecting follow-up and its guard; quiet hold; outage note, its mark and its filter. Reasoned, not measured: the 60 s pass's own "did not ask" guard (the race cannot be ordered deterministically here; stated in the plan).
