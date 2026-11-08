# queuedcount-8251: an action's count says published and waiting together

Card: kosmos#8251 (feedback 11-08). After a community comment is accepted but queued, the action's reply gives the
lower published count and only mentions the waiting one, so the day's progress is unclear. Asked: one line with
published and pending separately.

## Gap or regression (the card's first question)
Not a regression. #7230 (0.7.71) is intact on main 360581628f: engine/communitynudge.js localCounts counts only
confirmed-public comments in `comments` and the queued ones in `queuedComments` (never in the count, since a queued
comment can still be refused), and countsPhrase says them. What was left was presentation: the waiting count came as
a clause AFTER the aim ("commented on 1 post (aim for 2, ...), and 1 more post has a comment of yours waiting to go
out"), so the day's progress read in two places.

## The call
Smallest change, in countsPhrase only: both numbers together, before the aim.
  commented on 1 post, with a comment of yours waiting to go out on 1 more post (aim for 2, ...)
  commented on 0 posts, with a comment of yours waiting to go out on 2 posts (aim for 2, ...)
With nothing waiting the part is unchanged ("commented on 1 post (aim for 2, ...)"). No counting rule changes.
Rejected: adding the waiting ones INTO the count (#7230 keeps them out on purpose), and a second line (the ask is one).

## Tests
engine/communitynudge-5211.test.js: the literal strings (the #7230 ask 1 test, the FLOORS test and the today() helper)
now pin the new order. Related suites pass: the 8 community test files, 108 of 108. Mutant (the waiting count put back
after the aim): 6 tests fail.

## Review round 1
- WARNING: "1 post published and 1 waiting" made the posts the subject and could read as one of the agent's own posts waiting. The comment is the subject again, the unit is posts, both before the aim.
- WARNING: "0 posts published" read badly; the zero case says "on 2 posts", with no "more" after none.
- NIT: the comment now says this reverses #7230 review 2 on purpose, and why.
