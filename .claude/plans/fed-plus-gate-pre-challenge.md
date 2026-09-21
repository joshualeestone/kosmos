---
pre_challenge: true
method: challenge-loop
branch: fed-plus-gate
diff_hash: 9358604f5038aa3b684ea41ba7488c78ecf08742b88b1c197ffc8f11abf64661
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T13:00:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (blind review of the consumer, no blockers; wiring ICK's kosmos_plus
contract; a self-caught CI-index reconciliation; building the PRODUCER side; and an
independent blind review of the producer, no blockers + two warnings addressed).
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

#### Iteration 4 (build the producer -- both ends now)

- **[STRENGTH] the two /api/status fields the gate reads.** Splinter assigned the producer
  (ICK off agent-workforce); ICK's field contracts locked. `engine/remote.js` gains
  `kosmosPlus()` (the cached coordinator standing == "good", cached from the sign-in seam)
  and `server.js`/`api/status` gains `kosmos_plus` (fedKosmosPlusNow) + `federationLive`
  (federationLiveNow, the AGENT_WORKFORCE_FEDERATION_LIVE board flag, default false, left
  false). Both fail-safe (unknown -> false/hidden), both read per-poll and never throw on
  the listen path. Covered by engine/remote-kosmosplus.test.js + a server.test.js addition;
  the "no field the board sends is unknown to the page" contract confirms the page reads both.

#### Iteration 5 (independent blind review of the producer)

A fresh reviewer read the auth-adjacent producer (kosmosPlus, cacheStanding, the sign-in/
forget hooks, the two status helpers) for leaks, status-tick throws, premature flip, and
sign-in regressions. Result: **no blockers.**

- **[BLOCKER, I caught it pre-review] account-switch leak in forget().** forget() rewrote
  settings keeping the old standing, so a signed-out member left `kosmos_plus:true` for the
  next account. Fixed: forget() clears standing. (Found + fixed while building; the review
  confirmed the clear + its test.)
- **[WARNING -> fixed] the inherit-stale-good edge.** The fresh-enrolment seams IGNORED an
  absent standing, so a fresh register whose coordinator response omitted standing could
  inherit a stale 'good' from a prior life. Changed cacheStanding -> fedSetStanding
  (SET-OR-CLEAR): a fresh enrolment writes the coordinator value or '' -- never inherits.
  New test covers it. The leak-closure no longer rests on the coordinator always emitting
  a non-empty standing.
- **[WARNING -> flagged to ICK, not blocking] no post-enrolment refresh.** An enrolled
  board's kosmos_plus is frozen at enrolment-time standing; an UPGRADE (pays after
  enrolling) can't see the feature until re-sign-in (a LAPSE is covered by the fed-route
  403). Asked ICK whether v1 wants a status-poll re-fetch or documents "changes take effect
  on re-sign-in" (a v1 limit like one-Mac-per-account). Fail-safe holds either way, so it
  does not block the merge; it gates only the ideal upgrade UX before the flip.
- **[NIT -> fixed] the federationLive comment** overstated "restart"; clarified per-request
  read vs the production launchd env + one restart.
- **[STRENGTH] non-throwing + default-false verified.** kosmosPlus/read swallow all fs/JSON
  errors to false; fedKosmosPlusNow adds a try/catch belt; federationLiveNow is a pure
  env==='1' compare. Neither status field can throw on the 5s tick; federationLive is only
  ever true for the exact flag.

### Validation
`web.fed-plus-gate.test.js` 5/5; `render-fed-plus-gate.js` 14 arms in real Chromium (incl.
the leak control + the sign-up-routes-to-Plus arm); `engine/remote-kosmosplus.test.js` 7/7
(kosmosPlus fail-safe matrix, the inherit-stale + forget leak edges); `server.test.js` 306/306
(the two /api/status fields boolean + fail-safe + the flip); the full node suite 7968 tests /
0 fail (engine + root); the browser-check surface gate + coarse gate green;
screenshots confirm both the member (create/join toggle) and non-member (sign-up card)
states. One residual dependency, safe by construction: the membership read ENDPOINT (kosmos_plus
on the relay /v1/account/me vs the local /api/status poll) and the federationLive FLIP signal
are pending ICK/engine confirmation (isolated in `fedGateStamp`; fail-safe defaults mean an
unwired signal never opens the fed UI on prod). Pixel + night-mode
QA is Josh's on the cut.
