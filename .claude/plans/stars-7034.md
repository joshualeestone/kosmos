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

## Tests (ios/LogicTests, 885 checks)
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

## Review 2, deferred (with the reason)
- A dropped older read skips the success bookkeeping (failedRefreshes, unauthorizedSince). Kept: the read it lost to
  started later, so its answer (success or failure) is the newer evidence about the Mac; an older success does not
  outrank it. A dropped read only ever follows a newer read that was applied or is still in the air.
- A re-sort waits for the stars read: bounded by the 4 s timeout (review 1), and only on appear and pull.
- The stale-read test was suspected of timing luck. Measured: 20 of 20 green as built, 20 of 20 red with the ticket
  guard removed ($S/st-repeat.sh, one build, the binary run 20 times).

## Review 3
- A pull that read nothing could leave a re-sort behind: a read already in the air (not re-sorting) moved updatedAt,
  so refreshNow's `updatedAt == before` test kept resortNext, and the next live update re-sorted under the thumb.
  Now: a re-sort request records the first read allowed to apply it (resortFrom); a read re-sorts only if it started
  wanting one, still at or after resortFrom, and the request is still standing when it lands. refreshNow withdraws the
  request unless a read that started with it re-sorted (sortedTicket). So an older read cannot spend a newer pull's
  re-sort, and a read begun during a failed pull does not re-sort after it.
- forget() clears the stars with everything else learned under the session.
- Tests: the failed pull with a read in the air and one landing after it (fake status reads now take yields in the
  order they begin), a live update reads no stars, a sign-out forgets the stars. Arms ($S/st-arms-r3.sh, r4.sh):
  R1 refreshNow never withdraws, R2 no standing-request check, R3 no resortFrom check, R4 stars kept on sign-out:
  each red on its named check; A1 and T2 re-run, still red.

## Review 4 (after a rebase onto main, 967 checks before this round)
- Today re-took its held order at the first updatedAt after a pull. A loop read already in the air lands first, with
  the old stars, so Today kept the old star order while the Agents list re-sorted with the new ones. Now BoardClient
  publishes sortEpoch, bumped only when a re-sort applies, for Today to re-take its order on (see review 5 for what
  Today does with it; review 4's own view change was superseded).
- Stars are now stored only by a read that re-sorts, so a read whose re-sort was withdrawn cannot hand Today stars
  the Agents list is not ordered by.
- Not changed: a new Mac whose stars read fails lists without stars until the next pull (the design, a UX note).
- Tests (971): the failed-pull test now stars Dana mid-pull and checks no epoch moved and no stars were taken, then
  that the control pull moves the epoch by exactly one. Arms ($S/st-arms-r4.sh): E0 control green; E1 stars stored
  on any read, E2 epoch bumped on every read: each red on its named check. TodayView.swift is compiled by CI only.

## Review 5
- Review 4's settle-at-pull-end froze Today on stale rows when the pull did no read (a reconnect via retry(), or a
  pull while connecting): the reconnect's re-sort then found an order held and changed nothing. The same split showed
  on appear and on return from the background (Today took the order at once, the re-sort's new stars came after).
- Now Today re-takes its order at EVERY re-sort, held or not. A re-sort happens only at appear, pull and (re)connect,
  the moments the Agents list re-orders, so the two lists cannot disagree about who is starred first, and nothing
  moves under the thumb between them. The review-4 description ("re-takes on the epoch during a pull") was not what
  that code did; it is what this code does.
- The rules moved out of the view into Board.TodayOrder (TodayLogic.swift, in the logic build), so they are tested:
  clear, pullStarted, pullEnded (settles only an empty order), updated (fills an empty order, never during a pull),
  resorted (always re-takes), apply (held cards in place, new ones after in the model's order; now a stable sort and
  safe on a repeated name). TodayView only calls them.
- Tests (983): the TodayOrder transitions and apply. Arms ($S/st-arms-r5.sh): O0 control green; O1 a re-sort fills
  only an empty order, O2 a live update fills during a pull, O3 a pull end never settles, O4 apply ignores the held
  order: each red on its named check.
- TodayView now type-checks locally against the iPhoneSimulator 27.0 SDK (all 26 app files); a control copy with a
  type error in TodayView fails that check (tc=1).

## Review 6: no blocking finding; deferred (with the reason)
- A tab return's re-sort can be lost when the person pulls while that read is in the air and the pull's own read then
  fails (resortFrom moves past the earlier read). Kept: the window is a fraction of a second, the cost is a stale
  order, and the person is already pulling, so the next pull fixes it. Widening resortFrom back to the earlier read
  reopens review 3's case (an older read spending a newer pull's re-sort), which is the worse error.
- Two reads both wanting a re-sort, the later landing first with its stars read timed out: the stars stay one pull
  stale. Needs a 4 s stars timeout inside a pull; same cost and same remedy.
- TodayView's three wiring lines (sortEpoch onChange, pullStarted, pullEnded) are covered by the type-check and CI's
  build, not by a logic test. A source-text pin would check that the words are present, not what they do, and the
  view has no test host. The rules themselves are tested in Board.TodayOrder.
- The order of the two onAppear handlers predates this card (as review 6 noted) and is not changed here.

## Validation it2 (e0cf46ef): 23,430 pass, 3 fail, all contention
- cli.refused-retry-6968 (2) and server.attachment-stream-6734 (1), files this diff cannot reach (it touches only
  ios/ and this plan). Run alone through the light lane at the same HEAD: 44 of 44 pass. Load 4.37 during the run.

## Progress
- [x] logic, client, tests, arms
- [x] Today with #7030 part 2
- [ ] validation, challenge-loop, PR
