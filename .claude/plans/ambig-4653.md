# ambig-4653: tell the sender when an @mention named two members and reached neither (kosmos#4653)

Follow-up to #4642 (PR #4652), assigned by Liu Kang (m3648). Branched from mention-4642; lands after #4652.

## Finished means
A sender whose @-word named two members (so it reached neither as a request) is told so in words, with the
candidates and the fix, both from `kosmos post` and under the room composer. A post with no ambiguous mention
reads exactly as before.

## Change
- engine/messages.js: `mentionedMembers` keeps, for each ambiguous word, the members it could mean.
  `ambiguousNote` builds one sentence per name, however it was spelled in the post ("@Sub-Zero could mean
  Sub Zero (@frost) or Sub-Zero (@subzero), so it reached neither as a request. To ask one of them, use the
  exact name, like @frost."). Members are shown by display name with the handle to type. When the post also
  named one of them exactly, the sentence names only those not asked; when it named all of them, there is no
  sentence. Display names lose quotes, backslashes and control characters, so the CLI's sed read holds. The
  post's delivery answer carries it as `ambiguousNote`, only when non-empty. The log row keeps
  `ambiguousMentions` (the words, less trailing punctuation).
- install/kosmos: `kosmos post` prints the sentence after its verdict (placed or unconfirmed), exit codes
  unchanged. Read with sed anchored on the end of the answer (`"}}`): the engine keeps the note the last key
  (a test pins it; /api/post answers `{ delivery }` alone and federateOut only reads it), so an `outcomes` key
  or the post's words can never be read as the note, and a reordered answer reads as silence.
- web/index.html: pjPostSend leaves the sentence under the composer (#pj-room-msg) and appends it to the
  receipt the screen reader hears.

## Tests
- engine/messages.mention-4642.test.js: a real post with a clash returns the sentence naming both by display
  name; a unique mention and no mention return none; a post that also names one exactly is told only about
  the other, and one naming all gets none; three spellings of one name give one sentence; three candidates
  are worded right and a display name's quote, backslash and control character are stripped. Mutations (by
  hand): answer field removed, the addressed filter removed, dedupe on the raw word, no stripping, keeping the
  trailing full stop: each turns a test red.
- cli.post-ambiguous-4653.test.js (stub board): placed and unconfirmed print the sentence, exit 0 and 3;
  control: no note prints nothing extra and still exits 0 (it caught `[ ] && say` leaking exit 1);
  control: post text quoting the field name is never read as the note; control: an outcome keyed
  `ambiguousNote` is never read as the note (red with the unanchored read).
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
