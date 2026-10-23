# shotsdesk-6960: the scrolled summary shot scrolls the page, as a person does, so it works at phone sizes

Card: kosmos#6960, closed by Mona Lisa 10-22 with measurements: there is no layout defect. A person CAN scroll the newest
post in a held room clear of the composer, because scrolling over the room at its end carries on into the page. The
failure was this design-shots screen's own scroll.

## Decision
`project-room-held-summary-6925` (docs/browser-checks/mobile-shots.js, from #6925 item 3, PR #6959) scrolls the summary
post into view and then scrolls the PAGE to the end of the room column (`.pjmid`):
`window.scrollTo(0, scrollY + pjmid.bottom - innerHeight)`, which is Mona Lisa's measured recipe (at 393x852 the newest
post then ends at 585, the composer starts at 606). At desktop the page does not scroll, so it is a no-op there. The
earlier scroll-on code (lifting the room's own scroller past whatever covered the label) is removed.

An earlier version of this branch made the screen desktop-only; that was the wrong fix, since the screen was wrong,
not the layout.

Rejected: desktop-only (hides a working phone path); keeping the old scroll-on as well (two scroll paths, one of
which never worked).

## Proof
A shot run of that screen at desktop and iPhone 15 through the machine queue: all shots taken, the label check
(`summaryLabelAt`, before and after the shot) passing at both sizes, and no ERROR line. The tool's own tests pass.

## Weakest premise
That the page scroll is what a person does on every phone engine; measured in chromium only (as the first failure was).
