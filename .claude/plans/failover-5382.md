# failover-5382: when a provider rate-limits an agent, its open work can move to an idle agent on another provider

kosmos#5382 (field feedback, beta day): one provider rate-limited, its agents stopped, and Kosmos did not move the work
to another provider the person had connected; moving it by hand cleared the stall at once. Design call on the card
(comment of 2026-10-06 08:3x). Point 2 of the card (one view across worlds) is split to #5393.

## What already exists
- A card reads `rate_limited` from the vendor's own limit line (Claude, Codex, Gemini CLI) or Antigravity's structured
  report (`quotaUntil`; the shared pool's `poolUntil`).
- The Assigner (engine/assigner.js) gives an idle agent the next unassigned task in its projects. A rate-limited agent
  is never idle, so it gets nothing new, but the parts it already holds stay with it until it resets.

## Change (this PR: engine and route, inert until switched on)
- `engine/assigner-setting.js`: a `failover` flag beside `on`, **off by default**; only a stored `true` is on.
  `setFailover`; `setOn` keeps it and `setFailover` keeps `on`.
- `engine/assigner.js` step: each tick it keeps `limitedSince` per agent reading rate_limited (dropped the tick it stops).
  An agent limited for `FAILOVER_MS` (15 min) is ripe, unless its known reset is within `RESET_SOON_MS` (10 min). With
  `failover` on, an idle agent (the Assigner's usual tests: idle card, commitments free, no open work, IDLE_MS) takes a
  ripe agent's open part in a project it belongs to, **only if it runs on a different provider** (`runner`). Stalled work
  comes before the backlog. Never moved: parts on hold, in paused projects, of built, closed or webhook tasks. The
  hourly caps are shared with ordinary assignments.
- `server.js` givePart: `from` makes the write `onlyIfWho: from` plus `failover`, and a pane line that reaches nobody
  hands the part BACK to `from`, not to nobody. The runner logs "(moved from X, rate-limited)".
  `/api/assigner-setting` GET returns `failover`; PUT takes `on` or `failover`, one per request, screen only as before.
- `engine/tasks.js` assignPart: a failover move is refused if the part was finished, or its task built, put on hold or
  its project paused, since it was picked.

## Not in this PR
- The Settings switch (web). Next PR, with design shots for Mona: until then the flag can only be set by the route's
  screen caller, so the behaviour is unreachable for a person.
- The one-press "Give its tasks to another agent" on a paused card.
- Telling the limited agent: its pane is rate-limited, so a line typed there is not read until it resets. The move is
  recorded in the task's conversation, and the agent's own list no longer shows the part.

## Rejected
- Switching the limited agent's provider: restarts it and, for Codex, Gemini and Grok, drops its conversation.
- On by default: a moved task bills the person's other provider account.
- Moving on the first rate_limited reading: a scraped limit is a warning (#966); 15 minutes lets a misread clear and
  waits out short per-minute limits.
- Same provider, other account: possible later; the reporter's ask was another provider.

## Weakest premise
That projects have members on more than one provider. If each agent is alone on its project, this never fires and the
remaining path is switching the agent's provider, which this PR does not do.

## Evidence
- `engine/assigner-failover-5382.test.js`, 9 tests on real cards (fleet fixture) and real tasks: moves to another
  provider with `from`; not with failover off (and a control with it on); not to the same provider; not before the period
  and the clock restarts when the card stops reading rate_limited; waits out a reset within 10 minutes (control: one
  further off moves); never a built, webhook or finished part; assignPart's failover refusals and a recorded move; the
  setting's defaults and independence.
- The reset test caught a real bug on its first run: `Math.max` over a missing reset is NaN, which read as no reset
  known. Fixed.
- Mutations, each red: same-provider check removed; setting gate removed; assignPart's finished-part refusal removed;
  failover period removed (this one stayed GREEN on the first version of the test, because the receiver had not been
  idle long enough either; the test now starts the receiver's idle clock first); the limited clock never resetting.
- Neighbouring suites: assigner, assigner-setting, assigner-free-4552, server.recommender-assigner-2619, tasks: green.

## Not measured
- A real rate-limited agent on a live board (the tests use the fleet fixture's Claude limit line).
- `limitedSince` is not saved across a board restart, so a restart restarts the 15 minutes (the waiting direction).
