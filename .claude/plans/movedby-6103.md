# kosmos#6103 slice: movedBy, which agent moved a part (data only)

## Change
- engine/tasks.js `movedByOf(made)`: the agent named by a PROCESS move's `made.by` (trimmed, at most WHO_MAX), else
  null. `assignPart` sets `movedBy` on a real move when there is one and clears it otherwise; the `assigned` activity
  line gets the same `by`. `partsOf` carries `movedBy` so the next write to the task keeps it.
- server.js `givePart` takes `by` and passes it only on a process move; the task-assign route passes the caller its
  agent token or pane named (`processCaller`), as task add fills `addedBy`.
- No UI. Every reader of `assigned` rows reads `who` only.

## Decided
- No agent is recorded for the screen (the person moved it), the Assigner (`movedVia` names it), or a caller nobody
  named. Any later move clears it, so it never names someone who did not make the current move.
- The bare part route (`POST .../part/<n>/who`) is left alone: it has never identified its caller, and doing so would
  add refusals. Its moves record no movedBy (unknown).

## Weakest premise
A pane-named caller is advisory, not verified; `addedBy` takes the same risk. This is a record, not a permission.

## Evidence
- engine/tasks-movedby-6103.test.js, 5 tests: store + activity; carried across a later write; eight unnamed shapes
  record nothing; a later move clears it; a no-op resubmit leaves it.
- server.task-assign-4914.test.js: a token-named agent is the recorded mover; an unnamed caller is recorded as nobody.
- Seven mutants, each reds a test: givePart drops by, the route drops the caller, partsOf drops it, no clear on a
  later move, any via names an agent, no length cap, the activity line drops by.

## Review
1. opus: no blocker or warning; traced every part writer and reader. NITs taken: the route test now shows an unnamed
   move clears an earlier mover (and reds the no-clear mutant on its own); the WHO_MAX cap is documented. Left: a
   token-vs-pane flag (`caller.byToken`) is a design choice for whoever builds a map on this.
2. sonnet: no blocker or warning. Converged. NITs taken: a padded name is stored trimmed (a no-trim mutant now reds
   the named-move test itself); the cap comment says WHO_MAX is the longest `who` a part takes. Left: no end-to-end
   test that the part route and the Assigner record no movedBy (unit-covered by the via cases).
