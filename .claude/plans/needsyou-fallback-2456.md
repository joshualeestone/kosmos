# Plan: rendered guard for the #2456 reported-question fallback banner

Branch: `needsyou-fallback-2456`  ·  Card: kosmos#2456  ·  Author: renettilley (night shift 2026-09-10)

## Why this exists

kosmos#2456 (Josh 0.6.47 re-test): a Claude agent popped "it needs you" while its
terminal was not obviously waiting. My fix (PR #2493, merged) made the thread paint
fall back to the agent's REPORTED needs_you sentence when the live pane no longer
shows the question, instead of the false "we cannot find the question on its screen
right now." It also made the question label source-aware ("This is what it told us
it needs:" for a reported question vs "This is the part of its screen that asked:"
for a live-pane one).

That shipped with node coverage on the lifted logic, but has NO rendered assertion
- confirmed by grep: no browser-check asserts the reported-question fallback text.
That is the runtime-wiring gap the card's needs-browser park is for. Since the
kosmos app runs `web/index.html` from source (no build step; release bundles just
package it), a file:// rendered check of that source IS the served behavior - the
same #1769 realization that closed #2575 - so this closes the needs-browser gate,
not merely a "local run."

## The four states (project room / paintThread, web/index.html)

`paintThread(body)` renders the question label from the thread route body:

1. **reported question** (`asking:true`, `question:{reported:true}`) -> label ends
   "This is what it told us it needs:".
2. **live question** (`asking:true`, `question:{reported:false}`) -> label ends
   "This is the part of its screen that asked:" (the source-aware contrast to 1).
3. **asking, no question, reported sentence supplied** (`asking:true`,
   `question:null`, `questionBecause:'<reported sentence>'`) -> label shows the
   reported sentence, NOT "we cannot find the question on its screen right now".
   This is the #2456 fix.
4. **asking, no question, nothing reported** (`asking:true`, `question:null`,
   `questionBecause:null`) -> label shows "we cannot find the question on its screen
   right now" (the correct pre-fix fallback; the red-capable CONTRAST to 3).

States 1-vs-2 and 3-vs-4 are the two red-capable contrasts: a regression that
dropped the source-aware label would collapse 1 into 2, and a regression that
ignored `questionBecause` would collapse 3 into 4.

## Approach

New check `docs/browser-checks/render-needsyou-fallback-2456.js`, modelled on
`render-pj-clear-2575.js` (file:// + `addInitScript` fetch stub, inject a project +
member, `openProject`, drive `loadThread` -> `paintThread`). For each of the four
states, re-arm the stubbed thread body, run `loadThread`, and read
`#pj-question-label`'s text. Assert the label matches the state's expected clause
and does NOT match the wrong one (measured in-page, each assertion able to return
the dangerous answer).

## Scope / honest bound

Covers the PROJECT ROOM surface (`paintThread`). The AGENT PAGE (`paintTalk`,
web/index.html ~21548/21570) carries the IDENTICAL strings and branches
(grep-verified: same "told us it needs" / "part of its screen that asked" /
"we cannot find the question" / `questionBecause` text), and its paint is already
driven by `render-talk.js`. A per-surface divergence on the agent page
specifically is the residual; noted as a small follow-up (a focused assertion in
render-talk) if wanted, not built here to keep this check tractable and
independently reviewable.

## Guards to reconcile (memory: reference-browser-check-wiring-guards)

1. `tools.browser-checks-wired.test.js` - add to the `tools/browser-checks.sh` stem
   loop (file://, no board).
2. `browser-checks-indexed.test.js` - add a README index row.
3. `browser-checks-selectors.test.js` - ids used (`pj-question`,
   `pj-question-label`, `pj-question-text`, `firstrun`) all exist - verify.
4. `browser-checks-reason-grep.test.js` - use the ternary `check()` emit shape;
   add the top-level `.catch` (multi-line, like render-restore-dircheck-2615, so it
   is not separately counted). Bump `EXPECTED_CATCH_SITES` by the launch-catch delta
   if the guard reports one; reconcile by running the guard, not guessing.

## Verification

- Run headless via `NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-needsyou-fallback-2456.js` -> all PASS.
- Prove red-capable: perturb paintThread (e.g. force the "cannot find" string) and
  confirm the relevant arm reds; restore from buffer.
- Run the four guard node tests green; run existing `render-talk.js` unaffected.

## Weakest premise (named)

The check covers the project-room paint; it asserts the agent-page paint only by
the identical-source argument, not by driving `paintTalk`. If the two surfaces ever
diverged, this check would not see an agent-page-only regression.
