# #6209: stale states nobody is prompted about (part 1: a blocked status that outlives a brief provider error)

## Finished looks like
An agent whose provider failed one turn (Claude Code's StopFailure hook writes an automatic `blocked` on "provider api
(...)") and whose NEXT turn ends normally (the Stop hook's automatic `idle`) reads idle on the board again, instead of
blocked for days. An agent's own deliberate `blocked`, and every other protected wait, stays exactly as protected as now.

## Measured (origin/main b9c082695)
- engine/kosmos-report-hook.js: StopFailure writes `{ state: 'blocked', on: 'provider api (<kind>)', owner: 'provider' }`
  with auto; Stop writes auto `idle` ("finished responding"); PreToolUse writes auto `working` as a heartbeat.
- engine/selfreport.js record(): an automatic idle/working may not erase a standing blocked/needs_you unless it is an
  auto permission wait (#900, #1949, #2456). #2456 kept an AUTO blocked protected "because it does not auto-resolve",
  pinned by "#2456: an automatic idle does NOT clear a standing AUTO blocked either".
- engine/stalereport-nudge.js (#5959): reminds once, after a day, only for a blocked NOT written by Kosmos and only for a
  Claude agent. An automatic provider blocked is never reminded, and never cleared by the agent's later normal turns.
  That is the six days in the report.

## Decided
- An automatic `idle` (a turn that ended normally) clears a standing AUTOMATIC provider blocked (by auto, on "provider api
  (...)"). A turn that ends normally proves the provider answered a whole turn after the failure.
- An automatic `working` (PreToolUse heartbeat, mid-turn) still does not clear it: the turn could still fail.
- Untouched: a deliberate blocked or needs_you (by agent or operator) standing on the card, a legacy unmarked line, and
  the quota hold (a
  rate_limit report with `until` is held by its own rules; a later normal turn end after the reset is the same proof).
- Parts 2 (overdue summary prompt) and 3 (task on hold while work goes on elsewhere) are separate slices on this card.

## Weakest premise
That Claude Code fires StopFailure INSTEAD of Stop for a failed turn (from its hook documentation, as #5805 records; not
measured on a live agent). If both fired for one failed turn, the block would clear at once: still visible in the
activity log, but no longer red.

## Review 1 (opus), and what changed
- BLOCKER, fixed: an incoming automatic blocked may overwrite a deliberate wait (left unguarded on purpose), so clearing
  the block would have erased the agent's question too and read idle. The clear now looks at the line the block
  replaced (lineUnderProviderBlock, from the record's tail) and is refused when that is a deliberate or unmarked
  blocked/needs_you; an automatic permission wait under it does not stop the clear. Tested both ways (switching the
  check off fails the question test, measured); a legacy unmarked provider block is tested too.
- Comments fixed: the #2456 block in selfreport.js, the hook's own doc (engine/kosmos-report-hook.js) and
  install/kosmos-report-hook.sh no longer say an auto idle never clears an auto blocked.
- Known, added to the weakest premise: the hook sends reports in the background, so turn N's late Stop idle could in
  principle land after turn N+1's StopFailure and clear a fresh block (it needs a new prompt plus an immediate failure
  inside one report's latency). The next failed turn writes the block again.
