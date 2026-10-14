# replyshift-6119: the words on screen stay put when a reply's "further back" line goes away (kosmos#6119)

Written 2026-10-13 21:08 CDT by Ice Cream Kitty. Found by the long-conversation capture owed on kosmos#6086.

## What a person sees today

In a direct conversation, scrolling up loads earlier messages. When the oldest message on screen answers the
message right before it, and that message is in the page about to load, everything on screen moves up one line
(about 28 px) as the page lands. The reply says "Original message is further back" until its original is there;
once the original sits right above it, that line is left out (`dmReplyHead`, the rule a room uses, #3745).

## What changes

- `web/index.html`: the thread's anchor (#1926, `threadAnchor` and `restoreThreadAnchor`) holds where the
  anchored row's WORDS start, not the row's top. `threadRowWordsTop` is that place: under the row's name line and
  its answers-line when it has them, else the top of its bubble's content. A row with no bubble (Kosmos's own
  line) is held by its top, as before.
- `docs/browser-checks/render-dm-earlier-5841.js`: two arms, the reply as the agent's row and as the person's own.

## Why this and not the other two

- Rejected, keeping the line's room when the original arrives (my first lean on the card): it needs the thread
  to remember which rows used to show the line, state that a repaint would have to carry, for one case.
- Rejected, holding the row after the one in view: a change at the BOTTOM of the first row (a picture, a link's
  preview) would then move its top instead.
- Holding the words needs no state, and covers a line above the ANCHORED row's words coming or going between two
  paints. When nothing above the words changed, the place held is the same distance from the row's top before
  and after, so nothing else moves.

## What it does not fix (review 1 measured this)

Only the anchored row is held. If the TWO oldest messages on screen both answer the same message in the page
about to load, both say "further back" and both lose the line when it lands. The first is the anchor and its
words stay; the second is in view under it, and everything under the second still moves up one line. I am not
fixing that here: a line that is on screen and goes away has to move something on screen, and with two of them
no one place can be held that keeps all the words still. It needs two replies in a row to one message, with
that message exactly one page back.

## Measured

- The unit tests that lift these functions (`web.talk-scroll-1926.test.js`): 5 pass, one of them new (a header
  line leaving the anchored row; with the restore put back to the row's top, that one fails and the other 4 pass).
  My first commit left this file red: it lifts the anchor functions by name and did not lift the new one. Review
  1 ran it; I had only run the two files whose names I guessed. All four test files that touch `setThread` or
  the anchor: 34 pass.

- The committed check on this branch: 48 passed, 0 failed. The SAME file against main's page (the fix absent):
  46 passed, 2 failed, and the two are the new arms (the message under the reply moved 29 px and 28 px).
- The one-off capture (700 messages, pictures, pages of 200, mouse wheel, 1440x900, headless): on 0.7.47 the view
  moved 27.5 px at each page boundary that had such a reply; on this branch it held within 0.5 px, both fixtures.

## Not measured

- A phone, and touch scrolling. The capture's phone run did not work (the wheel never reached the thread).
- (Corrected after review 1: I wrote that `setThread` serves a project room too. It does not. All its callers
  pass the direct conversation's thread; a room paints through `paintRoom` and never reaches this code.)
- A header that GROWS while it is in view (a name wrapping to a second line, a "further back" line appearing):
  the words are held, so the header moves up by what it grew. Reasoned, not driven.
- A thread inside something scaled (a CSS zoom or transform). The place held adds a row's `offsetTop`, which
  ignores scale, to a difference of two measured rectangles, which does not. Nothing above the thread is scaled
  today (review 2 looked and found none); under a scale the hold would be off by the scale times the change.
- The unit test's fake row ignores the selector and gives zero margins and padding, so it pins the choice (words,
  not the row's top) and nothing about how the words' start is found. That part is the browser arms' alone.
- One run of each arm.

## Weakest premise

That the words' start is always the right thing to hold. If the anchored row is tall and only its lower part is
in view, a change in its header moves nothing visible either way, so the two rules agree. If its header is in
view and grows (a name line appearing), holding the words pushes the header up out of view by that much. I think
that is still what a reader wants. What would change my mind: a case where the header is the thing being read.
