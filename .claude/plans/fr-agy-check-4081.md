# fr-agy-check-4081: a browser check for first run's Gemini subscription step

Card #4081, a #3998 follow-up (round 25 deferred it). The Settings step has render-settings-agy-3874; the same driver in first run's "Choose a model" had only DOM-stub unit tests.

## What finished looks like
- docs/browser-checks/render-firstrun-agy-4081.js runs hermetic (file://, fetch answered in the page) and asserts: Connect offers the choice; Sign in with Subscription checks, then offers Sign in with Google; that press shows the paste box with focus in it, at a usable size, and the link back to Google's page; a stuck sign-in offers Show the sign-in window and hides the box; Stop stops it on the board and returns to the choice; a pasted code goes to the board with the sign-in's id and the step ends on Ready.
- It is in gated.txt, the README index, and the reason-grep counts (measured 181 -> 184 emit sites, 113 -> 115 catch sites).
- No product code changes.

## Found, not fixed here
- After Ready, the step hides and keyboard focus falls to the page (document.activeElement is the body). A small accessibility gap in first run; filed as its own card rather than widening a check-only change.
