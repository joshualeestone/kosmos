# taskgroup-6482: Tasks groups show their heading and count only (#6482)

## Finished looks like
On Tasks, each group is its heading and count; the group's explanation is the heading's hover text and a hidden
description a screen reader reads; the cannot-tell decision line (a warning) stays visible; shots retaken.

## Decided
- The cannot-tell line under Needs Your Decision stays visible: it is a warning about now (the agents are
  unreadable), not the same explanation on every visit, which is what the card calls noise.
- Hover via title, screen reader via aria-describedby to a .vh span (the page's visually-hidden utility), one id per
  group key (tsk-why-<key>), unique because each group is drawn once.

## Done
- web/index.html: the group head (tskPaint) per the above.
- docs/browser-checks/render-tasks-view-3559.js: each ordinary group has no visible p.why, a title, and an
  aria-describedby that resolves to a hidden element with the same text.

## Verified
- web.*.test.js + browser-checks-selectors 2985/2985.
