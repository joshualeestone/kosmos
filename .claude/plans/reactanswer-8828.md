# reactanswer-8828: --unanswered says why a post you reacted to stays listed (kosmos#8828 item 1)

Finished means: on `kosmos room <id> --unanswered`, a listed post the reader has a live reaction on (latest add per emoji;
not the 🙋 claim; this room only) is named on a line under the list saying a reaction does not answer a post addressed
to you, so it stays until answered with --in-reply-to. Nothing leaves the list because of a reaction.

Why: feedback 11-19 read the list as broken after reacting to a confirmation. engine/defaults.js already rules that "A
reaction never answers a message addressed to you", and messages.unanswered (the board's nudge) agrees, so the list was
right and only silent. Rejected (review round 1, BLOCKER): counting a reaction as the answer to a post with no "?". It
contradicted that rule and the nudge, and a 👀 ("looking at it") cleared a person's request.

Weakest premise: that the reporter's confirmation named them (only a post that asked the reader is listed at all).
Items 2 and 3 of #8828 are separate slices, not in this branch.

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
