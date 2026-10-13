# #6065: a long task or room message reaches the agent whole

**Branch:** `wholemsg-6065` · **Card:** kosmos#6065 (from feedback).

## Done looks like

A task or room message longer than the old 700-character spill, whose whole line fits what chat types, reaches the agent whole: no head-and-pointer, no file to open. Only a line past chat's own limit (10000, the same as the person's messages to an agent) spills. A test sends over-700 messages and checks that they arrive whole.

## What existed, measured

- `engine/messages.js` spilled any colleague DM or room post over `SPILL_AT = 700` characters into the recipient's Inbox and typed a head plus "(long message, N words; the full text is in your own folder at <path>)" (#4447, #5706). These are the only two spill sites.
- The 700 rule is from 2026-08-17 (16a55cc17), the send-keys era: long sends "landed collapsed and unsent while looking delivered".
- #3419 (0e9344e3a, 2026-09-22) replaced that transport with a chunked paste ("the chunking already scales to any size"), and #3562 (fe11034ae, 2026-09-24) raised the person's own message cap to 10000 on it. Colleague and room messages go through the same `chat.deliver`, so only the 700 rule still cut them.

## The change

- `SPILL_AT` is gone. `spillsAt(line)` is true when the line is longer than `spillLimit()` = `chat.MAX_TEXT` minus the longest kept note (review 1): a message held for an agent out of usage or signed out is typed later with limitqueue's note after it, through the same length check, so a line that fit now and not then would be refused on every sweep until dropped. The reserve is computed from `limitqueue.keptNote` itself, with the longest timestamp toISOString writes (9923 today).
- **DM:** the envelope prefix is built first, and the body spills only when `prefix + body` would pass the limit.
- **Room:** the decision moved inside the per-member delivery, after that member's whole line is known (envelope, catch-up note, held-posts line). A member whose spill file cannot be written is not reached, and the held posts taken for its line are put back (`roomhold.restore`, as `typingBroke` does). The attachment trailer is left out of the measure, because chat checks it apart from the text.
- `spillsAt` measures the raw line, never shorter than the whitespace-collapsed text chat checks, so a line it lets through, chat accepts.

## Tests

`engine/messages.test.js`:
- a ~3000-character DM is typed whole, with no Inbox file;
- the boundary: a body leaving room for the envelope is typed whole, and a body within the limit alone but not with the envelope spills, so nothing is refused;
- a ~3000-character room post reaches every member whole, with no Inbox files.
- (review 1) a DM that fits now but not with the kept note is spilled, so the held copy is typed after the reset (engine/limitmsg-5805.test.js);
- (review 1) a member whose spill cannot be written is not reached and gets its held posts back; the held-posts line counts toward the limit (a post that fits alone but not with a long held line is spilled for that member, whole for another) (engine/messages.typingbroke-4926.test.js). #4926 review 3's "spilled, then failed before typing" case no longer exists (the spill sits right before typing) and that test is replaced.

The older spill tests (#4447's Inbox safety, #1264, #4926, #5706 head) now use messages past the new limit, so they still test spilling: `'the lease detail '.repeat(700)` instead of `repeat(80)`. #1264's size control is 4x, not 10x, because MAX_BODY caps the large body at 64 KB.

**Shown failing:** with the old 700 rule back, all three new tests fail. Measuring the body alone instead of the whole line makes the boundary test fail (the body near the limit would be refused by chat). Review 1: no reserve for the kept note, no put-back on a failed spill, and the held line left out of the measure each fail exactly their own test.

## Not in this card

The third ask, an exact-file identity (path and hash) an agent can reference rather than transcribe. Delivering whole already means a path and hash written in a message arrive as written. A reference mechanism beyond that is its own feature.

## Weakest premise

That the #3419 paste delivers 10000 characters as reliably to a busy agent as it does for the person's own messages. It has carried them since 0.6.x. A very long message is still a lot of text in the agent's context, the same as the file it would otherwise read.

## Rejected

- Raising SPILL_AT to a guessed number (8000): the room line's extra parts vary per member, so a guess is either wasteful or refused by chat.
- Expanding the file automatically on the agent's side: there is no agent-side hook to do that, and whole delivery removes the file instead.
