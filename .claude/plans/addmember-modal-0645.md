# Plan: add-member-to-project modal polish (Josh 0.6.45 notes, items 4+5)

## Goal (what will be true when done)
The "Add a member" modal on the project page:
- closes with an **X in the top-right corner** (not a Cancel button crowding the dropdown),
- has **space** between "Who should join this project?" and the dropdown,
- the go button reads **"Add to project"** (was "Put it on this project"),
- **closes on a successful add** instead of lingering on the "everyone is already
  on it" empty state.

## Why
Josh's 0.6.45 fresh-install notes (posted 2026-09-07), items 4 and 5, routed to me
by Splinter (frontend/build; Mona owns the final copy strings). Item 4: the Cancel
overlapped the dropdown and is ugly, the label touches the menu, and "Put it on
this project" should be "Add to project". Item 5: after adding, the modal blipped
to "every agent we can see is already on it" ("terrible English") -- it should just
close.

## Scope / the design-build split
BUILD is mine (X-close mechanics, layout/spacing, close-on-add wiring, the button
text as Josh stated it). COPY is Mona's per Splinter's routing: the exact "Add to
project" wording and rewording the "everyone is already on it" empty state are hers
to finalize. I used Josh's exact words as the build; close-on-add means the normal
flow no longer shows the empty-state string at all, so its reword is not blocking.

## Design
- **HTML**: replace the `.rm-acts` Cancel with a corner `<button class="am-x"
  id="am-keep" aria-label="Close">×</button>` (reusing the `am-keep` id keeps
  amClose -- the shared Cancel/backdrop/Escape close -- one function). Button text
  -> "Add to project". A scoped `#am-modal .flabel` margin spaces the label.
- **JS**: `addMemberToProject` returns a success boolean; the modal's Go handler
  calls `amClose()` on true. The shared settings-door caller (a second caller)
  ignores the return, so its behaviour is unchanged.
- **CSS**: `.am-x` positioned absolute in the box's corner, scoped `#am-modal .rm-box`
  is `position: relative`. Theme-safe tokens only.

## Verification
- `docs/browser-checks/render-member-modal.js` extended: the corner-X closes, the
  go button reads "Add to project", no Cancel text, and close-on-add actually adds
  the member (Mikey shows in Project Members) in the real board. 16/16 pass.
- `web.modal-exit-1438.test.js`: the "every modal has a way out" guard generalized
  to recognise a corner close-X (an aria-label="Close" × button) as a way out --
  it still catches a genuinely stuck modal (a lone primary "Quit"), but accepts
  am-modal's new X. The synthetic DEAD/PRECISION arms still pass.
- `web.modal-way-out-1316.test.js`: unaffected (the Escape handler is unchanged).

## What I rejected / weakest premise
- Rejected rewording the "everyone is already on it" empty-state string -- that is
  Mona's copy call; close-on-add already removes it from the normal flow.
- Weakest premise: that "Add to project" is the final copy. Mitigated: it is Josh's
  exact word from the notes, and Mona finalizes copy per the routing.
