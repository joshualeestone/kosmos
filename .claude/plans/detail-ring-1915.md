# Plan: render the memory ring on the agent detail avatar (#1915)

## Goal / what "finished" looks like

On an agent's own detail page, the avatar shows the context/memory ring again, driven
by the same reading the MEMORY panel displays, so the at-a-glance signal lives where a
person looks. Done when: the ring renders around the detail avatar, its arc tracks the
reading, and a test pins the drawn arc (not just the element's existence).

## Context / diagnosis

Josh reported (kosmos#1915, with a screenshot) that the ring around the Splinter2 detail
avatar is gone; the MEMORY panel still shows 30%, so the reading arrives and only the
ring is missing. Measured on main before building:
- Board cards (`.acard`): ring renders via `card()` -> `ring()` -> `.agauge` `.gt/.gf`; CSS intact since 08-17.
- Consolidated rows (`.lrow`): ring renders via `lrowRing()` -> `.lring`; DOM chain `.lrow > .lav > .lring` intact.
- Detail page (`.dhead` > `.dav-wrap` > `.detail-av`): NO ring mechanism, in the code or git history. The avatar is a plain circle + a `.membadge` that hides below 80% + a separate MEMORY panel.

So the board/list rings are fine; the detail avatar is the only ring-less surface, and at
30% (membadge hidden) it is a plain circle. This is the detail surface catching up, not a
shared-markup regression.

## Approach

1. `detailRing(a)` in web/index.html, next to `lrowRing`: same `pctOf(a.context)` reading
   and `memBand(pct)` band as the board rings and the MEMORY panel, drawn as an SVG arc
   (`.gt` track + `.gf {band}` arc, stroke-dasharray = (pct/100) * circumference) sized to
   sit just outside the 88px avatar (R=47 in a 100 viewBox). Unknown (pct null) draws no
   ring, matching `lrowRing`; the `.membadge` unk + MEMORY panel carry unknown.
2. A `#d-ring` element as the first child of `.dav-wrap`, so the avatar + membadge stack above it.
3. `.dring` CSS (absolute, inset -6px so it encircles the 88px avatar) near `.dav-wrap`.
4. One wire line in the detail render (~18110): `getElementById('d-ring').innerHTML = detailRing(a)`.

## Verification

- `web.detail-ring-1915.test.js` executes `detailRing` (deps spliced from the page) and pins:
  the arc GEOMETRY tracks the reading (dashed length = (pct/100) * C), a fuller reading draws a
  longer arc (control), the band class changes at WARM/NEARLY_FULL, unknown draws no ring, and
  the render fills the same `#d-ring` id the markup declares. A node-exists test would pass
  through the regression; this asserts the drawn arc, so it can return the dangerous answer.
- Visual verified on an isolated fixture render (30/70/88% -> green/amber/red arc just outside the avatar).
- The board and consolidated rings were checked and are intact.

## Out of scope / notes

- No live rendered browser check: no bot session on this fleet can drive the app (#1769); the
  commit carries a `Browser-check:` trailer, same path as #1835/#1840, with source coverage + fixture.
- Not touching `renderAvatar`, the membadge, or the MEMORY panel. Angel's held #1885 UI will touch
  the same detail render (~18110) later; whoever lands first, the other rebases (coordinated).
