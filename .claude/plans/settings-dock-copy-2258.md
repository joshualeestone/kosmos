# settings-dock-copy-2258 — Settings dock copy, fix the second-instance defect

## Goal
kosmos#2258 (sibling of #2240, found in its blind review): the Settings reveal section
(web/index.html #set-reveal .dockrow) said "Drag it onto the Dock to keep it one click away."
On a fresh install Kosmos auto-opens and is already in the Dock, so "onto the Dock" tells the
person to drag a SECOND copy on, creating two instances. #2240 fixed the same defect on the
first-run Success screen; this is the Settings copy.

## Change (two files, lockstep)
- web/index.html: the .dockrow sentence -> "Kosmos is already in your Dock. Drag it to the far
  left so it stays handy." Mirrors #2240's merged Success wording. Keeps the icon (dockrow-i)
  beside the sentence, which is the #1212 design (the icon is the referent for "it").
- web.dock-icon-1212.test.js: the guard asserted /Drag it onto the Dock/; updated in lockstep to
  /Drag it to the far left/ (the icon-as-referent point is unchanged, only the sentence). Also
  refreshed the test's header comment so it does not describe the old wording (stale-comment hazard).

## Decisions
- Mirror #2240 for consistency across the two dock surfaces, rather than invent new wording.
- Keep the icon-beside-sentence design (#1212); do not remove the icon. "it" now refers to Kosmos
  (named) plus the shown icon, a stronger referent than before.
- Dropped "onto the Dock" entirely (that phrase IS the defect).
- Browser-check gate (#1720): copy-only, no visual/layout change, unit-guarded, so a `Browser-check:`
  trailer excuses it rather than a docs/browser-checks assertion. Trailer is on the commit.
- Weakest premise: that the Settings context wants the same wording as the first-run Success screen.
  It is the same physical action (find the Kosmos icon in the Dock, drag it left), so the wording
  should match; if Josh wants the Settings copy distinct, it is a one-line change.

## Verification
- web.dock-icon-1212.test.js: 4/4 pass with the new copy.
- Swept for other tests asserting the old "Drag it onto the Dock" copy: none (complete fix).
- FULL web suite (tools/run-tests.sh) HELD: the box is reserved for release 0.6.36 until 14:33 CDT;
  will run once the box frees, before PR.

## Not in scope
The first-run Success dock copy (#2240, already merged) and the install flow. This is only the
Settings reveal section copy.
