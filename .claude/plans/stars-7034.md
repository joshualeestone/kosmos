# stars-7034: the iPhone puts starred agents first (#6719 on the phone, follow-up to #7030)

Card kosmos#7034. Board rule: web/index.html #6719, "starred agents first, in every order; within each group the chosen
order applies", stars kept by session name at GET /api/agent-stars ({ names, ok }).

## The call
- `Board.starredFirst(_:stars:)`: starred first, each group in the order it was given; nil or empty stars change
  nothing. `Board.sorted` and `Board.keepingOrder` take `stars` (default nil, so every other caller is unchanged).
- `Board.parseStars`: nil for `ok` false or another shape, so an unreadable answer changes no order.
- BoardClient reads the stars when the list is re-sorted (it appears, pull to refresh): the only moments the order is
  applied anyway, so a live update never moves a row for a star. An answer that cannot be read keeps the last stars;
  they are kept by the Mac's address, so one Mac's stars never order another's list.
- Review 1: the stars are read BESIDE the status read (async let), not after it, with a 4 s timeout, so a slow stars
  route costs at most 4 s on a re-sort, never the sum of both reads. Each status read takes a ticket when it starts;
  rows from a read older than the shown list are dropped (a pull and the 5 s loop can both be in the air). Whether a
  read re-sorts is taken when it starts, so a loop read already in the air cannot spend the pull's re-sort.
- Today (#7030 part 2, merged as PR #7035, so this card wires it): `Board.today(agents:tasks:stars:)` puts starred
  agents first in Needs you with `Board.starredFirst`, each group still longest waiting first. Working now is not
  reordered (the card asks for Needs you only). The view passes `client.shownStars`, the stars of the Mac the shown
  list came from; Today keeps holding its order on screen (it re-takes it on appear and pull, as before).

## Rejected
- Reading the stars on every status read (5 s): the order changes only on a re-sort, so the extra read buys nothing.
- Re-sorting when the stars change mid-screen: the spec keeps the order under the person's thumb.

## Weakest premise
- Stars read only on appear and pull: a star set on the board shows on the phone at the next re-sort, not at once.
  That matches how the phone treats every other order change.

## Tests (ios/LogicTests, 817 checks after review 1)
order with and without stars, a star for an unlisted agent, a live update with stars, the parse (ok, not ok, other
shape), the route; the client: starred first on connect, an unreadable pull keeps the last stars, a pull re-reads.

## Red arms (st-arms.py, a mutated copy through run.sh's source-dir argument), each red on a test
S1 stars change no order, S2 ok not read, S3 an unreadable answer forgets the stars, S4 sorted ignores stars, S5 new
rows ignore stars, S6 the client never reads stars. S1's first form did not compile and was re-aimed.

Review 1 added: the stars timeout, another Mac's list without the first Mac's stars, an older read's rows never put
back over a newer list (with a control that a newer read did answer meanwhile).

Review 1 arms ($S/st-arms-r1.sh): A0 control green; A1 no ticket guard, A2 stars not keyed by Mac, A3 no timeout,
A4 the re-sort read late: each red on its named check.

Today arms ($S/st-arms-today.sh): T0 control green; T1 Needs you ignores stars, T2 shownStars not keyed by Mac:
each red on its named check. TodayView.swift is not in the logic build; CI's Simulator SDK build compiles it.

## Progress
- [x] logic, client, tests, arms
- [ ] validation, challenge-loop, PR; Today with #7030 part 2
