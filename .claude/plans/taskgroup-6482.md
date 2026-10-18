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

## Review log
### Iteration 1 (sonnet): no BLOCKER or WARNING findings (converged)
- [NIT] title and aria-describedby both carry the text (ACCEPTED: one announcement in practice)
- [NIT] phones have no hover, so on a phone the explanation reaches screen-reader users only (ACCEPTED as the cost of less text; stated on the card)
- [NIT] aria-describedby on a non-focusable h3 is announced unevenly (ACCEPTED: the hidden span sits right after the heading, so a document-order read reaches it; keeping it outside the h3 keeps h3 text equal to the label, which other checks read)
- [NIT] the paragraph margin under the heading is gone (CHECKED in the shots)

## Verified
- render-tasks-view-3559 (headless, queued turn): All checks passed, incl. the new #6482 arm (6 ordinary groups: no visible paragraph, title set, hidden description equal to it).
- web.*.test.js + browser-checks-selectors 2985/2985.
