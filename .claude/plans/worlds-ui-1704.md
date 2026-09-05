# Plan: the multiple-Kosmos switcher UI, list + create (#1704 slice-3)

## Goal / what "finished" looks like

Against Angel's slice 2a (GET/POST /api/worlds, merged), build the list/create UI:
a header switcher beside the K mark showing the active world's name, a menu listing
the person's Kosmoses (active marked), and a "New Kosmos" create modal (POST). Done
when: the switcher shows the active name, the menu lists worlds with one marked active,
the create modal validates and creates a world that then appears in the list, and it all
degrades cleanly on a board with no /api/worlds route.

## Scope (list/create only; switch is slice 2b)

Switching between worlds and the jump-into-the-new-empty-Kosmos both need the active-flip
(slice 2b's POST /api/worlds/active), so the rows here are read-only and only "New Kosmos"
acts. When 2b lands, a row click wires to the switch and create wires to the jump. The
world object from 2a is {id, name, createdAt, base} -- no counts -- so rows show NAME +
active marker; the design-pass "agent-count + project-count" wires in when a per-world
count is available (flagged to Angel on the card).

## Approach (web/index.html)

- A `.worldsw` disclosure in `.headleft` after the K mark: a button (`#worldsw-btn`) showing
  `#worldsw-name`, opening `#worldsw-menu` (`#worldsw-list` rows + a "New Kosmos" item). Hidden
  until the worlds load, and hidden in the consolidated view (a tab-view header element until
  the persistent-header work lands).
- A `.rm-back#world-add-modal` create modal modeled on the note-create form modal: name field,
  the "stay separate from your other Kosmoses" body, Cancel / Create (disabled until a name).
- JS: `worldsFetch` (GET, degrades to hidden on a non-ok/absent route), `worldswRender` (builds
  rows with textContent, never innerHTML, so a world name is never markup), open/close menu
  (click + outside-click + Escape), the create modal (open/close/submit -> POST -> refetch).
- CSS: `.worldsw*` on the shared control radius/separator/elevated-surface tokens.

## Verification

- `docs/browser-checks/render-worlds-switcher-1704.js` (self-booting, own sandbox registry, in
  the runner + indexed): switcher shows the active name; menu lists worlds with exactly one
  active-marked; Create disabled-then-enabled; create closes the modal and the new world
  appears on refetch; switcher hidden in consolidated. 9/9 PASS. Reds on the pre-#1704 page
  (switcher markup absent -> the first wait times out -> exit 1).
- `browser-checks-indexed.test.js` + `tools.browser-checks-wired.test.js`: 9/9.
- No em dashes in any user-facing change.
