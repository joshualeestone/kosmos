# agentnudge-4544: the Prompter nudges the stopped AGENT (kosmos#4544)

## Ask (Josh's Automation spec, 2026-09-29 07:51)
"Prompter / Checks on your agents / Automatically checks on your agents to ensure they continue working if they have
tasks to complete." On main the Prompter only shows the PERSON a check-in (engine/prompternudge.js); it never types to
the agent (#2623 removed that half, #3508 rebuilt only the person's).

## Decision (posted on the card 08:12)
- Runs inside the Prompter's tick (server.js heartbeatTick) after heartbeat.step, so it follows the Prompter's switch
  and interval. The person's check-in is unchanged. New pure module engine/agentnudge.js; delivery via chat.deliver.
  Gated on live execution and the brake AGENT_WORKFORCE_AGENT_NUDGE_OFF=1.
- Who: in this tick's toAsk (which already excludes needs_you, blocked, rate_limited); card idle, ours, not a paused
  swarm; holds an open part in a live project (openParts, the same rule as assigner.hasOpenWork, held to agreement by a
  test); no open part given within the last interval.
- How often: one nudge per stall episode; the book entry is dropped when the Prompter's record closes the episode.
  COULD_NOT is retried, at most 3 tries. While Agent Communication's limit is on, nudges board-wide are capped at its
  per-hour number in any hour.
- Rejected: typing into stopped/unknown/auth_failed/connection_lost cards (the agent cannot act on text there);
  charging a pair budget (a nudge has no agent pair); a separate timer (it would drift from the Prompter's interval).
- Weakest premise: idle is the only state worth typing into.

## Verified
- engine/agentnudge.test.js: 11 pass, real cards (test-support/fleet), real projects/tasks, toAsk from the real
  heartbeat.step.
- Mutations, each on the module in place with a byte-compared restore: once-per-stall, open-parts check, built rule,
  freshness, cap, idle card, episode release, MAX_TRIES, the hour window: every one fails a test. A first gate on
  assigner.hasOpenWork survived its mutation (openParts already decides), so it was removed rather than shipped.
- Control, measured on source: the Prompter tick in origin/main's server.js makes 0 deliver calls; on this branch 1
  (agentnudge.sweepOnce).
- Related suites green: heartbeat (18), prompternudge (10), assigner (32), web.prompter-nudges-3508 (7),
  engine.live-execution-1598 (3).
- Not measured: a real idle agent receiving the nudge and resuming (needs a live board; observe after the next release).
