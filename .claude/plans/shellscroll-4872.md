# #4872: the app shell does not scroll or bounce; the folded column's bubble is not cut off

## Finished looks like
In the app window (consolidated view): (1) the red notification bubble on an agent in the FOLDED agents column is
wholly visible; open, it keeps its #3339 place at the row's top-right corner. (2) The outer page cannot be dragged:
nothing overflows (root and body exactly the window tall) and the shell does not bounce. A browser check asserts
both, with controls, in Chromium at four sizes and in WebKit.

## Findings that shaped it
- Bubble: folded, each row fills the 48px strip edge to edge (#3187 follow-up), so the bubble's -6px hang past the
  row corner put it at x 53 on a 48px strip and 2px above it; #alist clips it. Fix: folded only, right 1px, top -2px.
- Scroll: measured in a populated room (members, tasks, posts, new look) at 1024x700 to 1920x1080: the document is
  EXACTLY the window tall, nothing overflows. Josh's scrolled screenshot shows an empty gap below the content, which
  is the Mac's elastic overscroll (it drags a page that cannot scroll). Fix: overscroll-behavior none on the root and
  body, scoped to the consolidated app view (phone and tab views keep their own scrolling).
- A static-page probe showed a 38px overflow, but only because it skipped placeProjectHead (the real open path moves
  the head into the middle column); with it, 0. The check therefore drives the real board.

## Decisions
- Scope the bounce fix to the consolidated view. Rejected: global html/body (would also stop the phone's native
  overscroll feel, which nobody asked about). Weakest premise: that the gap was overscroll, not a real overflow in a
  state the check does not build; the check also asserts no overflow, so a real one would still show.
- Bubble inside the corner over the avatar's top-right (Josh: "move that bubble over more").

## Tests
- docs/browser-checks/render-shell-noscroll-4872.js (gated): per size, the room opens in the consolidated view,
  root and body scrollHeight == clientHeight, overscroll none on both; the bubble drawn by the real dmBadge() on the
  first row lies inside the strip when folded (the real fold button) and keeps -6/-6 when open (measured truly open).
  Reverting either CSS fix fails 5 checks (measured).
