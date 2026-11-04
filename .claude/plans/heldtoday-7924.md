# heldtoday-7924: Today says a held question is held (kosmos#7924, follow-up to #7915 / #7916)

Stacked on heldcount-7916 until it merges.

## Decided (reversible; my call)
Keep a held question on Today (nothing is lost while the person is away), but word it as held: cardlabel.reasonOf
returns a new `held` reason for a calm held own question, by projects.heldOwnQuestion (the rule every held surface
reads), and the phone's todayWhy says "Held until you are back." (the board's PJ_NEEDS_WHY.held), with no age
(Board.todayWaitingSince). A crash-looping or failed-restart agent keeps its red reason; an asked one stays question.

Order (review 1): a held question has no age on Today, so it sorts with the unknown starts, after every wait that
presses (TodayLogic.today uses todayWaitingSince).

Accepted cost (review 1): a phone built before this change has no "held" in todayWhy, so it words a held question
generally ("Kosmos needs you to look at it.", Open), the documented fallback for a reason it does not know, until it
updates. Rejected: keeping "question" on the wire until the phone can say it understands "held" (a version handshake
for one sentence).

## Rejected
Leaving a held question off Today: the person would have nowhere on the phone's front screen that it still waits.

## Weakest premise
That the phone (iOS, kosmos#7918's lane) is the only Today: the Mac board has no Today view (needsReason is read only
by the phone), measured by grep.

## Tests
server.todayreason-7030 (#7924 arm, real row, red and asked controls; NEEDS_REASONS list), engine/heldq-7915 pin
updated, ios/LogicTests/main.swift (todayWhy has held; a parsed held agent reads held with no age; control).
Every iOS LogicTests runner passes.
