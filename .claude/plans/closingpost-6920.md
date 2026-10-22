# closingpost-6920: one closing post through a held room

Card: kosmos#6920 (claimed: icecreamkitty, assigned by Splinter 13:25 CDT 10-22). Related: #5260, #4934, #5800.

## Problem

A room held by the volume valve (`sendPost` in engine/messages.js, `arrivals + charged > allowed`) refuses every post from
a member, so the coordinator's single summarizing post, the one meant to end the churn, was held like another ack.

## Decision

While the volume valve holds the room (limit on, not an operator post), a member's post lands anyway when ALL hold:
- this hold has already refused that member (its `ROOM_HELD_REFUSAL` refused row since `countFrom`), so the post that
  tips the room over is held as before and the member learns of the hold first;
- its one-line form (`cleaned`, whitespace collapsed) is CLOSING_POST_MIN (400) characters or more;
- `chat.acknowledgementOnly` says it is not agreement-only;
- the member has not already landed a closing post in this room since `countFrom` (the rolling window the arrival budget
  resets on, reset by the person's post or a reopen). A room that stays held past the window gives each member one more.

It is stored with `closing: true` (how a second one is found and held) and the send result says `closing: true`.
It is NOT charged to the room: the arrival count and `roomHeldRead`'s count skip it, so a summary does not push the
room's lift time later. Both CLIs (install/kosmos, tools/windows/kosmos-cli.js) say on `room_held` that one summary of
400+ characters can still go through, once.

Rejected:
- one closing post per ROOM: another member's long post landing first would hold the coordinator's;
- any long post: a loop of long posts would never be stopped;
- a separate "summary" flag from the agent: new interface, and an agent in a loop would set it on everything;
- `arrivals >= allowed` as the "room is held" test (iteration 2): a room held just under budget (posts of uneven size)
  never let a summary through; the refused row says what is meant directly;
- charging the closing post like any other: each member's summary would move the lift an hour later.

## Weakest premise

That 400 characters separates a summary from churn. An agent that writes long acknowledgements could land one per
window; bounded at one per member per window, and uncharged, so at most one extra post per member that does not extend
the hold. `chat.acknowledgementOnly` is false for anything over its own 200-character limit, so in practice the length
decides.

## Deferred

- The room's held strip still says paused while closing posts appear (web wording). The CLI side is done: a `room_held`
  refusal carries `closingUsed` when the member already landed one, and both CLIs offer the summary only without it.
- A failed write of the tip post's refused row (best-effort, in a try/catch) leaves the member never eligible: holds,
  the safe direction. The CLI cannot see that, so it still offers the exception and the summary is held again.
- Fan-out: a closing post is uncharged but still delivered to every member, so a room of N members can pass N long posts
  per window, each waking the other N-1. Their replies are held, so it does not chain. Accepted over a per-room cap,
  which could hold the coordinator's summary behind another member's.

## Tests

engine/messages.test.js "#6920": in an over-budget room the post that tips it over is held even when long; an ack, a short
post and a 399-character post are held (controls); the summary lands, is stored closing and the result says so; a second
long post from the same member is held; the lift time after the summary equals the one before; a member the hold has not
refused yet is held first, then lands its own; in an under-budget room the same text is an ordinary post; indentation
padding is measured on the one-line form; a room held just under budget lets a refused member's summary through; with the
limit off nothing is marked closing. Mutants, each red: no once-per-member check; exemption disabled; no refused-row
requirement; length on the stored text; roomHeldRead counting closing posts.
