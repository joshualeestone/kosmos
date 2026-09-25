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
- **Stop now:** `POST /api/agent/<name>/swarm/stop` pauses it "stopped", sends Escape (`chat.interrupt`) and the
  stop-all chord (`chat.stopHelpers`), both through `keysAllowed`; the answer says whether both were sent.
- **The daily limit:** a one-minute sweep (`swarm.sweepOnce`) pauses a swarm at its limit, interrupts it, stops its
  helpers, and says so in its own DM; a limit pause lifts at local midnight, a person's or Stop now's never does.
- **Per project:** `PUT /api/project/<id>/swarm/<name> { on }`; an Off swarm is skipped by room posts unless @-named,
  and a person's message or task line to it in that project is refused / not sent.

## Decided, and why
- **Helpers are subagents, not sessions** (the card: "built-in fan-out"). One voice holds by construction.
- **Paused enforced in chat.deliver**, not per caller: every path (DMs, rooms, tasks, sweeps) goes through it.
- **Tokens include cache reads**: one definition everywhere; the ratio answers the mock's weakest premise.
- **The count is reported, not enforced**: the lead is told N; the card shows activeHelpers > maxHelpers if it runs over.

## Weakest premises (not yet measured)
1. ~~That Escape ends BACKGROUND subagents.~~ MEASURED FALSE (2026-09-24, a throwaway Claude Code 2.1.282 pane): one
   Escape to an idle lead leaves a background helper running.
   MEASURED 2026-09-25 (throwaway 2.1.282 session, two helpers busy in a foreground command): Claude Code's
   "stop all agents" chord, ctrl+x ctrl+k pressed twice (the second press confirms), stops every background helper
   from the plain prompt (their processes went from 2 to 0), with no list navigation; with no helper running it leaves
   the prompt untouched. So Stop now and the limit sweep send that chord every time (`chat.stopHelpers`), with no
   count and no reading of the screen.
   ORDER, measured in fresh sessions the same night (helpers' processes before and after): chord alone 2 to 0;
   Escape then chord with no gap 2 to 2 (NOT stopped); Escape, 1s, chord 2 to 0 twice; Escape, 3s, chord 2 to 1;
   chord then Escape 2 to 0, and with the lead itself busy 3 to 0. So the chord goes FIRST, then the Escape.
   A stopped helper's file often ends with a "[Request interrupted by user" line, and the meter then counts it as
   finished at once. The line was not seen in every arm, so without it the card falls back to ACTIVE_WINDOW_MS,
   which errs toward "still working".
   Also measured the same night: ONE Escape on Claude Code's folder-trust question ENDS the session. Both keys
   therefore go through `keysAllowed` (deliver's trust-dialog floor, and no keys to a Windows agent).
   The residual: these are Claude Code's own keys and can change with it; the card's activeHelpers, read from the
   helpers' own files, is how anyone sees whether a stop held.
2. That the lead keeps to N when told.
3. A helper that parked its work in a background shell and ended its turn counts as finished while that shell runs
   (seen in the same measurement). The stop chord is sent regardless of the count, so this only affects the card.

4. The meter reads at most READ_PER_CALL_BYTES (64 MiB) of a transcript per call, so a larger one catches up
   over the next polls rather than stalling the board; until it does, today's tokens read low.

## Settings behaviour worth knowing
- Raising `dailyTokenLimit` on a swarm paused at its limit does not switch it back on; `active: true` does.
- Once the person switches a swarm paused at its limit TODAY back on, the limit is not enforced again that day
  (`limitOverrideDay`), even if they lower it. A limit pause left over from yesterday gives no such override.
- A paused swarm accepts only /compact, /clear, /cost, /context and /status; any other slash command is work.

## Verification
- `engine/swarm.test.js`, `engine/create.test.js` (#3564), `server.swarm-3564.test.js`, and the #3564 tests in
  `engine/messages.test.js` and `engine/assigner.test.js`. Every fix since review round 4 was mutated and went RED.
- The full suite (`tools/run-tests.sh`) passes.
