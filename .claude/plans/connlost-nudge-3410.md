# Plan: #3410 PR 2b, a network-wedged agent recovers by itself when the connection is back

## Finished looks like
An agent whose Claude Code gave up on a network error ("⏺ API Error: …" at its prompt) is nudged
to retry, with its context intact, once the network is reachable again, without a person opening a
terminal. An agent that is still retrying, or that has already recovered, is never nudged.

## Decision: nudge, do not restart
Josh's ask (card): "AUTO-RECONNECT / retry the agent when connectivity returns". A wedged pane sits
at its prompt; a delivered message makes Claude Code send a new request and continue the task with
its context. `removal.restart` kills the session and relaunches it, losing in-flight context.
Rejected: restart (context loss), raw send-keys (chat.deliver is the sanctioned typing path, used
by the Recommender sweep and server.js).

## Change
1. `engine/status.js`: `connection_lost` only while the matched error line is the live tail (after
   it only footer, prompt and status-bar chrome). Newer content after it means the agent recovered and
   the line is stale, so the rule does not fire. This fixes the documented stale read (a recovered
   agent's short turn kept reading connection_lost because that rule sits above the idle footer rule).
2. `engine/connlost-heal.js`: pure planner + injected executor + in-memory loop guard, the shape of
   class1-autohandle.js. 'nudge' only when the reconciled state is connection_lost on >= 2 consecutive
   sweeps with the SAME evidence line AND a connectivity probe succeeds; 'wait' otherwise; 'escalate'
   (log only, leave the card red) after 3 nudges in 30 minutes.
3. `server.js`: a 60 s sweep beside the class-1 one, inert under test (live-execution gate), operator
   brake `AGENT_WORKFORCE_CONNLOST_HEAL_OFF=1`, `safeRoster()`, `chat.deliver`.

## Why a live retry is not nudged (an assumption, not a guarantee)
PR 2a made the live retry line read WORKING. A retry shape still unmeasured (a `*` frame) would read
connection_lost with the retry line itself as evidence, whose seconds countdown changes each sweep, so
"same evidence on 2 consecutive sweeps" rejects it. A MINUTES-only countdown ("Retrying in 4m") could
repeat identically across two sweeps a minute apart and be nudged mid-retry. Unmeasured, low odds.

## Loop guard (review finding, fixed)
A nudge makes Claude Code retry, and the retry reads WORKING. So the history (nudges, escalation) is
kept while the agent is briefly not lost, and dropped only after 10 minutes not lost. Escalation is
sticky until then. A test interleaves lost, lost, working for an hour and asserts exactly 3 nudges.

## Limits, stated rather than fixed
- **A person half-way through typing** in the agent's prompt: the pane still reads connection_lost,
  and the nudge is pasted after their draft and submitted with it. A draft cannot be told from
  Claude Code's placeholder text without terminal styling, which the capture does not keep.
- **The probe dials api.anthropic.com:443 directly.** It ignores the agent's ANTHROPIC_BASE_URL and
  any HTTPS_PROXY: behind a proxy that blocks direct TCP it never nudges, and with a custom endpoint
  down but the public host up it nudges in vain (the loop guard then escalates).
- **Race:** the roster is read before the probe (up to 3 s), and chat.deliver re-checks that the pane
  is an agent but not its state, so input typed in that window can be overtaken.

## Weakest premise
(MEASURED, no longer an assumption) A delivered message into a wedged Claude Code pane makes it retry
and continue: a probe agent answered its original request after the API came back.
