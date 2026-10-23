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
A shot run of that screen through the machine queue (10-22 21:54 CDT, throwaway board with the sample data set,
chromium): desktop 1280x800 and iPhone 15 393x852, light and dark, 4 of 4 shots taken, the label check
(`summaryLabelAt`, before and after each shot) passing, no ERROR line; the phone shot shows the label above the held
strip. The tool's own tests pass (27/27). Full validation on Mortals passed at e16b5514de (23388, 0 failed); a first run
failed one release.sh shell test during the 0.7.64 cut, and that test passes alone on this branch.

## Weakest premise
That the page scroll is what a person does on every phone engine. Mona Lisa measured chromium and webkit on #6960; this
screen's run was chromium. And it relies on the summary being the room's newest post (true of the seed): a seed with a
later post would leave the label off screen, which the label check reports loudly rather than passing.
