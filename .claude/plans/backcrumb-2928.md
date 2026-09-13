# Plan: back chevron + nesting breadcrumb (#2928)

## Source
Josh 6.59 QA (verbatim): "we killed the back arrow that said 'All Projects.' ... instead ... a simple back chevron at the top left to go back to whatever the prior screen was. Also ... a cookie crumb string so ... 'Project / Subproject / Subsubproject'. We don't have to show it on the actual top area of the dialog box where we're showing it now."

## Design decisions (make-the-call, Josh's ruling)
- **Back chevron target = nesting-based**, not a history stack: a subproject's chevron opens its PARENT project (`openProject(p.parent)`); a top-level project's chevron goes to the projects list (`pjView('list')` / the consolidated list). Rejected a full nav-history stack: none exists on main (no PJ_LAST/prevView/history), "prior screen" is ambiguous for non-drill jumps, and nesting-back is exactly what the breadcrumb visually implies. The chevron is always shown on the project detail.
- **Breadcrumb = full location** `pjAncestry(p).concat([p.name])` joined by " / " (Josh's "Project / Subproject / Subsubproject" includes the current project; #2487's `#pj-one-parent` showed only ANCESTORS with " > ", and Josh wants THAT dialog-top trail retired). Placed top-left beside the chevron.
- **Retire `#pj-one-parent`** (the "In A > B" ancestor trail at ~markup line 10619, filled in paintOneProject ~36899). Replace it with the new `.pj-crumbrow` (chevron + `#pj-crumb`).

## Exact edits (web/index.html on origin/main)
1. **Markup** (replace the #2487 comment + `<p class="pj-one-parent" id="pj-one-parent" hidden></p>` at ~10614-10619, inside `.pjtitle`, before `.pjtitle-row`):
   ```html
   <div class="pj-crumbrow">
     <button class="pj-back" id="pj-back" type="button" aria-label="Back">
       <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
     </button>
     <nav class="pj-crumb" id="pj-crumb" aria-label="Project location"></nav>
   </div>
   ```
2. **CSS** (near .pj-one-parent ~2718; remove or leave the old .pj-one-parent rules harmless):
   `.pj-crumbrow { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; }`
   `.pj-back { background: none; border: 0; padding: 2px; color: var(--k-ink-2); cursor: pointer; display: inline-flex; border-radius: 6px; }`
   `.pj-back:hover { background: var(--k-sunk); color: var(--k-ink); }`
   `.pj-crumb { font-size: .8125rem; color: var(--k-ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
   `.pj-crumb .pj-crumb-sep { opacity: .55; }`
3. **paintOneProject** (replace the `#pj-one-parent` fill block at ~36899): fill `#pj-crumb` with the full chain, and stash the chevron target.
   ```js
   const crumbEl = document.getElementById('pj-crumb');
   if (crumbEl) {
     const chain = pjAncestry(p).concat([p.name]);
     const sep = '<span class="pj-crumb-sep" aria-hidden="true"> / </span>';
     crumbEl.innerHTML = chain.map((n) => esc(n)).join(sep);
   }
   ```
   (No `hidden` toggle: a top-level project still shows its own name as the single crumb.)
4. **Back handler** (add once, near other pj handlers): 
   ```js
   document.getElementById('pj-back').addEventListener('click', () => {
     const p = pjById(PJ_CURRENT);
     if (p && p.parent && pjById(p.parent)) openProject(p.parent);
     else { PJ_CURRENT = null; pjMarkOpen(null); pjView('list'); }
   });
   ```
   (Mirror the list-return shape openProject uses on a missing id: PJ_CURRENT=null; pjMarkOpen(null); pjView('list').)

## Test / gate work (REQUIRED, do not skip)
- **`web.pj-ancestry-2487.test.js`**: UNIT test of the `pjAncestry` FUNCTION only (extracts + evals it). NOT changing pjAncestry, so it stays green. Leave it.
- **`docs/browser-checks/render-subprojects-1994.js`**: declares `// Browser-check-surface: pj-parent pjsub pj-one-subprojects`, and ASSERTS the #2487 parent trail (`pj-parent` token). Retiring `#pj-one-parent` WILL trip the #2518 surface gate on `pj-parent`. Update this check: replace its parent-trail assertion with one that reads `#pj-crumb` and asserts the full "A / B / C" chain (and the chevron `#pj-back` present + clicking it navigates up). Update the surface-token comment (`pj-parent` -> `pj-crumb`/`pj-back`). If any sub-assertion genuinely does not apply, use a `Browser-check-surface: render-subprojects-1994.js <reason>` trailer WITH the .js.
- **#1720 gate**: this web/ change already touches a top-level browser-check (render-subprojects), so satisfied by that touch.
- Grep for any OTHER reader of `#pj-one-parent` / `.pj-one-parent` / `pj-anc-sep` before removing (render-detail-header-1841? render-projects?) and update/trailer each.

## Done-condition
Project detail shows a top-left back chevron (up one nesting level, or to the list at top) and a "Project / Subproject / ..." breadcrumb; the old #pj-one-parent trail is gone; full suite green; CI green.

## Weakest premise
That nesting-based back (not a literal last-screen history) is what Josh means by "prior screen." Mitigated: it matches the breadcrumb, needs no fragile history stack, and is a one-line change if he wants literal history later.

## Challenge-loop refinements (as-built deviations from the exact edits above)
The exact edits above are the initial design; the challenge loop hardened three points. Recording
the deviations so the plan matches what shipped:
- **Container element: `<p>`, not `<nav aria-label="Project location">`.** A `nav` landmark wrapping
  non-interactive spans (the crumb segments are plain text, not links) presents an EMPTY landmark to
  assistive tech, which the WAI-ARIA breadcrumb pattern reserves for navigable items. A `<p>` reads
  the same chain (the vh commas preserve the spoken separation) without the misleading landmark. The
  aria-label was dropped too: on a non-landmark element it can suppress the crumb text in some AT.
- **Current project is a protected crumb.** The breadcrumb renders `<span class="pj-crumb-lead">`
  (ancestors, carries the ellipsis, `flex: 0 999 auto` so it shrinks first) + a separator + a
  `<span class="pj-crumb-cur">` (current project, `flex: 0 1 auto`). A single overflow:hidden
  container end-truncated the TAIL, i.e. the current project's own name, the one piece a "you are
  here" breadcrumb must show. The lead now absorbs the truncation instead. The separator before the
  current crumb sits OUTSIDE the lead (a `flex: none` child) so hard truncation cannot eat it.
- **Back chevron aria-label names its live target** ("Back to <parent>" / "Back to all projects"),
  set in paintOneProject via setAttribute, rather than a bare static "Back".

## STATUS: code applied and committed on branch backcrumb-2928 (rebased onto current origin/main). Edits 1-4, the test/gate work (render-subprojects-1994.js reads #pj-crumb / #pj-crumb-cur / #pj-crumb-lead, asserts the full ordered chain + the protected-current structure, clicks #pj-back and asserts navigation up/to-list), and web.consolidated-980.test.js count guard (5 -> 6) are all in. Full suite green. Challenge-loop in progress; PR to follow on convergence.
