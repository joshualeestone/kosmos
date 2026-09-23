---
pre_challenge: true
method: challenge-loop
branch: setprovider-google-xai-3296
diff_hash: fcbec3d78465d4d457f02295144d084ae50ce53a7c826a399f8fa312c640cd8e
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T23:06:21Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 produced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 9 actionable (0 BLOCKERs, 3 WARNINGs, 4 CONVENTIONs, and NITs)
**Fixed:** 6 | **Deferred:** 3 | **Asked (awaiting user):** 0

Convergence was witnessed by two models (opus iterations 1 and 3, sonnet iterations 2
and 4) per kosmos#2032, so "converged" means no model in the rotation found a new
actionable issue, not that one model ran out of ideas.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty at review time; 6.0 passed clean)
- [WARNING] engine/create.js (gemini/grok default) -- fails OPEN where codex fails CLOSED --> DEFERRED (faithful mirror of createAgentInner's google/xai arms; fixing only the switch would diverge the two routes to one state, the #1600/#1373 defect shape; the env-key door is the supervisor's launch env, not reliably introspectable from the server process; documented inline)
- [WARNING] server.js:5643 route -- google/xai copy generalization has no EXECUTING test --> FIXED (58c425f: new server.switch-provider-google-xai-3296.test.js boots the server and asserts the composed sentences)
- [CONVENTION] engine/create.js:1487 -- four-way provider->runner map duplicated, unpinned (Repo Convention #5) --> FIXED (58c425f: extracted providerRunner(), used by setProvider/createAgentInner/recordedRunner, exported and pinned by a totality test)
- [NIT] default switchAccount shape diverges from list() row --> DEFERRED (mirrors setGeminiAccount's own default object; route tolerates the missing fields)
- [NIT] pickedByPerson unwired for gemini/grok --> upgraded to a WARNING and FIXED in iteration 2 (see below)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (all cited pre-existing/branch lines, not iteration-1 fix commits)
**Duplicates of prior findings:** the default fail-open was re-raised and correctly skipped (already deferred, no new argument)
- [WARNING] engine/create.js -- switchAccount.chosen never wired; route forwards `picked` but the gemini/grok path dropped it, and the new test certified the gap --> FIXED (b8f377f9: wire `chosen` = wantDir !== null && pickedByPerson, the same expression codex uses; route tests updated to assert you-picked vs default arms)
- [CONVENTION] engine/create.js:1498 vs server.js:5643 -- two provider->vendor-label maps that disagree on anthropic --> FIXED (b8f377f9: extracted providerLabel(); the route special-cases anthropic to the product word "Claude", every other vendor word comes from the one map)
- [CONVENTION] engine/create.js -- a third+ spelling of the "unknown account" refusal --> FIXED (b8f377f9: extracted unknownAccountRefusal(), used at the switch arm AND createAgentInner's openai/google/xai create arms; four hand-written copies collapsed to one)
- [NIT] no Grok twin for the missing-runner test --> FIXED (b8f377f9: added the #3391 grok missing-runner test)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
**Duplicates of prior findings:** the default-door keyTail NIT (dedup of iteration 1's deferred NIT)
- [CONVENTION] engine/create.js (named-account arm) -- fail-closed divergence from codex's unpicked-fallback is intentional but undocumented --> FIXED (054d367b: added a block comment stating the divergence is deliberate and that a future gemini/grok picker must add codex's picked/unpicked split, not a bare fall-through; comment only, no behavior change)
- [NIT] default-door row omits keyTail --> DEFERRED (dedup; mirrors setGeminiAccount, cosmetic, degrades gracefully)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings. Both NITs are dedups/non-actionable:
- [NIT] default-door keyTail omission (dedup of the deferred NIT; reviewer confirms "not a regression, mirrors pre-existing setGeminiAccount")
- [NIT] plan filename lacks a timestamp suffix (reviewer confirms universal existing practice across the whole plans directory, not specific to this PR; renaming would also risk the pre-challenge-gate hook's branch-match) --> DEFERRED

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/create.js gemini/grok default | BRANCH | default switch fails open vs codex fails closed | DEFERRED | mirrors create path; env-door not introspectable here; documented inline |
| 2 | 1 | WARNING | server.js:5643 | BRANCH | route google/xai copy has no executing test | FIXED | 58c425f |
| 3 | 1 | CONVENTION | engine/create.js:1487 | BRANCH | provider->runner map duplicated, unpinned | FIXED | 58c425f (providerRunner) |
| 4 | 1 | NIT | engine/create.js default acct | BRANCH | default switchAccount shape omits keyTail | DEFERRED | mirrors setGeminiAccount; cosmetic |
| 5 | 2 | WARNING | engine/create.js | BRANCH | switchAccount.chosen unwired for gemini/grok | FIXED | b8f377f9 |
| 6 | 2 | CONVENTION | engine/create.js:1498 / server.js:5643 | BRANCH | two provider->label maps disagree on anthropic | FIXED | b8f377f9 (providerLabel) |
| 7 | 2 | CONVENTION | engine/create.js (4 sites) | BRANCH | 4 spellings of unknown-account refusal | FIXED | b8f377f9 (unknownAccountRefusal) |
| 8 | 2 | NIT | test | BRANCH | no grok missing-runner test twin | FIXED | b8f377f9 |
| 9 | 3 | CONVENTION | engine/create.js named-account arm | BRANCH | fail-closed divergence from codex undocumented | FIXED | 054d367b (block comment) |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- Default-door switchAccount omits keyTail, so a default-door gemini/grok switch never renders "(API key ending XXXX)" even if a default key file exists (iterations 1, 3, 4) -- DEFERRED, mirrors setGeminiAccount's default-branch construction; cosmetic and degrades gracefully.
- The plan filename lacks the `<branch>-<timestamp>` suffix the CLAUDE.md Plans section specifies (iteration 4) -- DEFERRED, universal existing practice; renaming risks the pre-challenge-gate hook's branch-match.

### Strengths (across all iterations)
- The three pure helpers (providerRunner / providerLabel / unknownAccountRefusal) directly attack Repo Convention #5 (two-copies-of-one-fact): a fifth provider reaches the create path, the switch path, and the recorded-runner fallback from one edit, and providerRunner is pinned as a total map flooring unknown/undefined/null at claude.
- The gemini/grok account block correctly mirrors the SIMPLER create-path shape rather than reimplementing codex's picker saga, and the deliberate fail-open (default door) and fail-closed (named unknown account) choices are documented inline with substantive, non-circular justifications.
- server.switch-provider-google-xai-3296.test.js boots the real server and asserts the composed `because` bytes (label, account noun, you-picked vs default arms, and the signInNote NOT leaking onto a gemini switch) rather than only source-grepping the template.
- The codex account block is gated on `runner === 'codex'` and left byte-for-byte untouched, so the exact-writes snapshot (create.setprovider-writes-2811) and the #1373 live route assertions stay green; the OpenAI/Claude refusal wording is preserved verbatim.
