# heldstrip-6925: the held-room notice names the one-summary exception; a summary post says what it is

Card: kosmos#6925 item 3 (claimed: icecreamkitty). Items 1, 2 and 4 are PR #6941 (CLI and board flag).

## Problem
#6920 lets each member land one long summary through a held room. The notice above the composer (#5800, `pjHeldNotice`)
still says "Your agents' posts will most likely not go through until you post something yourself or reopen the room",
and nothing on the post marks it, so the person sees new posts in a held room with no explanation.

## Decision
- `pjHeldNotice` keeps its words and adds: "Each agent can still post one summary that settles the thread."
- A new `pjClosingTag(m)`: a post with `closing: true` (the board's stored flag from #6920) gets one small muted line in
  its bubble, above the time: "Posted as this agent's one summary while the room was held". `pjRoomRow` draws it.
- CSS: `.msg-bd .msg-closing` (left, italic) on top of the existing `.msg-t` look.

Rejected: changing "most likely not go through" (still true for everything else; the added sentence names the one
exception); a badge or colour (a person reads a sentence; nothing to learn).

## Weakest premise
That the room read passes the stored `closing` field through to the page. The board's room route returns the log rows,
and the test paints from rows with `closing: true`; a route that trimmed fields would leave the label off (no harm, the
notice still says it).

## Tests
web.post-receipt.test.js "#6925": a held room's notice carries the sentence; of an ordinary post and a summary post, only
the summary carries the label. Mutants, each red: the label not drawn in the bubble; the sentence removed.
