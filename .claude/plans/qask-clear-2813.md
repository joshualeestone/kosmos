# kosmos#2813: browser-check for the agent-page #d-qask clear/expand controls

## Problem

#2808 shipped the agent-page "waiting on an answer" cleanup: a "Clear this
message" dismiss button (`#d-qask-clear`) and a "Show full command" clamp toggle
(`#d-qask-expand`) on the tall command wall (`#d-qask-text`). It shipped node
runtime coverage (`web.qask-clear-clamp-2808.test.js`, which lifts the two
self-contained click handlers and runs them against stubs) but NOT a browser
check that drives the live DOM. The gap that leaves: runtime REACHABILITY of the
two new controls (the "in the DOM but inert/covered" class the sibling
`render-pj-clear-2575` exists to catch) is not directly asserted.

## The fix

Add `docs/browser-checks/render-qask-clear-2808.js`, mirroring
`render-pj-clear-2575.js` (the same clear-selfreport mechanism) adapted to the
agent page. Hermetic (file://), answers every route from `addInitScript`, drives
`paintTalk` the way `render-talk.js` does (set `CURRENT`, unhide `#panel-detail`,
stub `/api/agent/<name>/thread`). Asserts, with an internal red-capable contrast:

- `#d-qask` paints for an asking thread carrying a long multi-line question.
- `#d-qask-text` gets `.clamped` (the tall wall clamps).
- `#d-qask-expand` is visible + REACHABLE (`elementFromPoint`), reads "Show full
  command", and a click toggles `.expanded` and flips the label to "Show less".
- `#d-qask-clear` is visible + REACHABLE and reads "Clear this message".
- A successful click POSTs `/api/agent/<name>/clear-selfreport` exactly once with
  `{reason:"operator-dismissed"}` and takes the whole box OFF screen (the success
  re-read sees asking:false).
- The red-capable arm: a FAILED clear (`{ok:false}`) LEAVES the box on screen,
  surfaces the could-not-clear line, and re-enables the button.

Not CI-allowlisted (matches render-pj-clear-2575's precedent; runs at the cut).

## Guards reconciled up front (adding a browser-check trips four)

1. `tools.browser-checks-wired.test.js` - added `render-qask-clear-2808` to the
   `for n in` run list in `tools/browser-checks.sh`. No `node ./server.js` boot
   (file:// + stub), so `EXPECTED_BOOTS` is unchanged.
2. `browser-checks-indexed.test.js` - added a `docs/browser-checks/README.md`
   table row `` `render-qask-clear-2808.js` ``.
3. `browser-checks-selectors.test.js` - every `#id` queried
   (`d-qask`, `d-qask-text`, `d-qask-expand`, `d-qask-clear`, `d-qask-clear-msg`,
   `d-talk-box`, `panel-detail`) already exists in `web/index.html`. Free.
4. `browser-checks-reason-grep.test.js` - the ternary `check()` emit is not a
   counted finding-emit SHAPE, so `EXPECTED_SITES` is unchanged by this check.
   The `could not start a browser` launch catch IS a counted catch/launch site,
   so `EXPECTED_CATCH_SITES` bumps by one, exactly as render-pj-clear-2575 did.
   After rebasing onto origin/main (where render-room-busy-scope-2882 landed and
   touched the same three guard files), the reconciled values are
   `EXPECTED_SITES = 100` (main's value; qask adds zero finding-emit sites) and
   `EXPECTED_CATCH_SITES = 71` (main's 70 plus qask's one launch catch).

## Verification

- Run headless via the pw-runtime:
  `NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-qask-clear-2808.js`
- Prove every assertion red-capable by perturbation (restore from the buffer).
- Full node suite green (`bash tools/run-tests.sh`), the four guards included.

## Weakest premise

That the pw-runtime is a faithful stand-in for the cut's headed Playwright for
this check. It drives real chromium headless; the paint/reachability assertions
measure in the page (mode-independent), so they hold in both. Screenshots would
differ headed-vs-headless (SwiftShader vs Metal), but this check takes none.
