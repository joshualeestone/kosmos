# #3978: device-ask rows keep keyboard focus across the 5-second poll

## Finished looks like
A person who has tabbed to Allow (or Deny, or the notice's Review) keeps focus there through any
number of polls while nothing about the requests changed, and the rows are the same nodes. The
"how long ago" text still updates. A browser check proves it through two real polls.

## Change
- paintAsk writes #ask-rows / #plus-ask-rows through setLive (skips an identical write) via askWrite.
- The two askAgo() texts become askAgoSpan(unix) spans (data-ask-ago); askWrite fills them in place
  after the write, so a minute ticking over no longer changes the rows' markup.
- aria-relevant="additions" on each time span: the tick is quiet inside the polite live regions
  (#askcard, #plus-asks), while a new or changed request is still announced.

## Decided
- Not waiting on #3966's helpers (PR #3985, still open): setLive already exists on main, and the
  span refresh is local to this surface. Rejected: comparing whole markup with times inside, which
  would still rebuild once a minute and drop focus.
- Weakest premise: aria-relevant on a descendant is honoured by the screen readers people use.
  Where it is not, the minute tick is announced (still far quieter than the old 5-second rebuild).
