---
pre_challenge: true
method: challenge-loop
branch: openai-model-curate-2191
diff_hash: d7db5d70f63f0f71e15e5b9a21d5839dbbfe91702c764ff1c39528aee5544586
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T04:48:30Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 3 WARNINGs, 5 NITs (0 BLOCKERs, 0 CONVENTIONs) + 1 validation-caught stale test
**Fixed:** all 3 WARNINGs + the stale test + 3 NITs | **Deferred/accepted:** 2 NITs (with reasons) | **Asked:** 0

Card: kosmos#2191 — curate the huge OpenAI model list. Change: collapse dated
snapshots to one row per model for DISPLAY, keep a full un-collapsed runnable set
for VALIDATION, and inject the current model into the picker when the collapse
omits it. This loop was unusually productive: a real WARNING in each of the first
three iterations, each a consequence of the collapse touching a coupled path.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 WARNING, 1 NIT
- [WARNING] accountModels output was ALSO the server validation allowlist; collapsing the menu would refuse a genuinely-runnable snapshot id --> FIXED: added chatRunnableIds + runnableKeys; both routes validate against the full set.
- [NIT] the ISO-date regex accepts impossible months/days --> accepted: harmless (an impossible-date id still collapses to its base correctly).

#### Iteration 2
**New findings:** 1 WARNING, 2 NITs
- [WARNING] the route-glue (allowed computation + fail-open + fallback) was untested and duplicated --> FIXED: extracted the shared pure helper runnableAllowlist(got), unit-tested its contract (ok->full set, older-shape fallback, not-ok->null fail-open).
- [NIT] duplicated glue --> FIXED (shared helper). [NIT] localeCompare vs > --> FIXED (plain >, justified).

#### Iteration 3
**New findings:** 1 WARNING, 1 NIT
- [WARNING] the change-model picker computed hasCurrent against the collapsed menu, so a snapshot-pinned agent showed "Let OpenAI choose" and lost its pin --> FIXED: the picker injects + selects the agent's actual current model when the menu omits it (non-destructive); browser-check SNAPSHOT-PINNED arm added.
- [NIT] the GET display route shipped the full runnableKeys to the client --> FIXED: stripped from the display response (validation routes call accountModels directly); guarded by a route test.
- **Validation-caught:** the iter-3 picker change superseded web.detail-openai-model-2140.test.js's pre-#2191 "current-not-in-list -> auto" assertion --> FIXED: updated to the collapse behavior, preserving the "never a wrong pre-select" intent.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
- [NIT] the injected row shows the raw snapshot id, not prettyOpenaiLabel-cased --> ACCEPTED, not applied: the reviewer noted the raw id is arguably clearer for a snapshot, and a client-side prettify would risk drifting from the engine's prettyOpenaiLabel.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | server.js/openaiaccounts.js | collapse narrowed the validation allowlist | FIXED (runnableKeys) |
| 2 | 1 | NIT | openaiaccounts.js | loose ISO-date regex | ACCEPTED (harmless) |
| 3 | 2 | WARNING | server.js | route-glue untested + duplicated | FIXED (runnableAllowlist + tests) |
| 4 | 2 | NIT | server.js | duplicated glue | FIXED |
| 5 | 2 | NIT | openaiaccounts.js | localeCompare vs > | FIXED |
| 6 | 3 | WARNING | web/index.html | picker showed wrong current for snapshot-pinned agent | FIXED (inject + browser arm) |
| 7 | 3 | NIT | server.js | runnableKeys shipped to client | FIXED (stripped + guarded) |
| 8 | 3 | (validation) | web.detail-openai-model-2140.test.js | stale test superseded by the picker change | FIXED |
| 9 | 4 | NIT | web/index.html | injected label not prettified | ACCEPTED (reason) |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Display-vs-validation split is clean: curation narrows the DISPLAY, never the runnable set; a stored snapshot id still validates end-to-end.
- #1026 never-synthesize invariant upheld and directly tested (alias only when listed, else newest real snapshot).
- Fail-open (#1916) preserved through the shared runnableAllowlist (null on not-ok).
- Picker injection is non-destructive, cannot duplicate, no XSS (esc()).
- Tests + browser arm discriminate (over-collapse-to-zero control, fail-open null arms, snapshot-pinned browser arm).

### Validation
Full `yarn`/npm test sequence green on the converged HEAD (node --test: 4511 pass / 0 fail), guard test green (no contention flake), plus the browser check render-detail-openai-model-2140.js run headless with the new SNAPSHOT-PINNED arm. `diff_hash` computed against origin/main (recomputed after adding the plan file).
