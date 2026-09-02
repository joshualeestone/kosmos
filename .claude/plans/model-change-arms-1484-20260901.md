# model-change-arms-1484: browser coverage for the switch dialog's one- and zero-account arms

kosmos#1484: the switch-model/provider dialog has four arms; the two-account fixture in
`docs/browser-checks/render-model-change.js` reaches exactly two (a picked row, and
many-untouched). The other two — ONE account and ZERO accounts — are rendered by no browser
check, and both have already shipped false copy:
- one-account arm: fell through to a sentence saying the computer chooses, while the visible
  row was actually being sent.
- zero-account arm: read a page cache (`moveAccountNow` empties it) and said the switch would
  stop, while the engine went ahead.
The source-level regexes in `web.switch-account-1373.test.js` saw the conditions written
correctly through both defects, because a regex inspects an expression, never its use. Only a
rendered check catches this.

Stacked on #1373 (landed as #1601), so the seeding loop and the six sealing points this card's
premise assumed are on main.

## What finished looks like

- `docs/browser-checks/render-model-change.js` gains two assertion blocks, run AFTER every
  two-account assertion (the fixture-home deletions are permanent for the process):
  - ONE sign-in: picker still shows the single row as a real control (opts === 1, has a box);
    the confirm sentence promises the visible row and admits it may have gone, and does NOT
    invite the person to close and pick another (there is no other), nor claim a pick, nor a
    missing-account sentence, nor a computer-chooses sentence.
  - ZERO sign-ins: picker hidden, occupies no space (box === null); the confirm sentence says
    the switch will stop and ask for a sign-in, and does NOT promise a row it cannot show, nor
    a default it does not have, nor hedge a READ-empty list as unread ("if one is set up") or
    unreadable ("could not read the list").
- Each pass reloads the page (a fresh page is the state a person is actually in) and waits on
  the real read signal `ACCOUNTS_LOADED`, not a fixed timeout, so a read-empty list is spoken
  as a fact rather than hedged.
- `docs/browser-checks/README.md` row for `render-model-change.js` updated to name the two
  added arms.

## Verified

Browser-verified both arms 2026-09-01 19:55 CDT on a sandboxed board (fixture homes removed
one at a time, page reloaded between passes): `render-model-change.js` rc=0, no FAIL, and
planted defects made each new assertion go red. web/index.html (the surface under test) is
unchanged since that base, so the verification still holds after the rebase onto current main.

## Not in scope

The dialog copy itself (fixed under #1373/#1601); any app-code change. This branch adds only
the browser CHECK that would have caught the two shipped defects.
