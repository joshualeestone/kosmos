# #6065 N1: a room post that is still shortened carries the request in its preview

Owner: Angel. 2026-10-14 11:30 CDT. From Josh's 0.7.48 five-family report (card comment 10-14 09:09): GPT got the whole
briefing, but Gemini and Meta still had long room posts arrive shortened with the full text in a file. His ask: confirm
on the Gemini and Meta runners, and where a message is still shortened, put the request in the preview.

## Finished looks like
When a room post or DM is too long to type whole (messages.spillsAt), the line the agent sees still carries the head,
the size and the file, and now also the request: for a room post, the sentence that @-mentions this member (by handle
or display name, and only when the room itself counted it as mentioned) shown quoted as Where it names you: "..."; otherwise
the post's first question (a ? ending a word, never one in a link) as Its first question: "..."; a sentence already in
the head is skipped for the next one; nothing when there is none. At most 300 characters.

## What the code says about the Gemini and Meta shortening (read on origin/main, not measured on the test Mac)
- No runner-specific cut exists: the only spill is messages.spillsAt, measured per member on the whole line.
- Each member's line carries per-member extras: the answer clause when mentioned, the missed-posts note and the
  held-posts clause (roomhold.clauseFor). A busy or quota-held Gemini or Meta seat carries more of them, so a post near
  the limit can fit for GPT and spill for them. That is the likeliest Kosmos-side cause; unconfirmed without the post's
  length and each seat's line.
- If a seat saw a temp-file path or other wording than "(long message, N words; the full text is in your own folder at
  ...)", the runner saved long command output itself (for example from `kosmos room`), not Kosmos.

## Decided
- Build Josh's preview ask now; it helps whichever cause it is. Rejected: raising the limit (chat.MAX_TEXT is what the
  pane takes) and dropping the held-posts clause to make room (the agent would lose those posts' ids).
- DMs pass no names, so a DM's preview gets the first question (the whole DM is to that agent).
- Weakest premise: that the request is one sentence with an @-mention or a question mark. A request phrased as an
  instruction with neither ("Gemini seat: confirm delivery.") gets no request clause; the head and file are unchanged.
- (round 2) One definition of a mention: mentionedMembers records where it read each member as named (namedAt) and the
  preview quotes that sentence; requestIn has no matcher of its own. The quoted request cannot close its quotes or
  open a bracket (double quotes become single, square brackets round). "Already in the head" is by position. The
  text reaching it has no line breaks (chat.cleanMessage), so a list without punctuation reads as one sentence.
- (rounds 4-5) A greeting (a mention ending its sentence with at most 4 words before it) also takes the next sentence;
  a greeting inside the head gives way to a later mention, else to the sentence after it. A member mentioned only
  inside the head gets the first later question instead, under the neutral label Its first question (it may be a
  question for someone else; the label does not claim it is theirs).
- (round 7) The greeting rule from rounds 4 and 5 (a short mention sentence also takes the next one) is removed: each
  version quoted unrelated text under a label saying it names the member, and the label (Where it names you, round 6)
  is already true of "Hi @mara." alone. Only the naming sentence is quoted.
