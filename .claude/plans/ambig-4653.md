# ambig-4653: tell the sender when an @mention named two members and reached neither (kosmos#4653)

Follow-up to #4642 (PR #4652), assigned by Liu Kang (m3648). Branched from mention-4642; lands after #4652.

## Finished means
A sender whose @-word named two members (so it reached neither as a request) is told so in words, with the
candidates and the fix, both from `kosmos post` and under the room composer. A post with no ambiguous mention
reads exactly as before.

## Change
- engine/messages.js: `mentionedMembers` keeps, for each ambiguous word, the members it could mean.
  `ambiguousNote(map)` builds one sentence per word ("@Sub-Zero could mean frost or subzero, so it reached
  neither as a request. To ask one of them, use its exact name, like @frost."). The post's delivery answer
  carries it as `ambiguousNote`, only when there is one. The log row keeps `ambiguousMentions` (words only).
- install/kosmos: `kosmos post` prints the sentence after its verdict (placed or unconfirmed), exit codes
  unchanged. Read with sed like `because`; the sentence is [A-Za-z0-9._-] words, so no quote can cut it.
- web/index.html: pjPostSend leaves the sentence under the composer (#pj-room-msg) and appends it to the
  receipt the screen reader hears.

## Tests
- engine/messages.mention-4642.test.js: a real post with a clash returns the sentence naming both; a unique
  mention and no mention return none; three candidates and two words are worded right, with no quote or
  backslash. Red with the answer field removed.
- cli.post-ambiguous-4653.test.js (stub board): placed and unconfirmed print the sentence, exit 0 and 3;
  control: no note prints nothing extra and still exits 0 (it caught `[ ] && say` leaking exit 1);
  control: post text quoting the field name is never read as the note.
- docs/browser-checks/render-room-reply-3745.js: a stubbed answer carrying the note leaves it under the
  composer and in the announcement, and the box still clears.

## Rejected
Addressing both members: that turns a post into a request on a guess, the direction #4642 is strict about.

## Weakest part
The page arm stubs the board's answer rather than building a real clash, so it pins the page's reading of
the field, not the engine's; the engine test pins that half. An agent posting through the outbox drain (a
kept post delivered later) gets no answer to print, so it is not told; the log row still has it.

## What would change my mind
A ruling that an ambiguous mention should be refused (not posted) until the sender picks a name.
