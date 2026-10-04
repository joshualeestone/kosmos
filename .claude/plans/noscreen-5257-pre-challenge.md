---
pre_challenge: true
method: challenge-loop
branch: noscreen-5257
diff_hash: 3f3d2e19e7a8993a106fe246e3190d5da0eb95f10c3ae05a825e59c339d6c719
validation: passed (D3: a behaviour-neutral page move + a new node test; every web.* test + guards 2481/2481; browser-check coarse and surface gates pass); full browser checks on the exact head before the after-Monday merge
subdir_audit: passed
timestamp: 2026-10-04T20:19:21Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, fresh blind reviewer)
**Converged:** Yes (CLEAN; 1 NIT taken, 1 NIT kept)
**Fixed:** 1 NIT | **Deferred:** 0 | **Asked (awaiting user):** 0

#5257: a test for the project page's Windows no-screen state (#5249 merged without one).

## Round 1 (sonnet): CLEAN, 2 NITs
- [NIT] the wiring regex would pass on a commented-out call: FIXED, anchored to a line start (m flag).
- [NIT] new Function rebuilt per paint(): kept (a test helper; harmless).
- Checked clean: the move is 6 inserted lines and 0 removed (the block's bytes untouched; it uses only body, name,
  document, pjSetScreen, pjSentence, all top-level); nothing slices paintThread expecting the block; render-thread.js
  reads the ids at runtime; the fake document throws on any other id; controls are real (failed read on a Mac, a
  non-boolean noWindow, no viewport, a captured screen); the card's CONTROL holds; no em dashes.

## Weakest premise
Browser-neutral by construction (bytes unchanged, same arguments); a full browser-check run on the exact head comes
before the merge.

## Baron Draxum's browser arm (cherry-picked as 6fb3a5883)
- docs/browser-checks/render-thread.js section 3b: patches the real thread's viewport. Run on this branch at 6fb3a5883 (Agent1s light lane, 14:12 CDT): all 7 #5257 lines pass (thread really fetched and patched; label; sentence; no "right now" lead; full stop; no empty box; CONTROL unpatched), the whole check RC=0. Baron measured it red (3 FAIL) with the no-window branch removed.
