# Plan: header-checks-2326 — flip two stale cut-gating browser checks to the #2282/#2326 persistent-header behavior

## Problem
The 0.6.55 staging cut went red at step 3b on two of the coordinator/sign-in lane's
browser checks. Both were staled (not regressed) by #2282/#2326 (commit 52aabf36,
"one full-width top header across every view"), which is already merged into main
and is in this cut. The checks still assert the pre-#2282 tab-only-header model.

## Source finding (verified in web/index.html on origin/main)
#2282/#2326 changed the consolidated-view behavior:
- `.headright` and `#worldsw` are NO LONGER hidden in the consolidated view — the
  full-width header persists across every view, so both are VISIBLE in consolidated.
- The rail copies are now hidden in consolidated:
  `html[data-layout="consolidated"] body.consolidated .railme-theme, .railme-lay { display: none }`.
  `#rail-me .laypick` is `.railme-lay` (HTML: `<span class="laypick railme-lay">`), so
  it is display:none in consolidated.
- `.tabs` remains hidden in consolidated.

So in the consolidated view now: header toggle (`.headright .laypick`) VISIBLE,
worlds switcher (`#worldsw`) VISIBLE, `.tabs` hidden, rail copies hidden.

## Changes
1. `docs/browser-checks/render-viewtoggle-header-2154.js`
   - Docblock: replace the "header collapses, rail takes over in consolidated"
     model with the #2282 persistent-header model.
   - Consolidated section (was ~lines 90-124): assert the header toggle is present
     in consolidated (not the rail), header aria state, reload persistence via the
     header, and flip-back from the header. The #2194 rail-order geometry check and
     the flip-back-from-rail are removed because the rail copy is now hidden; the
     header order is already asserted in the tabbed-view section.
   - Tabbed-view section, narrow-window gate, and HEAD/RAIL consts unchanged.
2. `docs/browser-checks/render-worlds-switcher-1704.js`
   - Arm 5: assert `#worldsw` is VISIBLE in the consolidated view (was: hidden).
   - Docstring Arm 5 line and the Arm 5 comment updated to the #2282 behavior.

## Non-vacuity / red-capability
Each flipped assertion still reds on the pre-#2282 page: `visible(HEAD)` reds where
the header collapses in consolidated; `!visible(RAIL)` reds where the rail copy is
shown; `#worldsw` visible reds where the switcher is hidden. So the checks still
catch a regression of #2282, they just now describe the shipped behavior.

## Validation
- `tools/browser-checks.sh` scoped to both checks (KOSMOS_BC_CI_ALLOWLIST), frozen
  from the committed HEAD: both pass, zero FAIL lines.
- Baseline confirmation: the current checks fail on exactly the flipped arms before
  the edit (verified: worlds-switcher Arm 5 FAIL; viewtoggle consolidated FAILs).
- All 18 browser-check meta-tests (reason-grep, indexed, selectors, wired) pass.

## Out of scope
No product code (web/index.html, server.js) changes — this is a test-only flip to
match already-merged behavior.

## Decisions
- Dropped the consolidated rail-order geometry check rather than moving it to the
  header, because the header order is already asserted once in the tabbed-view
  section and the same header element is shown in both views. Rejected: duplicating
  the geometry assertion in consolidated (redundant, no added coverage).
