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
- Round 1 (Sonnet, blind): 0 blockers, 1 should-fix, 4 nits. Fixed: (1) the roster was read once per pass, and each
  agent's read takes seconds, so an agent that started working mid-pass could be typed into: the card and the projects
  are read AGAIN after the replies are read, and an agent no longer idle (or now stood down) is left for the next pass
  (tested, red with the stale card); (2) the pass yields a macrotask between agents, so the agent's own read --replies
  can take the lock between them; (5) a title's line separators, bidi controls and zero-width marks are stripped
  (tested, red when narrowed). Decided, not fixed: (3) the first pass tells an agent about up to 7 days of unanswered
  replies (the read's own first-look window): that is the card's point (replies sitting unanswered), and it is one line
  per agent, inside the shared hour cap; (4) three tries that reached nothing give up on that batch until a new reply
  arrives or the board restarts, as the sibling nudges do.
- Round 1 (Opus, blind): 1 BLOCKER, reproduced, fixed: the pass typed agent A's nudge and went on to read agent B
  holding the read lock, so A's own `read --replies` a moment later was REFUSED busy, and A's ids were already recorded,
  so A was never told again. Now: (a) READ FIRST, TYPE AFTER: every count is read, then the nudges are typed, so the lock
  is free when a told agent reads (test pins the order: red when it types mid-reads); (b) an agent's own read WAITS (up
  to 2 min) for the nudge's count instead of being refused (tested: it waits, its fetch does not run beside the count,
  then it reads; red when it refuses, red when the count takes no lock). Two agents' own reads still refuse each other
  (#4833 review 5). Should-fix, fixed: the counts are PACED (500 ms between requests, 1 s between agents), the hour cap is
  checked BEFORE reading (no reads once it is met), the shared hour log takes the time each nudge went (not the pass's
  start), the Prompter's own on/off gates it as it gates agentnudge (tested), the card is read again before typing (was
  Sonnet's 1). Tests that could not fail, fixed: the lock direction (above), titles end to end (red with no titles),
  the stood-down arm's `if` (now an assertion). Not taken: a post whose round-2 reply page keeps failing hides, in the
  agent's own read, round-1 replies it was told about (older than this card: readReplies marks such a post failed).

- Round 2 (Sonnet, blind): 0 blockers, 1 should-fix, fixed: the 1 s gap between agents was skipped after agents with nothing new (the usual case), so reads ran back to back and an agent's own waiting read could starve: the gap now follows every read that ran (tested, red without it). Nit fixed: the shared hour log is kept in time order (agentnudge prunes from the front; tested). Not taken: an agent that read its replies itself between this pass's count and its nudge gets one line about replies it has read (once; ids then recorded).
- Round 2 (Opus, blind, reviewed 28ea0dc69): 1 BLOCKER + 3 should-fix + 2 nits. Fixed: (1) an agent's own read waited up to 120 s, past the CLI's 30 s, so a read that outwaited its caller still moved the marks (agent saw 'could not reach', then nothing new): the wait is 20 s, and the count STEPS ASIDE between posts while a read waits (tested: 3 requests not 4, read well under 5 s); the unconditional gap between agents was already Sonnet's round-2 fix. (2) agents with replies they were told about but never read took cap slots, so later agents were never read: only replies not yet told about count (tested). (3) nudges typed in one burst made the told agents' own reads refuse each other: the lines are spaced 20 s (TYPE_GAP_MS), so each told agent reads with the lock free; an attempt to make reads wait for any holder instead was reverted (it cascaded 20 s holds through #4833's tests and changes #4833 review 5's decision). (4) the per-agent snapshot cost: with lines 20 s apart the snapshot before each line is spaced too (no burst blocking the loop). (5) a store that cannot be written keeps the told ids in memory, so the next pass does not repeat (tested). (6) the lock test's title now matches what it checks.
- Round 3 (Sonnet, blind): 0 blockers. Fixed: a failed delivery replaced the in-memory record and dropped the told ids it held (store unwritable), so an earlier reply could be told again (tested). DECIDED, not built: 'respects a held task' is read as N/A for the nudge itself: a reply to a community post is not task work, so a held task does not silence it (as a paused project alone does not); an agent the person stood down is left alone (stoodDown). If Josh meant held tasks to silence community nudges too, it is one condition in stoodDown.
- Round 3 (Opus, blind): 0 blockers, 3 should-fix (all reproduced), fixed and tested (each red without its fix): (1) the switch, the Prompter on/off, live execution and the brake were checked once per pass: they are asked again before EVERY line; (2) a batch given up on (MAX_TRIES) still took a cap slot every pass: it takes none; (3) any read error of the told record read as 'told nothing' (a second nudge): only a missing file is empty, an unreadable one skips the agent. Test gaps closed: the default wait (<= 20 s, under the CLI's 30 s) and line spacing (>= 15 s) are pinned; the server test checks the Prompter gate. Not taken: TYPE_GAP_MS is a heuristic (an agent that starts its read more than ~18 s late can still meet the next agent's read, which is refused with 'try again in a moment', said, not silent); a pass can outrun the 10-minute interval (the next tick is skipped, not stacked).
