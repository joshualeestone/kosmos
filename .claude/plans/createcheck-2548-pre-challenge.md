---
method: challenge-loop
branch: createcheck-2548
timestamp: 2026-09-09T09:34:37Z
diff_hash: e84f15afb05bb11fc69895338f8adb7ae04b69471e69d83c71bed10fbbd8e15a
---

# Challenge-loop proof: createcheck-2548

Fixes kosmos#2548: two create-flow browser-checks were not fail-closed. No-browser
check-logic fixes; no product or web/index.html change.

## Change under review
- docs/browser-checks/render-create-form.js: add a fail-closed precondition
  (`acctRowHidden !== null`) before the orphan-elbow assertion, so a renamed/removed
  #create-account-row reds the check instead of falling to the ternary's `: true` default.
- docs/browser-checks/render-createnav-2190.js: add the sibling top-level `.catch` so a
  rename reds with a labelled failure instead of an unhandled-rejection crash.
- .claude/plans/createcheck-2548.md (plan).

Diff: 50 insertions, 1 deletion, 3 files.

## Assert-the-effect proof (isolated, against the two assertions)
- missing/renamed row (acctRowHidden null): FAILS now (previously PASS) -- fail-closed.
- hidden row, no elbow (good): PASS -- no false-red.
- hidden row, elbow painted (regression): FAIL -- correct, unchanged.
- shown row: PASS -- correct.
No legitimate state makes acctRowHidden null: #create-account-row is a static element in
web/index.html (line 9259; 6 occurrences), toggled only via .hidden by fillCreateAccounts;
the check waits on #cstep-name before reading, so the element is always in the DOM.

## Validation
- valid JS (node --check) both files.
- 0 em dashes in the change (python byte-safe on added lines).
- full node suite + test:shell (6j).

#### Iteration 1 (Sonnet, blind)
Verified: (1) the precondition truly fail-closes a renamed #create-account-row; (2) NO
false-red -- create-account-row is static markup, only .hidden toggles, and the check
navigates to ?tab=create and waits on #cstep-name + a 500ms settle before reading, so
getElementById never returns null in any legitimate state (zero/one/2+ accounts); (3)
placement is inside the same `for (const engine of ENGINES)` loop / same seen object / same
scope as the other assertions; (4) the Bug 2 .catch byte-matches the sibling shape and does
not double-handle (the inner launch catch exits directly, never reaching the outer catch);
(5) scope clean, node --check passes, 0 dashes.
- No [BLOCKER], no [WARNING], no [NIT]. Verdict: NO NEW FINDINGS - converged.

### Final Ledger
- Iteration 1 (Sonnet): converged, 0 BLOCKER / 0 WARNING / 0 NIT.
Converged in one pass; the effect was proven in isolation upfront (missing row now reds),
and the review's decisive question -- can the precondition false-red in a legitimate
render -- was answered no by confirming the element is static and the check waits for it.
