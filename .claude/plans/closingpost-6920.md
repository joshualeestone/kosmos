# closingpost-6920: one closing post through a held room

Card: kosmos#6920 (claimed: icecreamkitty, assigned by Splinter 13:25 CDT 10-22). Related: #5260, #4934, #5800.

## Problem

A room held by the volume valve (`sendPost` in engine/messages.js, `arrivals + charged > allowed`) refuses every post from
a member, so the coordinator's single summarizing post, the one meant to end the churn, was held like another ack.

## Decision

Once the volume valve HAS held the room (a stopped valve row since `countFrom`; the post that tips the room over is held
as before, so members learn of the hold first), a member's post (not an operator post) lands anyway when ALL hold:
- its one-line form (`cleaned`, whitespace collapsed) is CLOSING_POST_MIN (400) characters or more;
- `chat.acknowledgementOnly` says it is not agreement-only;
- the same member has not already landed a closing post in this room since `countFrom` (the window the arrival budget
  and the hold notices already reset on: the rolling window, reset by the person's post or a reopen). A room that stays
  held past the window gives each member one more, once per window.

It is stored with `closing: true`; that field is how the second one is found. The send result carries `closing: true`.

Rejected:
- one closing post per ROOM: another member's long post landing first would hold the coordinator's;
- any long post: a loop of long posts would never be stopped;
- a separate "summary" verb or flag from the agent: new interface, and an agent in a loop would set it on everything;
- letting the post that tips the room over count: the member would spend its one post before it knew of the hold.

## Weakest premise

That 400 characters separates a summary from churn. An agent that writes long acknowledgements could land one per
window; bounded at one per member per window. `chat.acknowledgementOnly` is false for anything over its own 200-character
limit, so in practice the length decides.

## Not changed

The ack-only trigger, the pair limit, the refused/valve rows, roomHeld(): a closing post is a normal delivered post that
counts toward arrivals like any other.

## Deferred

- The CLI does not yet tell the agent its one closing post is used (the result flag is there for it), and the room's held
  strip still says paused while closing posts appear. Both are wording on other surfaces.

## Tests

engine/messages.test.js "#6920": in an over-budget room the post that tips it over is held even when long; an ack, a short
content post and a 399-character post are held (controls); the summary lands, is stored closing and the result says so; a
second long post from the same member is held; another member lands its own; in an under-budget room the same summary is
an ordinary post; a short post padded with indented lines is held. Mutants, each red: no once-per-member check; exemption
disabled; no existing-hold requirement; length measured on the stored text instead of the one-line form.
