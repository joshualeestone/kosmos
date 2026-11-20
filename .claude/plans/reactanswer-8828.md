# reactanswer-8828: --unanswered says why a post you reacted to stays listed (kosmos#8828 item 1)

Finished means: on `kosmos room <id> --unanswered`, a listed post the reader has a live reaction on (latest add per emoji;
not the 🙋 claim; this room only) is named on a line under the list saying a reaction does not answer a post addressed
to you, so it stays until answered with --in-reply-to. Nothing leaves the list because of a reaction.

Why: feedback 11-19 read the list as broken after reacting to a confirmation. engine/defaults.js already rules that "A
reaction never answers a message addressed to you", and messages.unanswered (the board's nudge) agrees, so the list was
right and only silent. Rejected (review round 1, BLOCKER): counting a reaction as the answer to a post with no "?". It
contradicted that rule and the nudge, and a 👀 ("looking at it") cleared a person's request.

Weakest premise: that the reporter's confirmation named them (only a post that asked the reader is listed at all).
Items 2 and 3 of #8828 were first planned as separate slices; from 2026-11-20 all three are on this branch (below).

## 2026-11-20 (Mona Lisa, after restart)
- Item 1, review 2 fixes (90367a1762): runnable command (post id when one, project id, answer), set built only under
  --unanswered from reactionRowsOf for listed posts, every raised hand dropped; tests for unmarked/skin-tone 🙋, claimed
  still listed, several emojis one removed, two posts, -n cut, plain read. Six mutations each fail. roomread 88/88.
- Item 3 (1e46230f04): both "no check N" errors list the checks (numbered, 60-char cut). The earlier failing test was my
  fixture: an agent who does not own the task is refused 403 by design (server.task-donewhen-5152); person: true fixes it.
  Mutations on each path fail. Siblings 32/32.
- Item 2: decided wording, not behaviour. The rhythm counts reported work (#5635 F2) and a seat working now already
  reads stale by wallClock (#8298), so nothing is owed. The line now leads with "not due yet: the 4-hour rhythm counts
  working time, not the clock, and ...". Rejected: "current" (11-05 feedback said it read wrong on a 15-hour file).
  Weakest premise: the 11-19 install's seat really had no unreported work (a runner reporting only turn ends is
  turnsOnly, covered). projectview 40/40.
- Review 3 (blind, whole branch), taken: item 1 line now gives both ways out (a confirmation IS answered by a reaction,
  defaults.js), never asks for an "agreed" post; item 3 checks quoted, in single quotes with double-quote-like
  characters made one (install/kosmos reads a refusal with a sed that stops at the first double quote; the reviewer's
  double-quote fix would have broken it), printed whole (3 x 200 max), unreachable "(none)" dropped; item 2 "reported
  work" not "working time". Rejected: a new item 2 test for a working-now seat (the wallClock path, #8298's own tests);
  a positive case in item 1 test 3 (test 1 is that control). Quote-replacement mutation fails the test. 160/160.
- Review 4 (blind, whole branch), taken: BLOCKER, the confirmation sentence showed under the person's reacted post
  (defaults.js:653, a reaction never answers the person; :658 covers colleagues). Now only when a named post is a
  colleague's; new test with a person's post; forcing the clause on fails it. Item 2 scoped to "for this seat" (the
  same screen can flag a working seat by the clock, #8298). "stays listed for now" became "it still shows here".
  Rejected NITs: a backslash prints doubled in the macOS CLI (cosmetic, no truncation, and checks with one are rare);
  results vs doneWhen count (the two arrays are kept the same length by every writer). 161/161.
- Review 5 (blind, whole branch), no blocker. Taken: a colleague's confirmation now says it "can stay listed for up to
  3 days" (UNANSWERED_DAYS) and needs nothing more; NIT made real: the done-when and check routes read a 404 by matching
  the message, and the refusal now carries check words, so a check saying "no task by that number" turned 409 into 404
  (MEASURED: 404 !== 409 before the fix). Both routes anchored to /^there is no (project|task) .../ (all 23 not-found
  errors start that way, counted); a test per route, each failing un-anchored, with a missing-task 404 control.
  Typographic quotes in a check now tested (line-scoped mutation fails it). 167/167.
  Rejected: "for this seat" (the worked state can apply to a seat working inside the wake grace, so "while not working"
  would be false); per-post reactions line not room-scoped (pre-existing, #7365 comment says deliberate).

## Finished means
All three items on a served (prod) build: room --unanswered names a reacted post with both ways out; project show's
not-due line reads as above; a "no check N" refusal lists the checks, through both CLIs. Card closes only then.
