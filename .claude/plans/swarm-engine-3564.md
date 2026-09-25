# swarm-engine-3564: Agent Swarms, the engine side

Card: kosmos#3564. Josh approved Mona's mock 2026-09-24 12:13 ("go on the swarm stuff. it looks great"). Splinter's
split (22:26): engine is Renet's, UI is Mona's. Claude-only v1. The engine/UI contract is posted on #3564
(Renet, 22:33), with one change noted below (routes are `/api/agent/<name>/...`, singular, the repo's convention).

## What this branch does
- **The swarm type.** `createAgent({ kind: 'swarm', maxHelpers, dailyTokenLimit })`: Claude only, 2 to 10 helpers
  (default 3), a daily token limit required; refused before anything is written otherwise. The profile carries
  `kind: 'swarm'` and `swarm: { maxHelpers, dailyTokenLimit, active, pausedBecause, pausedAt }`.
- **The lead's block** (`kosmos:swarm` markers, registered): at most N helpers at once via the subagent tool, a
  worktree for any helper that edits files, one part per helper, the lead checks and merges, only the lead speaks, and
  a paused lead starts no helpers. Written at birth; rewritten by `tellLead` when the count changes.
- **The meter** (`engine/swarm.js`): today's tokens (input + output + cache writes + cache reads, since local midnight)
  for the lead's sessions in its transcript folder and every `<session>/subagents/agent-*.jsonl`; helpers working now =
  not ended with `end_turn` and written in the last 10 minutes; `helperTokenRatio` = (lead + helpers) / lead.
  Measured on this Mac: Claude Code writes subagent transcripts exactly there, with per-message usage.
- **The card:** every `/api/status` card gains `swarm` (null for an ordinary agent).
- **Settings:** `PUT /api/agent/<name>/swarm { maxHelpers?, dailyTokenLimit?, active? }`.
- **Paused is real:** `chat.deliver` refuses a paused swarm (every caller goes through it), except slash commands.
- **Stop now:** `POST /api/agent/<name>/swarm/stop` pauses it "stopped" and sends Escape through `chat.interrupt`,
  the same gate as deliver; the answer says whether the interrupt was confirmed.
- **The daily limit:** a one-minute sweep (`swarm.sweepOnce`) pauses a swarm at its limit, interrupts it, and says so
  in its own DM; a limit pause lifts at local midnight, a person's or Stop now's never does.
- **Per project:** `PUT /api/project/<id>/swarm/<name> { on }`; an Off swarm is skipped by room posts unless @-named,
  and a person's message or task line to it in that project is refused / not sent.

## Decided, and why
- **Helpers are subagents, not sessions** (the card: "built-in fan-out"). One voice holds by construction.
- **Paused enforced in chat.deliver**, not per caller: every path (DMs, rooms, tasks, sweeps) goes through it.
- **Tokens include cache reads**: one definition everywhere; the ratio answers the mock's weakest premise.
- **The count is reported, not enforced**: the lead is told N; the card shows activeHelpers > maxHelpers if it runs over.

## Weakest premises (not yet measured)
1. ~~That Escape ends BACKGROUND subagents.~~ MEASURED FALSE (2026-09-24, a throwaway Claude Code 2.1.282 pane): one
   Escape to an idle lead leaves a background helper running. Its agent manager stops it (`Down` opens the list, `Down`
   selects a helper, `x` stops it), so Stop now also sends that sequence for each working helper (`chat.stopHelpers`).
   It types `x` only while Claude Code shows a helper selected ("x to stop"), so a stale count sends no stray key.
   The residual: it drives Claude Code's own screen and can break when that screen changes. The card's activeHelpers
   lags a stop by up to ACTIVE_WINDOW_MS (10 minutes) in the "still working" direction: an interrupted helper never
   writes `end_turn`. Deliberate: counting only helpers written since the pause would err toward "stopped" while a
   background helper sits in a long tool call, and for a spending control the false "stopped" is the worse lie.
2. That the lead keeps to N when told.
3. The daily-limit sweep stops working helpers as Stop now does (one Escape does not reach background ones).

## Settings behaviour worth knowing
- Raising `dailyTokenLimit` on a swarm paused at its limit does not switch it back on; `active: true` does.
- Once the person switches a limit-paused swarm back on, the limit is not enforced again that day
  (`limitOverrideDay`), even if they lower it.
- A paused swarm accepts only /compact, /clear, /cost, /context and /status; any other slash command is work.

## Verification
- `engine/swarm.test.js`, `engine/create.test.js` (#3564), `server.swarm-3564.test.js`, and the #3564 tests in
  `engine/messages.test.js` and `engine/assigner.test.js`. Every fix since review round 4 was mutated and went RED.
- The full suite (`tools/run-tests.sh`) passes.
