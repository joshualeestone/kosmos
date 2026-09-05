---
pre_challenge: true
method: challenge-loop
branch: openai-detail-2140
diff_hash: d5f938dfd5e14f3d5f4dd9ba5771c17278733bb5ef61d0dc490f5dc32a9628f8
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T20:13:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 returned zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 3 WARNINGs, 8 NITs
**Fixed:** 1 BLOCKER + 3 WARNINGs + 3 NITs | **Deferred:** 5 NITs | **Asked:** 0

kosmos#2140 Surface 2: the OpenAI model picker on an EXISTING agent's DETAIL page.
New client fn `paintOpenaiDetailModel`; `paintModelPicker` delegates to it before any
Claude rendering for openai/codex agents; `paintProviderPicker` no longer parks the
model row; server `/api/accounts/openai/models` resolves an empty dir to the default
OpenAI account (fail-closed). NEVER a Claude model under an OpenAI agent, in any state.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 0 B/W/C, 2 NITs
- [NIT] Loading phase did not clear #d-model-why (stale hint lingered through the fetch)
  --> FIXED (clears synchronously, mirroring paintOpenaiCreateModel)
- [NIT] delegation predicate broader than providerOf --> noted; see iter3

#### Iteration 2  (the loop earning its keep)
**New:** 1 BLOCKER, 1 WARNING
- [BLOCKER] web/index.html — paintProviderPicker HID #d-model-row synchronously AFTER
  paintModelPicker delegated to the new picker (openDetail runs them in that order), so
  the Surface 2 picker was INVISIBLE in the running app for a normal codex agent while
  both isolated tests passed --> FIXED (paintProviderPicker no longer touches the model
  row; it is owned by paintOpenaiDetailModel)
- [WARNING] the jsdom test + browser check drove the painter in isolation, never the
  openDetail paint sequence --> FIXED (added a SEQUENCE browser-check phase driving the
  real paintModelPicker -> paintProviderPicker order; PROVEN to red on the pre-fix code
  via a control copy)

#### Iteration 3
**New:** 0 B/W/C, 1 NIT
- [NIT] sliceFn dropped the `async` keyword (test ran a non-async copy) --> FIXED
- [NIT] delegation predicate breadth --> DEFERRED (intentional defense-in-depth;
  narrowing to providerOf would risk falling an OpenAI agent through to the Claude picker)

#### Iteration 4
**New:** 1 WARNING, 2 NITs
- [WARNING] the empty-dir->default server resolution was unreachable for the case it
  documented, and a default-codex agent with a listable key would wrongly show "picks its
  own model" --> FIXED (accountForAgent resolves a default-codex agent to the default
  CLAUDE account; the client now sends an EMPTY dir when a.account.isDefault so the server
  resolves the default OPENAI account; test added)
- [NIT] no-default->400 fail-closed branch untested --> escalated iter5
- [NIT] paintModelWhy searches CREATE_MODELS first --> DEFERRED (note-only, keys don't collide)

#### Iteration 5
**New:** 1 WARNING (escalation of iter4 NIT), 2 NITs
- [WARNING] empty-dir->400-when-no-default fail-closed branch untested (double-flagged)
  --> FIXED (server.openai-models-nodefault-2140.test.js: no-default -> 400 with a positive
  control proving it discriminates)
- [NIT] test header said "fake document" --> FIXED (explicit "hand-rolled stub, not jsdom")
- [NIT] not-ours listable shows a disabled unrelated-account model list --> DEFERRED (cosmetic, no leak)

#### Iteration 6
**New:** 0 B/W/C, 2 NITs (both duplicates of already-deferred/noted items)
- **Converged** — no NEW actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | NIT | web/index.html | #d-model-why not cleared on load | FIXED |
| 2 | 2 | BLOCKER | web/index.html | paintProviderPicker hid the new picker in openDetail order | FIXED |
| 3 | 2 | WARNING | tests | painter tested only in isolation, not the paint sequence | FIXED (SEQUENCE check + control) |
| 4 | 3 | NIT | web.detail-*.test.js | sliceFn dropped async | FIXED |
| 5 | 3 | NIT | web/index.html | delegation predicate breadth | DEFERRED (intentional) |
| 6 | 4 | WARNING | web/index.html + server.js | empty-dir resolution dead + default-codex functional gap | FIXED |
| 7 | 4 | NIT | server tests | no-default 400 untested | FIXED in iter5 |
| 8 | 4 | NIT | web/index.html | paintModelWhy CREATE_MODELS-first | DEFERRED (note-only) |
| 9 | 5 | WARNING | server tests | fail-closed 400 branch untested (double-flagged) | FIXED |
| 10 | 5 | NIT | test header | said "fake document" | FIXED |
| 11 | 5 | NIT | web/index.html | not-ours listable shows unrelated models | DEFERRED (cosmetic) |
| 12 | 6 | NIT | web/index.html + test | not-ours + esc-stub (dups of 11/1) | DEFERRED |

### Validation
Full `validation_log_run_or_skip` (node --test + shell + browser-check diff-gate): clean
PASS on HEAD 446a394a (exit 0). Each iteration's 6g passed. The substantive detail-picker
browser check (render-detail-openai-model-2140) passes and reds on origin/main.

### Strengths (across iterations)
- Core no-Claude invariant holds in every render frame (loading/listable/not-listable/
  fetch-failure/stale-fetch/cross-agent switch); guards are TOCTOU-free.
- server empty-dir->default stays fail-closed and re-validates the known account.
- The SEQUENCE browser-check guards the exact "invisible in app while unit tests pass"
  interaction that isolated tests cannot catch.
- Fixtures are real test-support/fleet cards, per fixture-discipline.
