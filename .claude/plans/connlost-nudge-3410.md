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

## Also fixed in review
- An unreadable roster (a failed snapshot) no longer prunes the book, so it cannot reset the loop guard.
- The server's per-tick gating is `makeTick` and is tested: live-execution gate, brake, no overlap.
- Claude Code breaking its own error text onto continuation rows is matched (error row + up to 2
  indented rows).

## Limits, stated rather than fixed
- **A person half-way through typing** in the agent's prompt: the pane still reads connection_lost,
  and the nudge is pasted after their draft and submitted with it. A roster card does not carry the
  prompt row, so the sweep cannot see a draft today. Follow-up: expose whether the prompt row is empty
  or a known placeholder ("❯ Try \"…\"") and refuse to nudge otherwise (fails safe: a missed nudge).
- **The probe dials api.anthropic.com:443 directly.** It ignores the agent's ANTHROPIC_BASE_URL and
  any HTTPS_PROXY: behind a proxy that blocks direct TCP it never nudges, and with a custom endpoint
  down but the public host up it nudges in vain (the loop guard then escalates).
- **Race:** the roster is read before the probe (up to 3 s), and chat.deliver re-checks that the pane
  is an agent but not its state, so input typed in that window can be overtaken.
- **A nudge that could not be delivered still counts** toward the 3 (chat.deliver's COULD_NOT, for
  example the pane in copy mode). Deliberate: otherwise a pane that keeps refusing would be retried
  every two sweeps forever. Three failed deliveries escalate an agent that was never typed into.
- **A second outage within 10 minutes of an escalation gets no new budget.** Escalation stays until
  10 minutes of not being lost; a fresh loss inside that window stays escalated (the card is red for
  a person) rather than being nudged again.
- **The history lives in memory.** Only a board restart, or 10 minutes not lost, clears an escalation;
  the brake AGENT_WORKFORCE_CONNLOST_HEAL_OFF=1 stops the sweep but does not clear it.

## Weakest premise
(MEASURED, no longer an assumption) A delivered message into a wedged Claude Code pane makes it retry
and continue: a probe agent answered its original request after the API came back.
