# shotsdesk-6960: the scrolled summary shot runs at desktop only until #6960 is fixed

Card: kosmos#6960 (the newest post in a held room sits under the composer's held strip on a phone). This branch does
NOT fix #6960; it stops the design-shots screen that found it from failing every phone-size run.

## Decision
`project-room-held-summary-6925` (docs/browser-checks/mobile-shots.js, added by #6925 item 3, PR #6959) gets
`desktopOnly: true`, the flag the tool already has (`sizeSkipWhy`: phone sizes and tablets under 960px skip it, and
the report lists it under Skipped). A comment beside it says why, with the measured failure, and to drop the flag
when #6960 is done.

Rejected: deleting the screen (it is the check that will prove #6960 fixed); weakening its label check (the check is
right, the layout is wrong).

## Proof
A shot run of that screen at desktop and iPhone 15 through the machine queue: the desktop shots are taken and the
phone ones are listed as skipped (desktop-only screen), with no ERROR line. The tool's own tests pass.

## Weakest premise
That nothing else runs this screen at a phone size by another route; `sizeSkipWhy` is the tool's one gate, and the
design-shots skill names its screens.
