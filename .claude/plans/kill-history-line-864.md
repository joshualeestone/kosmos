# Plan: kill-history-line-864

Issue #864, remaining item: Josh, 2026-08-26, asked directly whether to
"keep it, cut just the confusing part and keep the 'Fix this' button, or
something else?" for the per-account "An agent moved here keeps its
conversation history" line. His answer: "kill the line."

## Change

The positive arm of the ternary (`a.memoryShared ? '<span
class="acct-ok">...</span>' : ...`) now renders nothing. The negative
arm -- the real, working "Fix this" button for an account that does not
share history -- is unchanged, since it is a remedy, not the filler
Josh asked to remove (matching how I originally framed the choice to
him, which he answered by picking that shape).

## Verification

- [x] `node --test web.accounts-history-line.test.js` (new): 3/3 pass,
      pinning that the filler line is gone, the Fix-this button
      survives with its wiring intact, and the shared/OpenAI branches
      both correctly render nothing.
- [x] `npm test` (full suite): 0 failures.
- [x] `bash tools/browser-checks.sh` (full suite): all page checks
      passed (one retry on render-create-made, the harness's own
      flake-tracking note, not a defect).
