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
- New docs/browser-checks/render-pj-issue-tile-8592.js (31 assertions, Roadmap and Grid, one/several/none, keyboard,
  the exit link, the flat sub-project, and the Agents tile control). Control: it fails on origin/main's page.
- render-chip-filters-3423.js (Agents tile) still 22 PASS. 72 web unit tests touching the changed functions pass.
- Wiring: README row, gated.txt entry; browser-checks-indexed and tools.browser-checks-wired tests pass.

## Review round 1 (taken)
- A folded parent hid a marked sub-project under the filter: the fold now stands down while the filter is on (tab
  views), carets hide, and the shading counts only the rows shown.
- The filter class reached the consolidated rail, which has no tile to undo it: the filter CSS and the fold stand-down
  are scoped to the tab views.
- The tile's title says "Show all projects" while pressed.

## Final validation and review round 3 (taken)
- The full suite's guards: the new check needed a SITE_COUNTS line and a try around its route handler (#6022).
- server.test.js "the projects tiles DRAW" sliced the tile code from the line this change replaced; it now slices from
  the pjNeedsPerson line, uses the page's own pjNeedsPerson, and also checks the ids the tile keeps for its click.
- The check's "a click opens it" now reads #pj-one-view (the earlier element did not exist, so that half was always true).
- With one project and no filter the tile is not a toggle, so it carries no aria-pressed then (pjAttnTileSync).
- Kept, decided: a failed projects read turns the filter off (pjTilesUnknown), since the tile hides and could not undo it.
