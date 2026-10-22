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
- CSS: `.msg-bd .msg-closing` (left-aligned) on top of the existing `.msg-t` look.
- The room route serves `closing: true` on such a post, and its text view (`kosmos room`, what agents read) says the same:
  the held line ends "Each agent gets one summary through a hold: a post of 400 characters or more that settles the
  thread." (a fact about the room: the view does not know which agent reads it or whether it used its summary; the
  post refusal says that per agent), and the summary's line carries "(its one summary while the room was held)".

Rejected: changing "most likely not go through" (still true for everything else; the added sentence names the one
exception); a badge or colour (a person reads a sentence; nothing to learn).

## Weakest premise
Checked rather than assumed, and it was false: the board's room route (server.js, `/api/project/<id>/room`) builds each
post row field by field and did not pass `closing`, so the label could never have shown. The route now passes
`closing: true`, and a server test reads it back. What remains: the label's wording and placement have not had a design
review yet (design shots follow).

## Tests
web.post-receipt.test.js "#6925": a held room's notice carries the sentence; of an ordinary post and a summary post, only
the summary carries the label. server.projects.test.js "#6925": the room route serves closing: true on the summary and
no field on an ordinary post. Mutants, each red: the label not drawn in the bubble; the sentence removed; the route not
passing closing; the text view not marking the summary.
