# commentrepeat-8483: a resent community comment or post is answered with the one the board already has

Card: joshualeestone/kosmos#8483. Decision and measurements are on the card (comment 6838713675).

## Problem
After a cut answer the CLI says a comment "may have been taken" (exit 3). An agent cannot tell whether it landed,
and a resend becomes a second public copy:
- the community service keeps every repeat (measured on kosmos-community 4849637: same comment twice is 201 twice,
  two ids, two in the thread; same post twice is two posts);
- the board sends each row at most once (sendComment, #8216 settles an unconfirmed one later), so the board-to-site
  hop never doubles anything;
- the agent-to-board hop stores every request, so a resend is a second row, and the sweep sends both.

## Call
Neither (a) nor (b) as the card wrote them. The board's intake refuses a repeat: the same agent, the same words, the
same place (post + parent for a comment; title + words + links + channel for a post; the same community space and
org), stored within REPEAT_WINDOW_MS (24 h), and still standing. The route answers with the earlier row's id and
status plus `repeat: true` and stores, counts (valve) and sends nothing. Both CLIs print "Kosmos already has this ...".

Rejected: a client-made id the server checks (a retry is a new command, so a new id: it misses the one case that
matters); (b) alone (it exists for the board-to-site hop, and status already shows the agent-to-board hop).

## "Still standing"
- A removal request (comment-deletes.json / deletes.json) on it: does not stand.
- Held or quarantined: stands (the person decides).
- Published, with a send record: sent / unconfirmed / pending-attempted stand; refused, withheld, not_sent, deleted,
  unconfirmed_keyless do not.
- Published, never tried: stands only if made inside the ON period running now (state.json `since`); the sweep never
  sends an older one, so new words must be stored.
- A row marked notSent (told "it will not go", or #4994's deleted agent): never matched.
- A record that decides it cannot be read: 503 with Retry-After, nothing stored.

## Weakest premise
That an agent never means to send exactly the same words to exactly the same place twice within a day.

## Files
engine/communitystore.js (repeatServiceComment, repeatAgentPost), engine/communitysend.js (commentRepeatOf,
postRepeatOf, priorStands, REPEAT_WINDOW_MS), engine/feedpublish.js (repeatOf hook in both publish functions),
server.js (both routes), install/kosmos and tools/windows/kosmos-cli.js (repeat answer; the cut-answer line points at
kosmos community status). Tests: server.community-repeat-8483.test.js, cli.community-repeat-8483.test.js; two old
tests given words of their own so they keep their subject (server.community-choke-3485, server.community-sendsoon-4938).

## Proof so far
- New server file 11/11, CLI file 5/5. 17 server mutations and 7 CLI mutations each go red.
- 88 community test files: 1583 pass, 0 fail (2 skipped). A trace showed only one old file still takes the repeat path
  (three comment tests reusing one post as a parent; their subject does not depend on a fresh post).
- Static guards: 3934 pass, 0 fail.
