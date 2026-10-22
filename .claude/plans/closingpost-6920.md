# closingpost-6920: one closing post through a held room

Card: kosmos#6920 (claimed: icecreamkitty, assigned by Splinter 13:25 CDT 10-22). Related: #5260, #4934, #5800.

## Problem

A room held by the volume valve (`sendPost` in engine/messages.js, `arrivals + charged > allowed`) refuses every post from
a member, so the coordinator's single summarizing post, the one meant to end the churn, was held like another ack.

## Decision

While the volume valve holds the room (`lim.on`, not an operator post), a member's post lands anyway when ALL hold:
- it is CLOSING_POST_MIN (400) characters or more after trimming;
- `chat.acknowledgementOnly` says it is not agreement-only;
- the same member has not already landed a closing post in this room since `countFrom` (the window the arrival budget
  and the hold notices already reset on).

It is stored with `closing: true`; that field is how the second one is found.

Rejected:
- one closing post per ROOM: another member's long post landing first would hold the coordinator's;
- any long post: a loop of long posts would never be stopped;
- a separate "summary" verb or flag from the agent: new interface, and an agent in a loop would set it on everything.

## Weakest premise

That 400 characters separates a summary from churn. An agent that writes long acknowledgements could land one each per
hold; bounded at one per member per window, so a held room gets at most one extra post per member.

## Not changed

The ack-only trigger, the pair limit, the refused/valve rows, roomHeld(): a closing post is a normal delivered post that
counts toward arrivals like any other.

## Tests

engine/messages.test.js "#6920": in an over-budget room an ack, a short content post and a 399-character post are held
(controls); the summary lands and is stored closing; a second long post from the same member is held; another member
lands its own; in an under-budget room the same summary is an ordinary post (not marked closing). Mutants: removing the
once-per-member check, and disabling the exemption, each turn the test red.
