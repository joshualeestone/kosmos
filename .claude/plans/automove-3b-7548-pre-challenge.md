---
pre_challenge: true
method: challenge-loop
branch: automove-3b-7548
diff_hash: fe040b99414d321cb19d7ec6e43a8f08825ea0223b7923febd4d6ba75206c5a9
validation: passed (detached-validate.sh, attempt 1, head 9c1f2d29f4: 25770 node tests, 0 fail, 0 cancelled; shell suite 4 shards all green; build ok; validation_rc=0 audit_rc=0)
subdir_audit: not run (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-30T14:46:45Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 blind rounds, models alternating (Sonnet, Opus). Round 9 was a whole-branch read with nothing settled and returned no BLOCKER.
**Converged:** Yes. Rounds 6 to 9 were whole-branch reads (the fleet rule's final-round shape). Round 9 followed a round-8 BLOCKER fix.
**BLOCKERs found and fixed:** round 7 (the orphan guard excused a renamed test seam under its old name; control: the old name is red), round 8 (Settings' stopped-login line could never show on live data because the route's moves carry no kind; the page check's fixture had invented one; control: the old page code is red at all four sizes).
**Deferred:** the WARNINGs past round 8 are on kosmos#7621 (the mover's real deps are never run by a test; Settings lags a person's move by one tick; two wordings; a moved idle agent may hold its target a day; a second agents walk per tick; a latent roster mismatch). None reaches a person while moves are off, and moves are off unless AGENT_WORKFORCE_AUTOMOVE=1.

### Per-Iteration Breakdown

#### Iteration 1 to 5
**Reviewer model:** sonnet, opus, sonnet, opus, sonnet
- Findings and fixes recorded in .claude/plans/automove-3b-7548.md, "Review rounds". No BLOCKER left open.

#### Iteration 6
**Reviewer model:** opus (whole branch, nothing settled)
- [WARNING] Settings said "would move" for moves the mover never makes (held targets, stopped login) --> FIXED (e7da291342)
- [WARNING] header contradicted the history after moves were switched off --> FIXED (e7da291342)
- [WARNING] the day-long stops lived only in memory and logged every tick --> FIXED (e7da291342: lines wait and are written first; reason logged once)
- [NIT] history out of time order; undrawable lines took slots; personMoved scope; switch-off comment --> FIXED (e7da291342)

#### Iteration 7
**Reviewer model:** sonnet (whole branch, nothing settled)
- [BLOCKER] engine.reachable.test.js excused resetPersonMissedForTests, a name no longer exported --> FIXED (c19233c97f; control: the old name is red)
- [WARNING] Settings said "will move" for agents the mover leaves alone --> FIXED (c19233c97f)
- [WARNING] movableFor non-strict changed behaviour --> NOT A DEFECT (commitmentsFree(null) is false, so the answer is unchanged)
- [WARNING] an unreadable move ending was recorded as partial --> FIXED (c19233c97f: unknown)
- [NIT] rebuild hold max; KEEP_LINES comment; released wording --> FIXED (c19233c97f)

#### Iteration 8
**Reviewer model:** opus (whole branch, nothing settled)
- [BLOCKER] the route's moves carry no kind, so the stopped-login line could never show; the fixture had invented one --> FIXED (9c1f2d29f4; control: old page code red at all four sizes)
- [WARNING] stopped wording could be false --> FIXED (9c1f2d29f4)
- [WARNING] the mover's real deps are never run by a test --> DEFERRED (#7621)
- [WARNING] Settings lags a person's move by one tick --> DEFERRED (#7621)
- [NIT] two false comments, the moved agent's message subject --> FIXED (9c1f2d29f4); held wording, partial tell --> DEFERRED (#7621)

#### Iteration 9
**Reviewer model:** sonnet (whole branch, nothing settled, the final read)
- No BLOCKER found.
- [WARNING] a moved idle agent may hold its target a day; wording while the mover waits; a second agents walk; a latent roster mismatch --> DEFERRED (#7621)

## Final Ledger
- BLOCKERs: 2 found, 2 fixed, 0 open.
- WARNINGs past round 8: on #7621.

### Evidence
- engine/automove-7548.test.js 48/48; with autobalance-7152, autobalance-sweep-7152 and engine.reachable: 108/108.
- Mutants, each red then restored green: flush off, keep() not queueing, history sort removed, the decision's clock, an unreadable ending as partial, the hold not taking the max, the page's kind read from the move only.
- docs/browser-checks/render-autobalance-7152.js: 156 PASS, chromium and webkit, 1100 and 390.
- Full suite on 9c1f2d29f4: passed (above).

Weakest premise: an agent at its prompt with a background shell job reads idle, and a move's restart kills the job. Two idle checks narrow it; they do not close it. That is why moves stay off unless switched on.
