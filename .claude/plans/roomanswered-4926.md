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

## Steps
- [x] server text view: reader, marker, unanswered filter
- [x] both CLIs
- [x] tests, mutation-checked (no answered map: 4 of 5 red)
- [ ] challenge loop (cap 8)
- [ ] full suite via queued-heavy
- [ ] PR, merge, verify served
