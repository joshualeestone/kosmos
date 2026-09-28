# firstreply-3226: a one-time nudge on an agent's first unanswered message

Card: joshualeestone/kosmos#3226 ("An agent's first reply is silently lost about 1 in 10 times").

## What
- `engine/firstreply-nudge.js`: a pure planner `plan(card, owes, entry, now)`, a `sweepOnce` over
  the roster, `nudgeEnabled` and `makeTick`, modelled on `engine/connlost-heal.js`.
- `server.js`: its own 60 s unref'd timer next to the connlost sweep, gated exactly like it
  (live execution only, so inert under `node --test`), operator brake
  `AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF=1`, interval test seam `AGENT_WORKFORCE_FIRSTREPLY_NUDGE_MS`.
- `engine/firstreply-nudge.test.js`: every planner branch, the sweep, the tick gate and the brake.

The nudge fires only when ALL hold: the card is `idle`; `messages.owesReply(sessionName).state`
is `owes`; `lastSentAt` is null (the agent has never sent anything, so first contact only); the
owed message (`lastHeardAt`) is at least 60 s old; and the in-memory book has no earlier nudge for
that session. It is typed through `chat.deliver` and tells the agent to answer with
`kosmos reply "<your answer>"` (the verb `install/kosmos` dispatches to `cmd_reply`).

## Why
The card's probe had turn 1 answering 7 of 8 and turn 2 answering 8 of 8 in the same live
session (62 of 71 first turns across 2026-09-17). The fault is concentrated on first contact, the
agent is capable, and a second turn is answered. So one reminder, once, on first contact, turns
the lost turn into a second turn, at the place where a lost reply costs most: a new user's first
interaction.

## The decided call
Option 2 from the needs-decision sweep (PigeonPete, on the card): a one-time Kosmos nudge on first
contact only. Option 1 (surface the missed reply) already ships as `dmOwesLine` ("Nothing back
yet." after 2 minutes). Josh can override.

## Rejected
- Waiting on a harness change (auto-relay the turn, or fail an unsent turn): it lives in Claude
  Code and nobody here can make it.
- More prompt wording: that is #185's rung, already shipped; the failing agent reproduces the
  command verbatim and narrates it, so it read the cue.
- Having Kosmos run the command the agent wrote as text: that would execute prose.

## Choices made in the build
- An UNCONFIRMED delivery counts as the spent nudge, not only PLACED: by the `chat.DELIVERY`
  contract the text may have reached the pane and re-sending may duplicate it. COULD_NOT (nothing
  reached the pane) or a throw records only a try, and the next sweep tries again; a refusing
  pane is logged once, not every minute.
- The book is never pruned: one nudge per session per board run is the whole budget. A board
  restart clears it, which can at most re-nudge an agent that still has never replied.
- The text says bare `kosmos reply`, matching the operator envelope (`messages.operatorDirect`)
  the agent was already shown, rather than the clipath form.

## Weakest premise
That the turn-2 success rate carries over to a nudge. A nudge is a second turn, but it is a
Kosmos reminder, not the person's own follow-up, and n=8 is small.
**What would change my mind:** a post-cut probe that shows no gain over roughly 87% first-contact
answers.

## Verification
Unit: `node --test engine/firstreply-nudge.test.js` (15 pass), with a mutant per planner
condition, the gate and the brake, each failing the suite.
Behaviour: needs-release. After the cut, re-run the first-contact probe
(`kosmos-scripts/turn1-vs-turn2.js`) and look for `firstreply-nudge:` lines in the board log; done
when first-contact answers rise above the ~87% baseline.
