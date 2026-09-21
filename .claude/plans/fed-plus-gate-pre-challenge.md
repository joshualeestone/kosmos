---
pre_challenge: true
method: challenge-loop
branch: fed-plus-gate
diff_hash: 633c4fee0f97450ac71dd3258321b8c237683af86fa74dd3f9eace523607d4f2
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T13:00:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (an independent blind adversarial review found no blockers + one nit;
then wiring ICK's confirmed kosmos_plus contract; then a self-caught CI-index reconciliation).
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

#### Iteration 2 (wire ICK's confirmed entitlement contract)

- **[STRENGTH] membership signal confirmed + wired.** ICK (kosmos-relay fed-plus-gate-3311)
  confirmed the signal is a boolean `kosmos_plus` (== the coordinator's standing == "good"),
  the SAME field the coordinator's own gate reads. Swapped the placeholder `plusEntitled`
  string for the `kosmos_plus` bool in `fedGateMode`/`fedGateStamp` and updated the unit test
  + browser-check to the bool; all still green. Two reads remain to settle (documented, both
  fail-safe): the membership ENDPOINT (kosmos_plus is on the relay's /v1/account/me, the gate
  reads the local /api/status poll) and the federationLive FLIP signal. Absent kosmos_plus ->
  signup (no leak); absent federationLive -> hidden.

#### Iteration 3 (CI-index reconciliation)

- **[BLOCKER, self-caught in CI] removing a browser-check requires updating ALL its indices.**
  The first push went CI-red: the check swap updated the runner list but not (a) the README
  table (asserted by browser-checks-indexed.test.js -- "names every script and no script it
  lacks"; my new README row even re-named the old file in prose, which the parser re-flagged)
  nor (b) the CI DOM-state allowlist in .github/workflows/browser-checks.yml (browser-checks.sh
  FAILS a name that never runs). Fixed both; the full node suite (7960 tests, engine + root)
  and the workflow validator now pass. Root cause: I first ran only web.* + server locally, a
  subset of what CI runs -- re-ran the full `engine/*.test.js *.test.js` set to converge.

### Validation
`web.fed-plus-gate.test.js` 5/5; `render-fed-plus-gate.js` 14 arms green in real Chromium
(incl. the fail-safe leak control and the sign-up-routes-to-Plus arm); full web suite 1519
pass / 0 fail; `server.test.js` 305/305; the browser-check surface gate + coarse gate green;
screenshots confirm both the member (create/join toggle) and non-member (sign-up card)
states. One residual dependency, safe by construction: the membership read ENDPOINT (kosmos_plus
on the relay /v1/account/me vs the local /api/status poll) and the federationLive FLIP signal
are pending ICK/engine confirmation (isolated in `fedGateStamp`; fail-safe defaults mean an
unwired signal never opens the fed UI on prod). Pixel + night-mode
QA is Josh's on the cut.
