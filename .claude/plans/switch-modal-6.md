# switch-modal-6 - confirm modal for switching Kosmos (Josh 0.6.42 re-test #6)

## The requirement (Josh, verbatim intent)

On the 0.6.42 fresh-macOS re-test, switching between multiple Kosmos worlds was wrong:
clicking a world in the switcher switched inline and dropped a quiet message
("Switched to Home. Restart Kosmos to finish switching (run kosmos restart...)").
Josh wants switching to be an explicit, confirmed action:

- Clicking a Kosmos row pops a MODAL, not an inline line.
- The modal title is Josh-verbatim: "Restart Kosmos in order to switch to a different
  Kosmos <name>" - one line, no reassurance copy.
- The modal's primary button reads "Restart Kosmos" and AUTO-restarts Kosmos (the board
  self-restarts onto the new world when it can), rather than telling the person to run a
  CLI command.
- Any remaining "run kosmos restart" CLI instruction is scrapped; where the board cannot
  self-restart, the guidance is the gentle GUI action "Quit and reopen Kosmos".

## What this branch does

In `web/index.html`:

- A row click now calls `worldswConfirmSwitch(id, name)` (was: inline switch), which opens
  `#world-switch-modal` (a `.rm-back`/`.rm-box` alertdialog, `aria-modal="true"`,
  `aria-labelledby` the Josh-verbatim title) and focuses the Cancel button (a reflexive
  Enter cancels rather than restarting; switching is a deliberate act, per #6).
- `worldswSwitchGo` runs the real switch (`worldswSwitch`), which posts
  `/api/worlds/active` and, on `restarting:true`, reconnects and reloads; on a from-source
  board it shows the softened "Quit and reopen Kosmos" guidance; a no-op says already-active.
- `worldswSwitchCancel` (Cancel button, backdrop click, Escape) closes the modal without
  switching and leaves the switcher menu open.
- The switcher menu is left OPEN behind the modal so `worldswSwitch`'s `#worldsw-restart`
  status banner (nested inside the menu) is visible once the modal closes. The modal is
  excluded from the switcher's outside-click handler so clicking its buttons does not run
  `worldswClose()` mid-switch (see the challenge-loop iteration-2 BLOCKER).
- The switch modal is in the Tab focus-trap table (it declares `aria-modal`).
- All three "run kosmos restart" CLI strings softened to "Quit and reopen Kosmos".

## Tests / guards

- `web.modal-way-out-1316.test.js`: the switch modal joins the modal sweep (count ceiling
  raised, Escape-table entry for `world-switch-modal`).
- `docs/browser-checks/render-worldswitch-2238.js`: scenario G drives the real modal - it
  appears on a row click with the Josh-verbatim title and does NOT switch on open; Cancel
  does not switch and leaves the menu open; "Restart Kosmos" runs the switch and the
  `#worldsw-restart` banner SURVIVES the click (the regression guard). Verified the guard
  reds without the outside-click exclusion and greens with it.

## Decisions / rejected

- Kept #6 as its own branch/PR, not stacked on #4 - it is a real flow change (modal +
  restart path), not a copy tweak.
- Chose to EXCLUDE the modal from the outside-click handler rather than move the modal
  inside `#worldsw` or re-open the menu in `worldswSwitchGo`: the exclusion is the smallest
  change, keeps the modal in its natural place with the other world modals, and fixes both
  the lost-banner BLOCKER and the Cancel-parity WARNING in one line.
- Added a Tab focus-trap for this new aria-modal element (matching the trapped sibling
  `world-add-modal`). The pre-existing `world-rename-modal` trap gap is out of #6 scope and
  left for a separate card rather than expanding this diff.

## Weakest premise

The banner-survival guard is exercised in a hermetic browser check with a stubbed board;
it proves the DOM/event wiring, not a real macOS self-restart. The self-restart paths
themselves are covered by the pre-existing scenarios A-F (restarting/manual/no-op/stuck).

Relates to #1704 (world modals) and #2238 (the switch/restart mechanism).
