# cutcheck-fix-2498 — realign two stale cut-time browser checks

## Problem
Two step-3b browser checks (`docs/browser-checks/render-alltasks.js`,
`docs/browser-checks/render-subprojects-1994.js`) failed on BOTH cut boxes
(Agent1s and mortals) during the 0.6.49 staging cut. These are cut-time-only
checks that no PR gate runs, so they drifted stale when two intentional product
changes landed and their own feature PRs did not update them.

## Root cause (measured, per change)
1. **render-alltasks** — #2498 (`7999a114`, Josh's own directive from Ben's
   0.6.48 finding) scoped the project view's "view all tasks" door to the
   CURRENT project. The check still asserted the pre-#2498 global behavior
   (`the rows span BOTH projects`, `seen.projects === 2`). #2498's commit body
   explicitly deferred the live-render check update "to the cut."
2. **render-subprojects-1994** — #2487 (`a9fed0ef`) added a visually-hidden
   `"In "` screen-reader lead-in to the ancestry line. The check's own line 192
   documents that lead-in as correct, and its multi-ancestor sibling assertions
   (177/178/182) use `/Kosmos/` regex that tolerates it. Only the single-parent
   assertion used exact-match `anc.appChain === 'Kosmos'` and got `'In Kosmos'`.

The product is correct in both cases; the checks were stale/brittle.

## Change
- render-alltasks.js: assert the #2498 scoped behavior — exactly one project on
  screen, it is the project we opened (`made[0]`), and the other project's tasks
  (`made[1]`) are absent. Return `projectIds` from the in-page evaluate to make
  those assertions. Comment at the door updated to describe #2498 scoping.
- render-subprojects-1994.js: strip the documented vh `"In "` lead-in, then
  require exactly the one parent name (`=== 'Kosmos'`), which stays distinct
  from a nested chain (`"In Kosmos › App"`). Comment explains the intent.

## Validation
- render-alltasks: run standalone (it self-serves `server.js` over http):
  10/10 PASS, scoping proven (`saw ["alphaproject"]`, `betaproject` excluded;
  document 4 cards vs screen 2).
- render-subprojects: red-capable by construction against the exact observed
  value — old `'In Kosmos' === 'Kosmos'` is false (the failure); new
  `'In Kosmos'.replace(/^In\s+/,'') === 'Kosmos'` is true. Full end-to-end
  validation rides the re-cut's 3b run through the real http harness.

## Scope
Test/check files only, no product code. In the cut-owner lane (cut-time browser
checks are release infrastructure).

## Follow-ups (carded separately, not in this PR)
- render-talk cut-tolerance (its reopen arm needs a live agent; the quiet
  mortals cut box has none — a recorded golden real-card fallback).
- The process gap: put cut-time-only checks on a PR gate, or require a feature
  PR to update the cut-checks it changes, so this cannot recur silently.
