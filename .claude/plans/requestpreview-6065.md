# #6065 N1: a room post that is still shortened carries the request in its preview

Owner: Angel. 2026-10-14 11:30 CDT. From Josh's 0.7.48 five-family report (card comment 10-14 09:09): GPT got the whole
briefing, but Gemini and Meta still had long room posts arrive shortened with the full text in a file. His ask: confirm
on the Gemini and Meta runners, and where a message is still shortened, put the request in the preview.

## Finished looks like
When a room post or DM is too long to type whole (messages.spillsAt), the line the agent sees still carries the head,
the size and the file, and now also the request: for a room post, the sentence that @-mentions this member (by handle
or display name, and only when the room itself counted it as mentioned) shown quoted as Where it names you: "..."; otherwise
the post's first question (a ? ending a word, never one in a link) as A question in it: "..."; a sentence already in
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
  inside the head gets the first later question instead, under the neutral label A question in it (it may be a
  question for someone else; the label does not claim it is theirs).
- (round 7) The greeting rule from rounds 4 and 5 (a short mention sentence also takes the next one) is removed: each
  version quoted unrelated text under a label saying it names the member, and the label (Where it names you, round 6)
  is already true of "Hi @mara." alone. Only the naming sentence is quoted.
- (round 9) A question is quoted only to a member the post names (or a DM's reader): quoting one to a background
  member would steer an agent the post was not addressed to, which the room already avoids (no answer line). A long
  question with no space in its last 100 characters (a link) is cut by character, never down to the bare ?.
- (round 10) A question is quoted to every reader the post is to, as the answer line and the hold already decide it:
  an operator post (the whole room), a member it names, or the author of the post it replies to; never a background
  member. A sentence the opening cut only started is quoted whole (its unseen part may hold the request).
- (round 11) With --no-reply (FYI, no reply requested), a member the post is to still gets A question in it: the
  label is neutral and does not ask for an answer. A mention within 100 characters of the start of a sentence longer
  than the cap is quoted from the start, so a request near that sentence's far end can still be cut off.
- (round 12) A question ending in a closing quote or bracket (ready?" or (ready?)) counts and is quoted with its closer.
  The room path measures the line again after adding the request, with the catch-up and held-posts clauses after it,
  and drops the request in the unlikely case it no longer fits. (Round 13: that choice is fitOrBare, tested on both arms.)
- (round 13) One definition of a sentence for both ends of the request, with the head's own abbreviation rule
  (notAnEnd, for a full stop only): a sentence ending in a closing quote is not pulled in, and p.m. or e.g. does not
  split one.
- (round 14) For the request a full stop ends a sentence unless the word is a known abbreviation, a list number, a
  dotted word of two or more short pieces (e.g., p.m., U.S.) or a capital initial: a filename, domain, version or
  ellipsis (config.yaml., example.com., v1.2., wait...) ends one. The head's own cut rule is unchanged.
- (round 15) An abbreviation opened by a bracket or quote ((e.g., "Dr.) is still one. Not done: a room-level test that
  reaches fitOrBare's bare arm (it needs a catch-up and held-posts clause near the limit); fitOrBare is unit-tested
  on both arms and the room call passes catchUp + heldLine, read in review.
