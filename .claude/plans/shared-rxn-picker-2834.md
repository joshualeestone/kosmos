# Plan: #2834 - one shared reaction picker instead of inlining PJ_EMOJI per post

## What finished looks like
A room post's `.rxns` emits only its pills + the hover-gated `.rxn-quick` bar (3
defaults + the grey-smiley `.rxn-more`). The full 80-emoji `PJ_EMOJI` picker is NOT
inlined per post. Instead ONE shared `#rxn-picker` (class `.rxn-picker`, built
lazily, appended to `body`) opens beside whichever post's smiley was clicked,
reacts to that post, and closes. Reactions behave exactly as before (quick default
reacts, smiley opens full picker, pick reacts with count+mine+pressed, toggle-off
round-trips, Escape / outside-click / outside-scroll close, inside-scroll does not,
bottom-post picker is not clipped). The `render-reactions-2255.js` browser-check
verifies all of this against the shared element.

## Why now (premise confirmed against origin/main)
The main checkout was stale; on origin/main `rxnsInner` DOES inline the full
`PJ_EMOJI` (80 buttons) into every post's hidden `.rxn-picker`, so a busy room
carries thousands of hidden buttons and rebuilds that string every poll. The card's
weakest premise ("measure before refactoring") is satisfied: 80 buttons x every post
is self-evidently wasteful DOM + string, and the composer already ships the shared-
picker pattern (`pjEmojiBuild` / `#pj-emoji`) to mirror, so the fix is low-design-risk.

## Changes - web/index.html
1. **`rxnsInner`**: drop the inline `<span class="rxn-picker" hidden>` + its `picks =
   PJ_EMOJI.map(...)`. Emit pills + the `.rxn-quick` bar only.
2. **New shared picker** (mirror `pjEmojiBuild`): `rxnPickerEl()` lazily creates
   `#rxn-picker` (class `.rxn-picker`, hidden), appends it to `body`, and attaches its
   own click handler once; `rxnPickerBuild()` fills it with the `PJ_EMOJI` `.rxn-pick`
   buttons once (guarded by `RXN_PICKER_BUILT`).
3. **Extract `rxnToggle(forProject, box, emoji)`** - the react POST + `repaintReactions`
   - so the room handler (pills + quick defaults) and the shared-picker handler share
   ONE copy (no two-copies drift).
4. **`#pj-room` click handler**: `.rxn-more` now opens the SHARED picker (records the
   post id on `#rxn-picker` via `data-post`, positions via `rxnPositionPicker`,
   toggles). Pills + quick defaults call `rxnToggle`. Full-list picks are no longer
   inside `.rxns`, so they fall through to the shared-picker handler.
5. **Shared-picker click handler**: on a `.rxn-pick`, resolve the target `.rxns` by
   matching `#pj-room .rxns` whose `data-post` equals `#rxn-picker`'s recorded id,
   `rxnToggle`, then `rxnCloseAllPickers()` (repaint no longer auto-closes the shared
   element, so close explicitly).
6. **`rxnCloseAllPickers`**: hide `#rxn-picker` + clear its `data-post`, reset every
   `#pj-room .rxn-more[aria-expanded=true]`.
7. **scroll dismiss**: gate on `#rxn-picker` open (it lives outside `#pj-room` now,
   so the old `room.querySelector('.rxn-picker')` would never find it). Outside-click
   and Escape handlers are unchanged - they key on the `.rxn-picker` class / `.rxn-more`,
   both of which still match.

## Changes - docs/browser-checks/render-reactions-2255.js
Retarget every `box.querySelector('.rxn-picker')` (box = the per-post `.rxns`) to
`document.getElementById('rxn-picker')`, and the picker-pick click locator from
`rxns.locator('.rxn-picker .rxn-pick')` to `p.locator('#rxn-picker .rxn-pick')`. The
`.rxn-more` assertions stay box-scoped (the smiley is still per-post). The initial
"picker starts hidden" arm becomes `!el || el.hidden` (the element is lazy, so absent
== hidden). All interaction arms (open/positioned/visible/react/toggle/Escape/outside/
inside-scroll/outside-scroll) keep their meaning against the shared element.

## Weakest premise
That the shared picker's `data-post` bookkeeping and the outside-`#pj-room` click
handler route a pick to the correct post as reliably as the old in-row picker did. The
browser-check's react + toggle-off arms (count 1 / mine / pressed, then 0 pills) are the
guard that proves the routing on the real page; if they red, the routing is wrong.

## Verification
`node -c` both files; `node --test` the suite (no node/source-slice test references the
reaction markup, so none should move). The `browser-checks.yml` workflow runs on this
PR (it triggers on web/index.html + docs/browser-checks/**) and executes the full
reaction interaction headless - that is the real verification of the shared-picker
routing. Challenge-loop to convergence before the PR.
