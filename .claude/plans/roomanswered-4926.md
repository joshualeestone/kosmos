# roomanswered-4926: answered room posts are marked when the agent reads the room

Card: joshualeestone/kosmos#4926 (answered room posts come back). Owner: Renet Tilley. 2026-11-02.

## Why
The hold-and-tell path measured clean on the fleet board (1,345 tellings, 0 re-tells, 0 told-after-answered; card
comment 11-02). The later reports (10-21 feedback, #7784 item 4) say answered posts come back "when the agent checks the
room". `kosmos room` showed an old ask exactly like a new one, so an agent in a long session answered it again.

## What
1. server.js room route, text view, for a reader identified by its own agent token:
   - under a post that the reader answered by id (`--reply-to`), a line
     `[kosmos] you already answered [mX] in [mY].`
   - `?unanswered=1`: only posts asked of the reader (it is @named, or the person's post reached it) that no post of
     the reader cites. Walks the whole live room (not just the last N rows); N caps how many are listed (newest).
   - `?unanswered=1` with no identified reader: 400 with a sentence, never someone else's list.
2. install/kosmos `cmd_room` and tools/windows/kosmos-cli.js `verbRoom`: `--unanswered` passes `&unanswered=1`.
3. Tests: server.roomread-answered-4926.test.js; CLI pass-through in cli.gaps-4891 and its Windows twin.

## Rejected
- Hiding answered posts by default: changes every agent's room read, and a post answered in prose would vanish.
- Changing the tell path: measured clean.
- Counting a colleague's FYI that merely reached the reader as an ask: listing it invites the re-answers this stops.

## Weakest premise
"Answered" means cited by `--reply-to`. An agent that answers in prose still sees the post as open. The marker makes that
visible, the safer failure. Not reproduced on the model-family board (its log is not on this Mac).

Also not used, on purpose: the idle reminder's N7 rule (messages.staleHeld), which counts one reply to post X as
answering the posts a read showing X could have shown before it. For a reminder that only skips a nudge. For
`--unanswered` it would hide asks that are still open, the failure rejected above. So an agent that answers a whole round
with one reply to its newest post still sees the older asks listed; the filtered view has a line saying it counts only
replies citing a post by id.

A filtered answer always has a line starting "Waiting on an answer from you: " (after any shared-room or hold line),
including when nothing is waiting or the room could not be read, and both CLIs say so on stderr when no line starts that
way (a board from before this change ignores the flag and sends the whole room).

## Steps
- [x] server text view: reader, marker, unanswered filter
- [x] both CLIs
- [x] tests, mutation-checked (no answered map: 4 of 5 red)
- [ ] challenge loop (cap 8); iteration 1 fixed W2 and four nits, deferred W1 (above); iteration 2 fixed the partial-read head line and moved the Mac notice to stderr, deferred the hold-drop point (staleHeld already treats a post answered by id as handled, engine/messages.js) and the outcome allowlist (askedOfReader uses the post line's own reached test)
- [ ] full suite via queued-heavy
- [ ] PR, merge, verify served
