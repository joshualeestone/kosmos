---
pre_challenge: true
method: challenge-loop
branch: reachable-1916
diff_hash: 383ca77fa4fdacf48c2183afca8c01f34df66194cd686eed48b0029dafbbbaf7
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T23:45:39Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (converged — a single blind pass returned zero actionable findings)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs (3 STRENGTHs)
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

### The change
A one-line addition to the `EXCUSED` map in `engine.reachable.test.js`:

```
setClaudeProbe: 'test seam: injects the claude -p liveness probe so tests do not spawn a real claude (#1916)',
```

`engine.reachable.test.js` is a guard that computes every name exported from `engine/*.js`
that is exercised by its own tests but referenced by nothing else (a dead-export /
orphan-test-seam detector) and fails on any such name not explicitly excused. #1916 added
`setClaudeProbe` to `engine/create.js` — a setter that injects a fake `claude -p` liveness
probe so tests do not spawn a real `claude`. It matches the orphan signature exactly, so
`origin/main` went red the instant #1916 merged (its own CI ran against a base without the
guard consequence, and five PRs then merged on top of the red). This adds the one-line
excuse the guard's own comment prescribes ("a claim someone can check"), naming the seam
with its reason. No product code is touched; the sibling `claudeAccountLive` is correctly
NOT excused because it has a real non-test caller (`accountConnectable`).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
A fresh blind challenge agent verified every axis of the excuse independently against the
actual files (not on faith):
- [STRENGTH] `setClaudeProbe` is genuinely exported from `engine/create.js` (definition at
  ~:2020, `module.exports` at ~:3337).
- [STRENGTH] It is a test seam exercised ONLY by tests: a full repo grep across `engine/`,
  `server.js`, `web/index.html`, `install/kosmos`, `install/setup.sh`, `tools/*`,
  `test-support/*` finds every caller in `*.test.js` files only; no non-test caller exists.
- [STRENGTH] The reason is accurate: `setClaudeProbe(fn)` sets `claudeProbe`, consumed in
  `claudeAccountLive` as `claudeProbe || defaultClaudeProbe`, and `defaultClaudeProbe`
  runs the real `claude -p` via `execFile`.
- Guard logic verified: without the excuse the name hits the orphan signature (length >= 5,
  tested, zero external callers, same-file mentions - defs - inExports = 0) and the test
  fails; with `EXCUSED[name]` it is skipped. So the entry is genuinely required, not
  quieting a phantom failure.
- Sibling check verified: `claudeAccountLive` is correctly NOT excused (real caller
  `accountConnectable`), so this change does not over-excuse.
- No em dash; colon style matches every sibling entry; placement grouped after the other
  `set*` seams.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| — | 1 | (none) | engine.reachable.test.js:26 | Blind pass found nothing actionable; excuse is true, checkable, required | CONVERGED | n/a |

### NITs (non-blocking)
- None.

### Strengths
- [STRENGTH] The excuse is true and checkable on every axis (export, test-only usage,
  accurate reason), which is exactly the shape the guard's comment demands.
- [STRENGTH] The change adds no product code and does not over-excuse (the reachable
  sibling `claudeAccountLive` stays flagged-capable).
- [STRENGTH] Red-capability confirmed: the guard genuinely fails without this entry
  (reproduced on main) and passes with it (`engine.reachable.test.js` = 1 pass / 0 fail;
  full suite 3826/3826 node + 33/33 shell, exit 0).

### Weakest premise
The excuse's reason is a claim about `engine/create.js` at the shas current on origin/main;
if a future change gives `setClaudeProbe` a real non-test caller, the entry should be
removed (it would then be reachable and no longer need excusing). The guard itself does
not detect an over-broad excuse, only a missing one — but the blind agent confirmed no such
caller exists today.
