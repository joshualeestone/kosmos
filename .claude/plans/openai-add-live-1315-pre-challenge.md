---
pre_challenge: true
method: challenge-loop
branch: openai-add-live-1315
diff_hash: 04263124d4a9dcc08072dce085252cbab9f6073bbcbc4262c89bac68cb4878a5
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T20:35:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 WARNING, 3 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 1 (the WARNING) | **Deferred:** 0 | **Asked:** 0 | NITs: noted (the latency NIT is inherent to add-time validation and fails open — no code change)

Validation: `node --test engine/*.test.js` = 1952 pass / 0 fail (full engine suite). The openaiaccounts tests were also perturbation-verified twice: disabling the reject branch reds the invalid_api_key test; reverting the cleanup to unconditional rmSync reds the pre-existing-dir test. (The worktree has no node_modules, so the yarn/shell steps are not runnable here; the change is confined to a pure-node module + one server route.)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/openaiaccounts.js — `addWithKeyLive` removed the account dir recursively+unconditionally on a live-reject, but `addWithKey` guards its own cleanup on `madeDir` to never delete a dir it did not create; the wrapper could recursively delete a pre-existing labelled dir + its contents --> FIXED (thread `madeDir` out; remove whole dir only if we created it, else remove just the auth.json this add wrote; two regression tests added).
- [NIT] server.js — the pre-existing `.catch` message would be misleading if addWithKeyLive threw (it is designed not to) --> noted, no change (safe today; addWithKeyLive never rejects).
- [NIT] server.js — the add route now awaits a live round-trip before answering (added latency) --> noted; intended for add-time validation, fails open on timeout (UNKNOWN → accept), no wrong reject.
- STRENGTHs: the NONE⟺invalid_api_key post-add premise is sound; the accept-unreachable/scoped-401 asymmetry mirrors the badge; tests non-vacuous with controls that return the dangerous answer; key never leaks; addWithKey stays sync so its 15 call sites are untouched.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings (confirmed resolved):** the WARNING fix was independently verified correct (madeDir-conditional cleanup faithfully mirrors addWithKey; the auth.json present at cleanup is unambiguously this add's, since addWithKey only succeeds into a dir with no prior auth.json).
- [NIT] engine/openaiaccounts.js — the live `/v1/models` round-trip can make the Add button spin on a slow/unreachable OpenAI --> noted, same latency point; fails open, acceptable for a validation step.
- 4 STRENGTHs: cleanup correct+safe; NONE⟺invalid_api_key sound; coverage non-vacuous with dangerous-answer controls; no key leak, no regression to the 15 call sites, correct await, no double-send.

**Converged** — iteration 2 produced no actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/openaiaccounts.js | live-reject cleanup deleted a dir it may not have created | FIXED | madeDir-conditional cleanup + 2 tests |
| 2 | 1 | NIT | server.js | catch message misleading if wrapper threw | NOTED | safe today (never rejects) |
| 3 | 1 | NIT | server.js | add-route latency from the live round-trip | NOTED | intended; fails open |
| 4 | 2 | NIT | engine/openaiaccounts.js | Add button latency on slow OpenAI | NOTED | same as #3 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- Add-time validation adds a live round-trip; the Add action can spin on a slow/unreachable OpenAI. Fails open (timeout → UNKNOWN → accept), never a wrong reject. Product owner may later want an interim UI signal.

### Strengths (across all iterations)
- The core asymmetry reuses `checkLive` rather than reinventing 401 handling: only a positively-confirmed `invalid_api_key` rejects; unreachable and scope-restricted 401 are accepted, never blocking a legitimately-scoped key.
- `addWithKey` stays sync, containing the blast radius to one production caller (the POST route, one awaited word) and leaving its 15 test call sites untouched.
- The key never leaks: `because` strings are static, the row carries only `keyTail`, every test asserts the key substring is absent.
- Cleanup mirrors addWithKey's own `madeDir` anti-litter guard exactly; a pre-existing directory can never be deleted.
- Browser-gate compatible: `render-accounts-openai` adds the walk key which the stand-in accepts (200 → CONNECTED → accept).
