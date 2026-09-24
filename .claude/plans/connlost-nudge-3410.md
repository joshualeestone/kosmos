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

## Why a live retry is not nudged
PR 2a made the measured live retry line read WORKING. Any other retry row after the error ("Retrying
in <n>", including shapes RETRYING_LINES misses, such as a minutes countdown) supersedes the error in
connectionLostAtTail, so a pane that is retrying never reads connection_lost. The evidence is always
Claude Code's own column-0 "API Error:" row.

## Loop guard (review finding, fixed)
A nudge makes Claude Code retry, and the retry reads WORKING. So the history (nudges, escalation) is
kept while the agent is briefly not lost, and dropped only after 10 minutes not lost. Escalation is
sticky until then. A test interleaves lost, lost, working for 36 minutes (past the 30-minute window) and asserts exactly 3 nudges.

## Also fixed in review
- A person's input after the error supersedes it: a submitted prompt echo ("❯ text" above the input
  box). The nudge's own echo is one, so a person who presses Esc on the retry it started is not
  nudged again. Text in the input box
  itself (the last prompt row) does not count, since it is a draft or a placeholder.
- An unreadable roster (a failed snapshot) no longer prunes the book, so it cannot reset the loop guard.
- The server's per-tick gating is `makeTick` and is tested: live-execution gate, brake, no overlap.
- Claude Code breaking its own error text onto continuation rows is matched (error row + up to 4
  indented rows).

## Limits, stated rather than fixed
- **An error drawn indented** (for example under a tool's `⎿`) no longer counts: the card reads "Can't
  tell" rather than "Connection lost" for it. Every 2.1.281 capture draws the error at column 0; the
  trade is deliberate because the sweep now types into panes that read connection_lost.
- **A person half-way through typing** in the agent's prompt: the pane still reads connection_lost,
  and the nudge is pasted after their draft and submitted with it. The prompt row is in the captured
  text, but captured text cannot tell dim placeholder ("ghost") text from a real draft, so the sweep
  cannot safely tell a draft apart. Follow-up: capture with styling (capture-pane -e) and refuse to
  nudge when the input box holds non-dim text (fails safe: a missed nudge).
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
- **A nudge pasted but not submitted stays in the prompt**, and the pane still reads connection_lost,
  so the next nudge lands after it. The 3-nudge cap bounds this.
- **Cost:** each tick takes a full roster snapshot (one capture per agent), as the class-1 sweep does,
  so this adds a second fleet capture per minute.
- **The history lives in memory.** Only a board restart, or 10 minutes not lost, clears an escalation;
  the brake AGENT_WORKFORCE_CONNLOST_HEAL_OFF=1 stops the sweep but does not clear it.

## Weakest premise
(MEASURED, no longer an assumption) A delivered message into a wedged Claude Code pane makes it retry
and continue: a probe agent answered its original request after the API came back.
