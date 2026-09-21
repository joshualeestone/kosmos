---
pre_challenge: true
method: challenge-loop
branch: fed-plus-gate
diff_hash: 7738bc99b7e30c8bfb8a781a3ae8fbbee927a2f1c7fc5a574bbe4211432dfd28
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T13:00:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (one independent blind adversarial review of the full diff by a fresh
reviewer with no anchoring on the author's reasoning; one nit fixed, no blockers).
**Converged:** Yes.
**Net:** the federation UI launches as a Kosmos+ feature. A member on a live channel sees
the fed UI; a non-member / not-logged-in viewer gets a working "sign up for Kosmos+"
prompt; before the coordinated flip prod shows nothing. Ready-to-flip, not flipped.

#### Iteration 1 (independent blind review — LAUNCH-CRITICAL, app-deep rigor)

A separate reviewer read the real gate JS, the CSS rules, the full markup insertion, the
toggling JS, the removed #3330 gate, the unit test, and the browser-check, aimed at five
adversarial questions in priority order. Result: **no blockers.**

- **[STRENGTH] No LEAK (priority 1).** `fedGateMode` fails closed in every non-member /
  unknown case on a live prod: `('prod', true, undefined|null|''|'garbage'|'none')` all
  return `'signup'`, never `'show'`; only the exact `plusEntitled === 'member'` yields the
  fed UI. Even a future engine field-name/type mismatch (a boolean, a wrong key) fails
  toward `'signup'` (members wrongly denied), never toward a leak. The CSS gate uses
  `display:none !important` and the toggling JS (`pjSetAddMode`/`pjMintInvite`/
  `pjResetFederation`) only ever sets the `hidden` attribute, never inline `style.display`,
  so the `!important` gate always wins; every fed sub-element is enclosed by one of the
  five gated containers or gated by its own id. Pre-first-tick, `data-fed-ui` is absent so
  both fed UI and prompt are hidden (no flash).
- **[STRENGTH] No premature FLIP (priority 2).** `fedGateMode('prod', undefined, undefined)`
  = `'hidden'` -> the CSS hides both. This is the same visible result as the removed #3330
  gate, and `data.federationLive` is absent today, so merging changes nothing on prod;
  staging still shows the fed UI. The flip is a single later engine-side `federationLive`
  signal Splinter coordinates.
- **[STRENGTH] The sign-up prompt is real (priority 3).** `fedPlusSignupGo` routes in-app
  via `showTab('settings'); settingsGo('plus')` -- no hardcoded domain (verified: no URL
  within the function), no em dashes anywhere in the diff (all five spellings checked, zero
  hits), a discernible-text button, no a11y blocker.
- **[STRENGTH] Tests are non-vacuous (priority 4).** The unit test lifts and runs the REAL
  `fedGateMode` and asserts the fail-safe/ready-to-flip matrix incl. the leak cases; the
  browser-check drives the REAL shipped `fedGateStamp` and reads computed display, and its
  reveal step only ever forces elements MORE visible -- so a JS-logic leak or a
  competing-rule leak both surface as a red arm. The leak arms can genuinely fail.
- **[STRENGTH] Create flow intact (priority 5).** `#pj-plus-signup` is a balanced sibling
  `<div>` between the closed `.pj-mode` fieldset and `#pj-create-mode`; it does not wrap the
  create form or the radio group, and the create/join JS still finds its elements.
- **[NIT] fixed:** the browser-check header claimed the `#pj-add-agent` control "stays shown
  in every arm" while only arm 1 asserts it. Corrected the comment to name arm 1 (the
  assertion itself is sufficient; the doc oversold the coverage). Commit f648775c.

### Validation
`web.fed-plus-gate.test.js` 5/5; `render-fed-plus-gate.js` 14 arms green in real Chromium
(incl. the fail-safe leak control and the sign-up-routes-to-Plus arm); full web suite 1519
pass / 0 fail; `server.test.js` 305/305; the browser-check surface gate + coarse gate green;
screenshots confirm both the member (create/join toggle) and non-member (sign-up card)
states. One residual dependency, safe by construction: the exact `federationLive` /
`plusEntitled` field names are pending ICK/engine confirmation (isolated in `fedGateStamp`;
fail-safe defaults mean an unwired signal never opens the fed UI on prod). Pixel + night-mode
QA is Josh's on the cut.
