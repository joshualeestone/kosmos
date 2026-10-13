# goalaskgaveup-6072: the Assigner's goal-ask give-up is kept and shown per project (#6072, slice 1)

Card: joshualeestone/kosmos#6072. Measured first (card comment 6151287153): `MAX_ASK_FAILS` bounds Phase 3 GOAL asks
(a live project with no open task; an idle member asked to draft tasks), and a "fail" is an ask that reached nobody
(could_not, or a throw). It never concerns an open task, and a refused task give is never counted (0 on this board's
log since 09-28). It does happen: 3 could_not to Echo about Feedback and Community on 10-10, 17:21 to 19:21Z, then
nothing for the day, and nothing said.

## The call (slice 1: record and wire)
- engine/assigner.js: memory gains `askGaveUp` (project -> { at, tries, agent, because }), set at the give-up branch,
  cleared when a later ask for that project lands, carried by step(), saved and restored (validated: a future time,
  one a whole GOAL_ASK_MS old, an unknown reason, a bad count or an over-long name is dropped).
- `goalAskGaveUp(mem, project, now)`: the record while it stands, null once the project has open work by the same
  rule that switches the goal ask off (blocksGoalAsk), or the day is over.
- server.js: GET /api/projects carries `goalAskGaveUp` on every project (null when none, or when the Assigner never
  ran), read from ASSIGNER_VIEW, which the Assigner sweep sets at load and every tick. Never a 500.

## Review 1
- The record outlived its reason: now null for an archived or paused project and for an agent no longer on the project
  (matched on its session, which the record now carries), and step() prunes entries for projects no longer live or
  paused, and expired ones. The newest give-up is re-inserted so MEMORY_CAP keeps it. savedForm's Infinity is said.
- That pruning made the landed-ask test pass without the clear (its re-ask was a day later, when pruning also removes
  it). The test now re-asks within the day, so only the clear can remove it; dropping the clear reds it again.
- Not covered: a goal removed from BRIEF.md (step reads goals only for asked candidates, so it cannot tell "no goal"
  from "not read this tick"). It clears at the latest when the day ends.

## Slice 2 (not this branch)
The words on the page. Not the Issue pill (Issue is an agent needing the person, #4730), and not the project tile
(its layout is Josh's #747/#748, and #4730 removed a status line from it), so the project's own page, with design shots. Review 1: only GET /api/projects carries the field; slice 2 must
confirm the page reads it from there, or carry it on that page's own route.

## Rejected
- A per-agent needs-you on the asked agent (slice B's record): its card already shows it could not be typed into.
- Counting refused gives: measured 0, nothing to surface.

## Proven
- engine/assigner.test.js: MAX_ASK_FAILS undelivered asks leave a give-up naming the agent (control: one fewer leaves
  none); a landed ask clears it; open work hides it (control: closing the task shows it again); a day old or future
  reads null; a save and restore round-trips it, and 6 malformed or stale entries are dropped.
- server.goalaskgaveup-6072.test.js: the stalled project carries the record, another carries null, open work hides it,
  and with no Assigner memory every project carries null with a 200.
- Mutations (each restored): no record, no clear on a landed ask, no open-work check, the route not wrapping, no
  restore, no archived/paused check, no member check, no step prune: each reds the tests aimed at it.
- Siblings: assigner-failover-5382 and 7 /api/projects server tests pass (284).

## Weakest premise
One occurrence on one board; and slice 1 alone changes nothing a person sees.
