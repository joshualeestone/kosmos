# Plan: 0.6.39 #8 - screen-2 Access one-box + ring Allow

## Goal (what "finished" looks like)
First-run screen 2 (Access) shows ONE compact macOS-style file-access prompt
preview with the Allow button ringed, instead of the three vertically-stacked
reproduced dialogs (Documents / Downloads / Desktop). It reads as the single
real prompt the person will see, with the right button called out, so they
click Allow rather than Don't Allow.

## Source of the ask
Josh's 0.6.39 fresh-account test, screen 9.50.20, captured in my #8 spec
(Josh-Brain/Projects/kosmos-0.6.39-install-flow-fix-specs-2026-09-06.md). This is
the last cut-gating design blocker for the 0.6.39 prod-promote (Splinter, 2026-09-06).

## Change (web/index.html, scoped)
- Markup: replace the three `.s2-dlg` cards inside `.s2-dlg-fan` with ONE card:
  a horizontal header (icon + message), then the buttons row.
- Copy (my design call, verbatim in the box): `"Terminal" would like to access
  files in your folders.` App-name quoted to match the real macOS dialog;
  generalized to "your folders" because the single box represents the one prompt
  rather than enumerating three specific folders.
- CSS: `.s2-dlg-fan` centers one card (no overflow fan); `.s2-dlg` is a clean
  compact 320px card (dropped the scale/overlap hack); `.s2-dlg-head` lays icon +
  text horizontally; Allow (`.s2-db.s2-hl`) is the blue macOS default button with a
  gold `::after` ring (the callout).

## Scope boundary (coordinated with Renet)
Touches ONLY the illustrative `.s2-dlg-fan` preview (aria-hidden) and `.s2-dlg`
CSS. The functional `.s2-gate-row` (data-gate="file-access") grant + its Next-gate
poll + frFirePermission wiring are Renet's and are NOT touched or re-anchored (the
gate row still sits immediately after the fan, unmoved). Renet confirmed clear to
take it and asked only to be pinged if the layout re-anchored the gate row; it does
not, so no re-verify is needed.

## Rejected alternatives
- Keep one specific folder ("your Documents folder"): rejected. Collapsing three
  into one is exactly to stop implying specific folders; "your folders" generalizes
  correctly and the box is an illustration (aria-hidden), not a literal reproduction.
- Leave Allow in its old grey `.s2-hl` and only add a ring: the blue default button
  is more faithful to macOS's suggested-button and, with the gold ring, calls Allow
  out unmistakably. My design call (I own #8's design).

## Verification
Hermetic browser-check `docs/browser-checks/render-firstrun-access-onebox.js`
(loads web/index.html over file://, no server), wired into browser-checks.sh +
README; the four meta-guards (wired / indexed / reason-grep / selectors) pass.
Four arms, chromium + webkit: one dialog (was three); verbatim copy + per-folder
copy gone; both buttons; Allow ringed (solid gold `::after`) and blue. PERTURB-
VERIFIED: 6/8 arms red against pre-#8 origin/main (three cards, per-folder copy, no
ring, non-blue), only the buttons arm passes there - so the check can fail and fails
on exactly the pre-change state.

## Visual-fidelity limit (honest)
Verified STRUCTURALLY (computed style) headlessly - one box, correct copy, a gold
solid ring on a blue Allow, both buttons sized. I cannot render the first-run overlay
visually in this session (no Playwright MCP), so the pixel read (does the compact box
sit well in the pane) belongs to Josh's re-cut review or a headed pass. The structure
is right; the aesthetic sign-off is the headed step.

## Weakest premise
That "your folders" is the right generalization vs a specific folder. If Josh prefers
a specific folder or the literal three-line prompt, it is a one-line copy edit; the
structure (one box + ring) is the load-bearing change and is not in question.
