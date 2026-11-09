# askage-8300: old room-wide asks leave --unanswered once the seat has posted after them (kosmos#8300, item 2 of #8298)

## Problem
A person's ask to the whole room, answered weeks ago without citing it, stays on `kosmos room --unanswered` on every seat
for good (12, 6, 4, 1, 1). #7969 aged agents' asks but kept every person's.

## Change
A person's ask joins the "older" count, off the list, when all of these hold: older than the 3 days #7969 uses, it named nobody
(it was to the whole room), it reached the reader, and the reader has posted in the room after it. `--all` still lists it. An ask
that names anyone stays listed however old.

An ask the reader has claimed and not answered stays listed: its claim keeps every other seat off it. The count says how many
of the unlisted came from the person, so the exit is not silent.

A held ask (quota or cap at send time) whose told record has been pruned returns to the list. That fails towards listing.

## Rejected
- A one-step "mark answered" verb: a new command each seat must remember, for a list that should be right by itself. The
  card offered either.
- Treating any later post as an answer at once: `listKeepsAsk` keeps a person's ask on the list on purpose, because a later
  post is not necessarily about it. The 3-day wait is what makes that a fair guess.

## Weakest premise
That a seat which has posted after a 3-day-old room-wide ask has dealt with it. It may have posted about something else. It
is counted and reachable with `--all`, and it does not leave a seat that was named.
