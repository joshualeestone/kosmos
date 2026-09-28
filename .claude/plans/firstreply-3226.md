# firstreply-3226: a one-time nudge on an agent's first unanswered message

Card: joshualeestone/kosmos#3226 ("An agent's first reply is silently lost about 1 in 10 times").

## What
- `engine/firstreply-nudge.js`: `firstContact(thread)` over the agent's chat DIRECT thread, a pure
  planner `plan(card, fc, entry, now)`, a `sweepOnce` over the roster (reading the thread through
  `directThread`, i.e. `chat.readThread(chat.DIRECT, sessionName)`), `nudgeEnabled` and `makeTick`,
  modelled on `engine/connlost-heal.js`.
- `server.js`: its own 60 s unref'd timer next to the connlost sweep, gated exactly like it
  (live execution only, so inert under `node --test`), operator brake
  `AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF=1`, interval test seam `AGENT_WORKFORCE_FIRSTREPLY_NUDGE_MS`.
- `engine/firstreply-nudge.test.js`: every planner branch, the sweep, the try cap, the tick gate and
  the brake, plus integration tests on the REAL chat store in a sandboxed data root.

The nudge fires only when ALL hold: the card is `idle`; the agent's DIRECT thread with the person
holds NO row from the agent (no row with a string `from`; keepAgentReply writes `from: who`), so
first contact only; the thread's latest row is the person's own message (no `from`), not a
numbered-menu answer (`wire` null), and its `delivery.state` is `placed`; that row's `at` is at
least 60 s old; the in-memory book has no earlier nudge for that session; and fewer than 3 tries
have reached nothing.

### Why the DIRECT thread, not messages.owesReply (challenge-loop iteration 1)
The first build keyed on `messages.owesReply`. That log holds only agent-to-agent `kosmos msg` rows
and room posts. The person's DM is stored in the chat DIRECT thread (the DM route's
`chat.appendMessage(chat.DIRECT, name, ...)`), and the agent's `kosmos reply` lands in the same
thread (`keepAgentReply`). So the card's own case read `clear` and never fired, and an agent that
had answered its person many times but received a colleague's `kosmos msg` read `owes` with
`lastSentAt: null`, which would have typed false words into it. Both are pinned by integration
tests now. It is typed through `chat.deliver` and tells the agent to answer with
`kosmos reply "<your answer>"` (the verb `install/kosmos` dispatches to `cmd_reply`).

## Why
The card's probe had turn 1 answering 7 of 8 and turn 2 answering 8 of 8 in the same live
session (62 of 71 first turns across 2026-09-17). The fault is concentrated on first contact, the
agent is capable, and a second turn is answered. So one reminder, once, on first contact, turns
the lost turn into a second turn, at the place where a lost reply costs most: a new user's first
interaction.

## The decided call
Option 2 from the needs-decision sweep (PigeonPete, on the card): a one-time Kosmos nudge on first
contact only. Josh can override.

**Correction, measured 2026-09-28: option 1 does NOT already ship for this case.** An earlier
version of this plan said `dmOwesLine` ("Nothing back yet." after 2 minutes) covered it. It does
not. The thread route (server.js, `const owes = messageLog.owesReply(name)`) serves `owes` from the
message log, and `dmOwesLine` (web/index.html) returns '' unless `owes.state === 'owes'`. Measured
in a sandboxed data root: after `chat.appendMessage(chat.DIRECT, 'mara', <a placed person row 5
minutes old>)`, `messages.owesReply('mara')` returned `{state:'clear', lastHeardAt:null,
lastSentAt:null}`, and `dmOwesLine` extracted from web/index.html and called with that `owes` and
the row returned ''. Called with `{state:'owes'}` and the same row it returned the "Nothing back
yet." line. So the line shows only when a colleague's msg or a room post happens to put the agent
in the message log's debt, which is the same wrong source this build first used. Out of scope for
this branch; it wants its own card (the same DIRECT-thread derivation, `firstContact`-shaped but
without the first-contact-only condition).

## Rejected
- Waiting on a harness change (auto-relay the turn, or fail an unsent turn): it lives in Claude
  Code and nobody here can make it.
- More prompt wording: that is #185's rung, already shipped; the failing agent reproduces the
  command verbatim and narrates it, so it read the cue.
- Having Kosmos run the command the agent wrote as text: that would execute prose.

## Choices made in the build
- An UNCONFIRMED delivery counts as the spent nudge, not only PLACED: by the `chat.DELIVERY`
  contract the text may have reached the pane and re-sending may duplicate it. COULD_NOT (nothing
  reached the pane) or a throw records only a try, and the next sweep tries again, at most 3 tries
  per session per board run (connlost-heal caps the same way); a refusing pane is logged on the
  first try and when given up on, not every minute.
- ANY row with a string `from` counts as the agent having spoken, not only one equal to its
  sessionName: a row we cannot place is never read as silence, because that direction types false
  words into a pane.
- A numbered-menu answer as the latest row does not nudge: the nudge's words ("the person you work
  for sent you a message") would not describe it.
- The book is never pruned: one nudge per session per board run is the whole budget. A board
  restart clears it, which can at most re-nudge an agent that still has never replied.
- The text says bare `kosmos reply`, matching the operator envelope (`messages.operatorDirect`)
  the agent was already shown, rather than the clipath form.

## Residuals (known, not closed)
- A DIRECT thread file that is set aside as damaged (UNPARSEABLE repair) starts empty, so an agent
  that had answered before could read as first contact after the person's next message. Rare, and
  bounded to one nudge per session per board run.
- A thread trimmed to MAX_MESSAGES (1000) could drop the agent's only rows; that needs roughly a
  thousand unanswered person messages first.

## Weakest premise
That the turn-2 success rate carries over to a nudge. A nudge is a second turn, but it is a
Kosmos reminder, not the person's own follow-up, and n=8 is small.
**What would change my mind:** a post-cut probe that shows no gain over roughly 87% first-contact
answers.

## Verification
Unit and integration: `node --test engine/firstreply-nudge.test.js` (18 pass). Mutants, each run
and restored byte-identical: owes source reverted to `messageLog.owesReply` (7 fail, incl. both
real-store tests), no-agent-row check removed (3 fail, incl. the keepAgentReply control), try cap
removed (2 fail), placed check removed (1 fail), menu-answer check removed (1 fail), idle check
removed (1 fail).
Behaviour: needs-release. After the cut:
1. **Positive check first (absence of a log line proves nothing on its own):** on the served board
   with live execution on, create a fresh agent, send it one DM from its page, keep it from
   answering (for example stop it from running tools, or pick a moment it answers as plain text),
   wait over a minute with the card idle, and confirm a
   `firstreply-nudge: <name> (<session>) nudge delivery=placed` line in the board log and the
   reminder in its pane. Control: an agent that has answered with `kosmos reply` once, then gets a
   second unanswered DM, gets no such line.
2. Then re-run the first-contact probe (`kosmos-scripts/turn1-vs-turn2.js`); done when
   first-contact answers rise above the ~87% baseline.
