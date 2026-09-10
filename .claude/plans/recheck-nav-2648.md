# Plan: #2648 — first-run permissions screen, move "Check again" into the bottom nav + copy edits

Source: Josh, product review in #chaoskosmos-design (2026-09-10, 2 screenshots), on the first-run
energy + accessibility permissions screen (`#fr-pane-3`, namespace `s3-*`; code seams `s3-recheck` /
`fr-recheck` in `web/index.html`). Night-shift card build (Baron); this plan is written to document
the approach (the build predated a `/pplan` interview).

## What Josh asked for (verbatim, 5 items)

1. Visibility bug: on first load, before the connection is finished, the "This can take a few
   seconds..." copy and the "Check again" button were not visible at the moment a person needed
   them (the recheck affordance was effectively invisible).
2. Move the [Check Again] button down into the bottom navigation panel, into the same area as the
   Next button, on the far left.
3. Keep the copy next to it in its new spot, shortened to: "Turned it on? Tap to check."
4. Delete the text: "This can take a few seconds after you flip the switch."
5. Change the top copy to: "To get the most out of your agents we need to ensure they can stay
   awake and access the computer."

## Approach

- **#2 + #1 together:** move the recheck out of the pane body and into the shared bottom-nav
  far-left alt slot (`#fr-alt`) via the `frActions(primary, alt)` shell function, wiring the
  alt's `go` to the same `frRecheckGates` logic (with the error-preserving "Checking..."
  feedback) the removed in-pane `.fr-recheck` handler had. Because the nav footer is always on
  screen, this inherently fixes #1 (the in-pane row sat below the fold on first load).
- **#3:** the relocated hint rides beside `#fr-alt` via a new optional `frActions` `alt.hint`,
  rendered into a new `#fr-alt-hint` span. `setAltHint` resets the span on every `frActions`
  paint (both the null-primary and primary branches) so a step-3 hint cannot leak into another
  step's shared footer.
- **#4:** delete the `.s3-recheck-note`.
- **#5:** replace the top copy line (Josh's verbatim wording).
- Remove the now-dead in-pane `.s3-recheck` markup, CSS, and delegated handler.

## Ownership / review

The nav-shell + gating half (the `frActions` nav-alt, the `#fr-alt-hint` span, the recheck
relocation on step 3, and the first-load visibility) is Renet Tilley's flow-shell/gating lane.
She agreed to review that half on the PR; copy strings (#3/#4/#5) are Josh's verbatim wording
(Mona Lisa's copy lane, but dictated by Josh here).

## Tests

- `web.firstrun-a11y-1214.test.js`: assert the new nav placement, the shortened hint, the
  `frRecheckGates` wiring, and negatively assert the in-pane button + deleted note are gone
  (red-capable on the old design). The em-dash house-rule guard is extended to the moved copy
  (the copy left the S3-slice the old guard scanned), with a non-vacuity assertion.
- `web.firstrun-fractions-1835.test.js`: cover `frActions` rendering the hint and resetting it
  (leak-prevention across steps).
- `docs/browser-checks/render-gated-next.js`: drive `#fr-alt` and assert the hint on step 3.

## Not doing (deferred)

- `aria-describedby` associating `#fr-alt-hint` with `#fr-alt`: a pre-existing gap (the old
  in-pane hint was also unassociated), not a regression from this move; flagged as a follow-up
  candidate rather than expanding the shared-shell change beyond Josh's ask.
