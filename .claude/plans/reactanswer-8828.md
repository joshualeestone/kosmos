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
