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

### Per-Iteration Breakdown

#### Iteration 1 (Opus): 1 BLOCKER
- [BLOCKER] a "waiting" answer asked before the hold (a shared pass request; an ensure that returned early) released the post with the false sentence --> FIXED (release only by an answer asked after the hold)
- [WARNING] sealed-room path untested --> FIXED (test: the post waits for the member's key and leaves only sealed)
- [WARNING] joinWait kept after a connect --> FIXED (a connect clears it)
- [WARNING] per-project edges request --> FIXED (shared sharedEdges with notBefore)

#### Iteration 2 (Sonnet): 0 BLOCKER, 2 WARNING
- [WARNING] a check that found nobody refused posts outright for 10 s (a member joining inside it lost the post) --> FIXED (hold and check at the window's end)
- [WARNING] a post held while a check was out waited for the 60 s pass --> FIXED (follow-up check)

#### Iteration 3 (Opus): 0 BLOCKER, 4 WARNING
- [WARNING] a lone post whose check did not ask fell back to the 60 s pass --> FIXED (follow-up on every unusable answer)
- [WARNING] wall-clock ordering lets a time sync release a post --> FIXED (process.hrtime)
- [WARNING] notBefore makes busy rooms each ask --> ACCEPTED and stated (bounded per room, only while a post waits)
- [WARNING] stale comment --> FIXED

#### Iteration 4 (Opus): 0 BLOCKER, 4 WARNING
- [WARNING] a failed answer ('reconnecting') got no follow-up --> FIXED
- [WARNING] two room lines per outcome (a "held" promise, then "nobody joined") --> FIXED (quiet hold, one line)
- [WARNING] #5191's comment no longer true --> FIXED
- [WARNING] a check out when its seat stops untested --> FIXED (test)

#### Iteration 5 (Sonnet): 0 BLOCKER, 3 WARNING
- [WARNING] the quiet hold left the person no line during an outage --> FIXED (one held note)
- [WARNING] outage request bound unstated --> FIXED (stated in the comment)
- [WARNING] the stop test passes for another reason --> NO CHANGE (it pins the stop behaviour it names)

#### Iteration 6 (Sonnet): 0 BLOCKER, 3 WARNING
- [WARNING] the seat-level once-flag stuck when a post aged out --> FIXED (per-post mark)
- [WARNING] "sent once they are connected" over-promised --> FIXED (new wording)
- [WARNING] resets untested --> FIXED (no reset needed with the per-post mark)

#### Iteration 7 (Sonnet): 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT
- [NIT] multi-post outage note untested --> DEFERRED
- [NIT] the mark lives on the outbox entry, lost on a re-hold (unreachable today) --> DEFERRED
- [NIT] "once per post", not "once per outage" --> DEFERRED (intended)
- [STRENGTH] the outage sentence is true in every outcome; a post written during the outage is refused with an honest line

### Guards and their killing mutants (scratch copy)
hold instead of refuse; freshness (mono); notBefore; connect clears joinWait; window cap; window and follow-up; askedAt; held-only scheduling; reconnecting follow-up and its guard; quiet hold; outage note, its mark and its filter. Reasoned, not measured: the 60 s pass's own "did not ask" guard (the race cannot be ordered deterministically here; stated in the plan).
