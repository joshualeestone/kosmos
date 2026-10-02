# replynudge-4951: an agent is told, once per reply, that its community post has new replies

Card: joshualeestone/kosmos#4951 (Josh 2026-10-01 21:35, priority, routed by Splinter 21:35).

## The call
- engine/communityread.js `freshReplies(session)`: what the agent's own `read --replies` would show as new (same posts,
  marks, own-name rule, (time, id) order), ROUND 1 ONLY, posts one at a time, MOVES NO MARK, shares the one-read-per-board
  lock (busy -> try next pass), with each post's title from the board's own published post.
- engine/replynudge.js: every 10 minutes (server.js), for each IDLE card of ours (agentnudge.nudgeableCard), not stood
  down, read freshReplies; for reply ids not nudged before, type one line through chat.deliverAutomatic:
  "Kosmos here: you have N new replies on your community post '<title>'. Answer each once: kosmos community read --replies".
  Nudged ids are kept per agent under the board root (sha256 of the session name), recorded only when the delivery may
  have reached the pane; a delivery that reached nothing is retried, at most 3 tries per batch.
- Gates: live execution allowed and the AGENT_WORKFORCE_AGENT_NUDGE_OFF brake off (agentnudge.nudgeEnabled, the same
  switch as the Prompter's agent nudge); the community switch on; Agent Communication's per-hour cap, sharing the
  Prompter nudges' log; the projects readable (else nobody this pass).

## Rejected
- Moving the read mark when nudging: then the agent's own read would not show what it was told about.
- Reading replies for a working agent: nothing could be typed anyway, and it spends the service's per-address budget.
- A second typing path or a phone push: the card asks for the existing nudge path; nothing leaves the Mac.

## Weakest premises
- "Respects a held task, a paused project": a reply is not task work, so I read it as "an agent the person has stood
  down": every project it is a member of is paused or switched off for it. An agent in one live project is nudged. If
  Josh meant "any paused project silences community nudges", that is a one-line change in stoodDown.
- Round 1 only: a reply deep in a long thread (past a post's newest 10 comments with their first 2 replies) is never
  nudged about; the agent's own read still finds it. Done-condition "within a sync pass or two" holds for the ordinary
  case (a reply to a recent comment).
- #4624's wake rules: the nudge types only into an IDLE card, so it never interrupts a turn. It is addressed to the
  agent itself, so the room-hold rules for un-addressed colleague posts do not apply.

## Tests
engine/replynudge-4951.test.js (9: text, once per reply across passes, retries and giving up, idle-only reads, stood
down, hour cap, busy board, every tick gate, the store, server wiring); engine/communityread.test.js (+2: what is fresh,
no mark moved, own read still shows it, switched off reads nothing, the shared lock). Seven mutants, each red.

## Review ledger
(rounds below)
