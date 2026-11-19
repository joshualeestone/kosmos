# actwrap-8731: the task activity row wraps a long unbroken token (kosmos#8731)

## Problem
On a task page, `.tkact .tkact-what` had `overflow-wrap: normal`. One unbroken token (a long path, a URL with a
query) in a check report or message ran off the page. Measured on served 0.8.10: scrollWidth 2539 in a 689px row.
The check row (`.why`) already wraps anywhere.

## Change
- web/index.html: `overflow-wrap: anywhere` on `.tkact .tkact-what` (one line, single-line rule kept).
- web.task-activity-wrap-8731.test.js: pins the winning rule via test-support/cascade.
- docs/browser-checks/render-tasks.js: sends a message with a 300-character token and asserts its activity row is
  no wider than its box.

## Proof (both arms)
- static test: green with the fix, red with it removed.
- render-tasks.js: rc 0 with the fix; rc 1 without ("scrollW 2143, clientW 361").

## Rejected
`word-break: break-all`: it breaks ordinary words mid-word too.

## Weakest premise
`.tkact-what` carries every activity line, not only check reports. `anywhere` only changes a line that would
otherwise overflow, so ordinary lines are unchanged; the existing render-tasks assertions on activity text still pass.
