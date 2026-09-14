---
pre_challenge: true
method: challenge-loop
branch: codex-signin-liveness-2790
diff_hash: e1180b9d4584956b14a83c00172ebcca4f152f8b77b06ca2aca8889025c8ccea
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T08:20:30Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (6.0 baseline passed clean; two blind-review passes)
**Converged:** Yes (iteration 2 found zero actionable NEW findings)
**Total findings:** 1 WARNING + 5 NITs
**Fixed:** 1 WARNING + 3 NITs | **Deferred:** 0 | **Asked:** 0 | **Recorded (fail-safe NITs):** 2

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet (varied from the default per kosmos#2032)
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 0 (findings were about pre-existing text + this branch's own new code, none on a prior loop-fix line)
- [WARNING] docs/browser-checks/render-account-badge-1921.js - this branch reworded the chatgpt unknown-because message (openaiaccounts.js), leaving that check's CHATGPT_BECAUSE fixture a stale second copy (Convention #5). The check builds a SYNTHETIC row and tests only the pill/title overflow render, so the fixture is illustrative - marked it explicitly illustrative rather than rewrite the #1921 lane's assertions. --> FIXED (c33874a3)
- [NIT] server.openai-badge-2413.test.js:123 - CONTROL assertion message said "a chatgpt sign-in cannot be live-checked"; it can now, and reads UNKNOWN here only because the render path uses the cold non-blocking cache. Corrected. --> FIXED (c33874a3)
- [NIT] engine/openaiaccounts.js - checkLive JSDoc did not document the new opts.cached param or reauthRequired. Added. --> FIXED (c33874a3)
- [NIT] engine/openaiaccounts.js - checkLive(dir, opts={}) threw on an explicit null opts. Hardened to opts = opts || {}. --> FIXED (c33874a3)

#### Iteration 2
**Reviewer model:** opus (varied from iteration 1)
**New findings:** 0 actionable (2 NITs, both fail-safe)
**Self-generated:** 0
**Converged** - no new BLOCKER/WARNING/CONVENTION findings. The reviewer verified the never-false-red doctrine is enforced and pinned on every classifyDetailed arm, livenessCached genuinely never spawns (calls===0 test), the #1921 non-blocking-render contract holds end-to-end (only listLive passes {cached:true}; the awaited handshake is confined to codexauthprobe + create.accountConnectable), the inflight de-dup is race-clean, require adds no cycle, and no test can spawn a real codex doctor.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/render-account-badge-1921.js:72 | BRANCH | reworded message left a stale fixture copy (Convention #5) | FIXED | c33874a3 (marked illustrative) |
| 2 | 1 | NIT | server.openai-badge-2413.test.js:123 | BRANCH | CONTROL assertion message inaccurate post-#2790 | FIXED | c33874a3 |
| 3 | 1 | NIT | engine/openaiaccounts.js:1142 | BRANCH | JSDoc missing opts + reauthRequired | FIXED | c33874a3 |
| 4 | 1 | NIT | engine/openaiaccounts.js:1144 | BRANCH | checkLive(dir, null) threw on opts.cached | FIXED | c33874a3 |
| 5 | 2 | NIT | engine/codexsigninlive.js:60 | BRANCH | homeKey keys on String(dir) without path.resolve | RECORDED | fail-safe; keys align today (verified) |
| 6 | 2 | NIT | engine/openaiaccounts.js:1238 | BRANCH | create.accountConnectable can block ~20s on a cold cache | RECORDED | intended + documented + bounded |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, recorded for follow-up)
- [NIT] engine/codexsigninlive.js homeKey: a one-line path.resolve(String(dir)) would make the warm->render cache handoff correct-by-construction regardless of caller spelling. Verified the two callers (codexauthprobe's dir||defaultDir() and listLive's row.dir) derive from the same defaultDir()/row dir today, so this is fail-safe (a mismatch yields a cold-miss grey, never a false red), not a live bug. Worth doing as a fast-follow.
- [NIT] create.accountConnectable awaits the fresh liveness, so a cold-cache Create pre-flight can block up to ~20s (was instant UNKNOWN before). Intended (the plan calls it out), bounded (healthy handshakes < 1s; only a dead/slow sign-in waits the timeout, and there creation is correctly refused).

### DOCUMENTED RESIDUAL (not a defect; fails safe)
The 'dead' arm is REASONED (reachable endpoint + refused handshake = the credential) but not measured end-to-end against a REAL revoked ChatGPT account (a synthetic dead token measured an ambiguous transport error). Every doubt resolves to unknown -> grey, never a false red (the never-false-red doctrine, enforced + pinned per iteration 2's review), so the fail-safe direction holds. A real revoked-account fixture would close the last gap; it was not obtainable on this box.

### Strengths (across iterations)
- Never-false-red enforced identically on every classifyDetailed arm and pinned by mutation-style controls (missing-provider -> unknown-not-dead; network fault cause != authentication_rejected).
- livenessCached is a pure non-blocking cache read (calls===0 pinned); the #1921 render contract holds end-to-end; the awaited handshake is confined to the warmer + connectable pre-flight.
- inflight de-dup is race-clean; the diff fixed a pre-existing flake (a returned promise reset the real runner before resolution and spawned a live 17s handshake).
- Cross-model review: the Sonnet pass found the Convention #5 stale-fixture the reword created; the Opus pass verified the doctrine end-to-end and found nothing actionable.
