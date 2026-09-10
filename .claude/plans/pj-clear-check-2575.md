# Plan: served click-verify browser-check for the #2575 "Not waiting? Clear it" dismiss button

Branch: `pj-clear-check-2575`  ·  Card: kosmos#2575 (STATE half)  ·  Author: renettilley (night shift 2026-09-10)

## Why this exists

kosmos#2575's STATE half shipped as PR #2591 (mine): the project-page
"Not waiting? Clear it" button (`#pj-question-clear`) that clears a stale
`needs_you` through Pete's engine route `POST /api/agent/<name>/clear-selfreport`
and re-reads the thread so the question comes off screen.

That PR merged with node coverage (`web.pj-clear-state-2575.test.js`), but that
test LIFTS `pjClearState` and drives it against stubs - it never exercises the
served integration: the button actually rendering inside a painted `#pj-question`
block, being reachable (not `inert`/covered), the real click-listener binding
(`web/index.html:39107`) invoking `pjClearState`, and the paint→click→`loadThread`
re-read actually taking the question OFF screen. My own disposition comment on
#2575 named this exact gap as the weakest premise:

> "a runtime wiring or auth-cookie fault would not show up in the node test.
>  That is why the remaining gate is needs-browser and not done."

Per `docs/browser-checks/README.md` (#1769 correction), a committed headless
browser-check runs from ANY session including a bot session, needs no MCP and no
operator, and is the sanctioned way to close a needs-browser served-verify:
"Write the check; do not ship a frontend change unverified for want of a tool you
already have." This adds that check. It does NOT close #2575's needs-OPERATOR
half (Josh's live prod verify) - that stands.

## Approach

New check `docs/browser-checks/render-pj-clear-2575.js`, modelled on
`render-projects-map.js` (file:// load + inject page globals in `page.evaluate`)
and `render-talk.js` (override `window.fetch` in `addInitScript`, record posts,
refuse the 5s poll interval), plus `render-found-undo.js`'s route-call counting.
No board boot (file://), so no `EXPECTED_BOOTS`/`boot_board`/`pick_ports` change.

### The real body shape (matched to `paintThread`, not hand-rolled)

A REPORTED needs_you (the Priya-Raman case #2575 was filed about) is the thread
body `paintThread` consumes:
`{ ok:true, asking:true, agent:{sessionName:'Mara'}, question:{text:'...', reported:true}, messages:[], viewport:{text:null} }`.
`paintThread` then sets `PJ_QUESTION_AGENT='Mara'` and un-hides `#pj-question`
with the button inside it.

### Scenarios (each assertion measured in-page, with an internal red-capable contrast)

1. **Paint + reachability.** Inject a project (`defaultAgent:'Mara'`, one member),
   set `PJ_CURRENT`, stub the thread route to the reported-needs_you body, run the
   real `loadThread()`. Assert `#pj-question` visible, `#pj-question-clear` present
   with text "Not waiting? Clear it", REACHABLE via `elementFromPoint` (the
   render-talk `inert` lesson - a screenshot can't show a button nothing can
   click), and `PJ_QUESTION_AGENT === 'Mara'`.
2. **Success click clears + question off screen (persists).** Stub
   `POST /api/agent/Mara/clear-selfreport` → `{ok:true,cleared:true}` and make the
   thread stub STATEFUL (asking:false after the clear). Real
   `page.click('#pj-question-clear')`. Assert: the clear route was hit exactly once
   with `method:POST` and body `{reason:'operator-dismissed'}`; after the re-read
   `#pj-question` is hidden; `PJ_QUESTION_AGENT` null; no error line; button
   re-enabled. Re-run `loadThread()` (simulated reload) → question STAYS hidden.
3. **Failure contrast (the red-capable arm).** Stub the clear route →
   `{ok:false}`. Real click. Assert `#pj-question` STAYS visible, the error line
   `#pj-question-clear-msg` shows /could not clear/, `loadThread` was NOT called
   again, button re-enabled. This internal contrast (success hides, failure keeps)
   catches a regression that always-hides or never-hides - coverage AND direction.

The route-persistence itself is engine-tested (Pete's #2586 + the node test); this
check owns the FRONTEND wiring only, which is the gap.

## Guards to reconcile (all up front - memory: reference-browser-check-wiring-guards)

1. `tools.browser-checks-wired.test.js` - add a `run_one`/stem-list entry to
   `tools/browser-checks.sh` (file://, no board). No `EXPECTED_BOOTS` change.
2. `browser-checks-indexed.test.js` - add a `` `render-pj-clear-2575.js` `` row to
   `docs/browser-checks/README.md`.
3. `browser-checks-selectors.test.js` - ids used (`pj-question`,
   `pj-question-clear`, `pj-question-clear-msg`, `firstrun`, projects tab) all
   exist in `web/index.html` - verified.
4. `browser-checks-reason-grep.test.js` - use the ternary `check()` emit shape
   (not a counted SHAPE-1 site). If the launch-catch adds a counted site, bump
   `EXPECTED_SITES` by the measured delta with a `// +N` comment. Reconciled by
   running the guard, not guessed.

## Verification

- Run headless locally via `NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-pj-clear-2575.js` → all PASS.
- Prove red-capable: perturb (unbind the listener / break the id) and confirm it
  RED; restore from buffer (memory: restore-from-the-buffer-not-from-git).
- Run all four guard node tests green.
- Run the existing `web.pj-clear-state-2575.test.js` - no regression.
- CI is billing-blocked account-wide (Splinter 2026-09-10); take to
  challenge-loop-converged + PR-ready, do not block on green.

## Weakest premise (named)

A file:// + mocked-route check exercises the real page script, the real listener,
and the real `pjClearState`/`paintThread`/`loadThread` wiring - but NOT the served
CUT packaging or a prod auth-cookie path. It reduces #2575's needs-browser
residual to those, and #2575's needs-operator (Josh prod verify) is untouched.
Stated on the card.
