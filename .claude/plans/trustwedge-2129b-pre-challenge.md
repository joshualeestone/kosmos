---
pre_challenge: true
method: challenge-loop
branch: trustwedge-2129b
diff_hash: 804487c5b6e2fdd78bf3cab47a901883c520cbfb35804932bbd44650c62bdeac
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T22:51:03Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 surfaced zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 3 WARNINGs, 3 NITs (all from iteration 1-2 reviews)
**Fixed:** 2 WARNINGs (test vacuity) + 1 NIT (stale comment) + 1 NIT (wiring-guard coverage) | **Deferred:** 1 WARNING (efficacy weakest-premise, documented) + 1 NIT (OpenAI Claude trust, confirmed harmless) | **Asked:** 0

Two rigorous adversarial reviews both confirmed the FIX is correct: the `agentDefaultAccount`
signal (`!configDir`/`!acct.dir`/`!codexHome`) is true exactly when the launched agent has no
`CLAUDE_CONFIG_DIR`/`CODEX_HOME` (verified by construction against `plistFor` and the codex
`codexHomeOverridden()` branch), it is threaded through every per-account startup write (Claude
trust + bypass, codex trust/untrust/update-notice), the named-account path is unchanged, and the
resolvers honour the sandbox seams so no test touches the real `~/.claude`/`~/.codex`.

Full `node --test` suite: 4393 tests, 0 fail. subdir-CLAUDE.md audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] create.codex-wedge test -- the codex integration tests were VACUOUS: they sandboxed
  via `AGENT_WORKFORCE_CODEX_HOME`, which the unfixed `defaultHome()` honours first too, so the
  flag changed nothing and the assertions could never fail --> FIXED (a01b91af): rewritten to
  discriminate via `CODEX_HOME` (engine) + `AGENT_WORKFORCE_HOME` (agent home), with a WITHOUT-flag
  CONTROL. Perturbation-verified: breaking the fix fails these tests.
- [WARNING] trust.wedge test -- same vacuity for the Claude trust arm (`AGENT_WORKFORCE_CLAUDE_CONFIG`
  honoured by `CONFIG(null)` too) --> FIXED (a01b91af): discriminate via `CLAUDE_CONFIG_DIR` +
  `AGENT_WORKFORCE_HOME`, with a control. (The bypass test was already discriminating -- `SETTINGS`
  deliberately does not honour the settings seam.)
- [WARNING] efficacy -- the fix is a NO-OP on a clean board; it only bites when the engine inherited
  `CLAUDE_CONFIG_DIR`/`CODEX_HOME` from the app launch env --> DEFERRED as the documented weakest
  premise (plan). Not a code defect; needs the operator's re-test to confirm efficacy on his box.
- [NIT] remove.js comment -- named the old `home || codexHomeDir()` resolution --> FIXED (a01b91af):
  re-aimed at the `agentDefaultAccount` flow.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- no actionable findings. The reviewer independently perturbed the fix and confirmed
the integration tests now discriminate (4 fail when the fix is reverted, the 6 resolver-unit tests
stay green), and verified the signal is correct by construction.
- [NIT] wiring guard -- the source guard did not cover the setProvider/adopt/remove codex threading
  --> FIXED (57...): extended to every flag-threading site so a refactor cannot silently drop it.
- [NIT] create.js:3316 -- an OpenAI agent's Claude trust write stays on the un-flagged path
  --> DEFERRED: pre-existing, `createIfAbsent:false`, harmless (an OpenAI agent runs codex, not
  claude), confirmed by the reviewer. Not a wedge.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | create.codex-wedge test | codex integration tests vacuous | FIXED | a01b91af + perturbation |
| 2 | 1 | WARNING | trust.wedge test | Claude trust integration test vacuous | FIXED | a01b91af + perturbation |
| 3 | 1 | WARNING | plan | efficacy no-op on clean board | DEFERRED | documented weakest premise |
| 4 | 1 | NIT | remove.js | stale codex-symmetry comment | FIXED | a01b91af |
| 5 | 2 | NIT | create.test.js | wiring guard coverage gap | FIXED | (iter-2 commit) |
| 6 | 2 | NIT | create.js:3316 | OpenAI Claude trust un-flagged | DEFERRED | pre-existing, harmless |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs / Strengths
- STRENGTH: signal correct by construction (plistFor + codexHomeOverridden), not by coincidence.
- STRENGTH: tests genuinely discriminate (perturbation-verified twice, independently).
- STRENGTH: whack-a-mole covered (all four startup prompt-writes extended to the default account).
- STRENGTH: additive + regression-safe (undefined flag = old behaviour), named-account path untouched.
- STRENGTH: sandbox discipline (AGENT_WORKFORCE_HOME fallback + new AGENT_WORKFORCE_CLAUDE_SETTINGS
  seam), no writes escape to the real home.
