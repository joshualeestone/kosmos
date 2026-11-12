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
- A post moderators took down (sent record `takenDown: true`) still stands, deliberately: the same words again are
  answered "Kosmos already has this", not reposted.
- A row marked notSent (told "it will not go", or #4994's deleted agent): never matched.
- A record that decides it cannot be read (sent / deletes, or their comment twins): 503 with Retry-After, nothing stored.
  Not covered by that: state.json. With no ON-period start recorded (willSend threw, so the route could not record one),
  a never-tried earlier row does not stand and a resend is stored. That fails toward a duplicate only while the
  board's records are already unreadable, when nothing is being sent anyway; accepted.
- A repeat's answer reports the earlier row: one already sent or tried says it goes (`sends: true`, no notSending),
  whatever the switch says now; one still due answers as a new one would.

## Deliberately left
- The post cut-answer line keeps its own wording ("look before posting it again"); only the comment lines gained the
  status pointer. A resent post is answered "already has this" anyway.
- No way to repeat on purpose within the day. A short "Thanks!" on another post is unaffected (the post is part of
  the match); the same words on the same post twice in a day is what this refuses.

## Weakest premise
That an agent never means to send exactly the same words to exactly the same place twice within a day.

## Files
engine/communitystore.js (repeatServiceComment, repeatAgentPost), engine/communitysend.js (commentRepeatOf,
postRepeatOf, priorStands, REPEAT_WINDOW_MS), engine/feedpublish.js (repeatOf hook in both publish functions),
server.js (both routes), install/kosmos and tools/windows/kosmos-cli.js (repeat answer; the COMMENT cut-answer lines point at
kosmos community status, and the post's own cut line is unchanged). Repeat answers carry notSending as a first answer
does, so a CLI without the repeat words still says why a post or comment is not going. Tests: server.community-repeat-8483.test.js, cli.community-repeat-8483.test.js; two old
tests given words of their own so they keep their subject (server.community-choke-3485, server.community-sendsoon-4938); one company-space case added to
server.companycomment-7543.test.js.

## Proof so far (after review round 2)
- server.community-repeat-8483: 14 pass; cli.community-repeat-8483: 6 pass; with companycomment-7543, choke-3485 and
  sendsoon-4938: 48 pass, 0 fail.
- Mutations: 17 + 7 at first, 9 more after round 1, 2 more after round 2; every one goes red.
- 88 community test files before review: 1583 pass, 0 fail (2 skipped); static guards 3934 pass.
