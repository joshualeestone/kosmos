# tiles-6649: no Idle or Waiting tile on the Agents page (kosmos#6649)

**Ruling.** Josh, 2026-10-19 19:32 CDT, #admin, verbatim: "lets not show the IDLE or the WAITING tiles on windows or mac".
Filed by Splinter as #6649 and claimed for me. The row keeps Agents, Working, Issue and Messages.

**Done when.** The Agents page stats row never shows an Idle or a Waiting tile, on a fleet that has idle and blocked
agents, on desktop and phone widths, in both browser engines; nothing writes the removed ids; the tests that pinned the
two tiles now pin their absence, each shown red by putting a tile or a write back.

## Change
- `web/index.html`: remove the Idle tile (`#st-idle`) and the Waiting tile (`#st-blocked-tile`, `#st-blocked`, #5540)
  from the markup, their writes in the tick painter, and their "?" writes on a failed poll. A comment at the row records
  the ruling. Working, Issue, Messages and the Agents total are untouched (`stateFloor` still floors Working).
- Shared web code: one change covers Mac and Windows (Windows picks it up on its next cut).

## Tests
- `server.test.js` "the stats tiles count the real fleet": the stub keeps the old ids (the #653 Not-running pattern), and
  asserts the painter leaves them untouched on four fleets including idle and blocked agents; asserts the markup holds
  neither id (CONTROL: `#st-working-tile` is found). Shown red by re-adding an Idle write, and separately by re-adding an
  Idle tile to the markup.
- `server.test.js` "a failed poll blanks the stats tiles": the removed ids stay seeded ('4', '2', hidden) and must be
  left exactly so; shown red by re-adding the Idle "?" write.
- `release/whats-new-pool.json`: "The home row counts waiting agents" (pending since 0.7.33) is set `held` with the
  reason, so no What's New line promises the removed tile.
- `docs/browser-checks/README.md`: the render-workchip row describes the #6649 absence arm.
- `web.not-running.test.js`: the floor test reads only Working now; its CONTROL looks for the Working write.
- Browser checks `render-workchip-zero-2157.js` and `render-not-running.js`: the #5540 Waiting arms become an absence
  check read by the row's labels (not by the removed ids), with Working / Agents as the control. render-workchip shown
  red in both engines by re-adding an Idle tile.

## Checked by hand
Desktop 1440 and phone 390, fleet with 2 working, 2 idle, 2 blocked, 1 needs you: the row reads Agents, Working, Issue;
no horizontal scroll; no page errors. Shots: ~/work/design-shots/kosmos-6649/ (desktop, phone, before-desktop).

## Not changed, on purpose
- The `.astate.st-idle` pill class on agent cards is a card state style, not the tile; the cards still say Idle and
  Waiting.
- The `.rest` / `.pause` glyph CSS may now be unused by the row; left in place (the card pill uses `.pause`).

**Weakest premise.** That nothing outside these files clicks or keys to the removed tiles. Searched every test, browser
check and the page for `st-idle`, `st-blocked`, `data-count="idle"` and `.stat` handlers: the only `.stat` lookups are
`st-agents`' own tile.
