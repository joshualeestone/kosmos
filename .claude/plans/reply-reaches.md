# reply-reaches: #145, the colleagues block warns about the marker echo (card's second half)

## What finished looks like

Card #145's done-when, measured against the tree:

1. "the instruction block says that a reply in the agent's own session does not
   reach the room, and what to do instead": ALREADY TRUE before this branch.
   `blockBody()` carries the Answering section ("A reply you write in your own
   session reaches nobody", the `kosmos reply` teaching), pinned by the
   existing test at engine/messages.test.js:426. Shipped by the #128 rewrite.
   This branch adds no code for it; it closes as already built.
2. "it warns that echoing the delivery marker will be refused, before the
   agent hits it": THIS BRANCH. A paragraph in the Answering section says
   every delivered message opens with a bracketed line naming the sender and
   an m-number, that sending such a line back is refused as impersonation,
   and what to do instead (own words, or name the id).
3. "both ship at boot": `create.js:1405` splices the block at agent creation
   and `projects.js healColleagues` re-splices the CURRENT blockBody() into
   any instruction file carrying the markers on every sync, so existing
   agents receive the new paragraph without a reinstall.

## The one design rule

The warning DESCRIBES the bracket line, it does not quote it. The guard at
messages.js:399/:659 is exact-substring on the MARKERS prefixes; the block
already quotes a prefix once (line ~51, deliberately, to teach recognition
of INCOMING mail, which never rides a send), but the warning paragraph is
the sentence a hurried agent copies into an answer, so it must survive the
guard it names. Recorded lesson: "a comment naming its own subject".

## Tests

Extends the existing #128 pin test:
- warning present ("Do not quote the bracket line"), across-whitespace match
- says what to do instead ("own words, or name\s+the id")
- CONTROL: the warning paragraph swept against the guard's own MARKERS list,
  parsed from messages.js source (cannot drift into a copy), with a positive
  control proving the sweep can see a marker at all (the teaching quote).

## Review bound

One round, one reviewer. The diff is 6 lines of prose plus a test; the risk
surface is the wording (quote vs describe) and the test's anchors, both of
which the control and positive control exercise.
