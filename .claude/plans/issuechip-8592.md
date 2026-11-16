# issuechip-8592: the Projects tab's Issue tile opens the issue (kosmos#8592)

Reported by a tester through Josh, 2026-11-16 15:30 CST; handed to Mona Lisa by Splinter at 15:30.

## Finished looks like
On the Projects tab, clicking "N Issue":
- N = 1: opens that project, the same screen as clicking its card.
- N > 1: shows only the projects that need the person; a second click, Enter, or "View all projects" shows all again.
- The Agents tab's Issue tile behaves as before (control).
Seen working in the app, then the card closes.

## The call (mine) and what I rejected
- The card says "as it already does on the Agents view". Measured: the Agents Issue tile never opens a single agent;
  it always toggles a filter (#3423). So one project opens (the card's ask), several filter (the Agents parity).
- One test, `pjNeedsPerson`, now drives the tile's count, the row marker (data-attn) and the click, so the filter can
  never show a different set than the tile counts. It is the tile's old inline test, moved, unchanged in meaning
  (needsYou > 0 or heldForYou > 0, and nothing while the roster is unreadable).
- A sub-project shown without its parent is laid flat with its "under parent" chip, rather than hanging indented under
  a row that is hidden.
- The filter turns itself off when nothing needs the person (the tile hides, so nothing else could turn it off), and
  under an unreadable roster.
- Rejected: opening the first of several (silently picks one); a new screen listing issues (a second list of the same
  rows); dimming instead of hiding (the Agents org chart dims to keep a tree, but the Projects list loses nothing by
  hiding, and dimming leaves the eye to do the filtering).

## Weakest premise
That opening the project is "opening the issue". The project page shows its members and tasks, but it does not jump
to the specific question or held task. If the tester meant "straight to the question", that is a follow-up.

## Checks
- New docs/browser-checks/render-pj-issue-tile-8592.js (22 assertions, Roadmap and Grid, one/several/none, keyboard,
  the exit link, the flat sub-project, and the Agents tile control). Control: it fails on origin/main's page.
- render-chip-filters-3423.js (Agents tile) still 22 PASS. 72 web unit tests touching the changed functions pass.
- Wiring: README row, gated.txt entry; browser-checks-indexed and tools.browser-checks-wired tests pass.
