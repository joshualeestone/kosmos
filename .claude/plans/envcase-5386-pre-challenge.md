---
pre_challenge: true
method: challenge-loop
branch: envcase-5386
diff_hash: 337ff3ae836ac3d04bce160e0e8a546b095238396409074d152fc4bd69f40ce7
validation: passed
subdir_audit: passed
timestamp: 2026-10-08T00:52:40Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Converged:** Yes (iteration 9, opus: NITs only, recorded in the plan)
**Reviewers:** alternating opus (1, 3, 5, 7, 9) and sonnet (2, 4, 6, 8), blind, fresh context each.
**Validation (6j) at ef7b199ec:** node suite 16537 tests, 16309 pass, 0 fail, 228 skipped; VALRC=0, AUDITRC=0; then
`yarn test:shell` SHELLRC=0 (the shell suite runs only in CI's shards otherwise).

### Per-iteration findings
- [WARNING] it1 engine/openaiaccounts.js:584,1052 - both Codex sign-ins set CODEX_HOME beside an inherited spelling --> FIXED (envSet)
- [WARNING] it1 engine/envcase-5386.test.js - the guard saw only `delete env.`; sets unguarded --> FIXED (every engine module, delete/assign/spread/Object.assign, controls)
- [WARNING] it1 worlds/remote/sandbox - more exact-case sites --> FIXED (worlds, remote, orgchartcodex); sandbox DEFERRED (TMUX, no tmux on Windows)
- [WARNING] it2 engine/worlds.js applyAgentWorldEnv - marker read by exact case on a copy --> FIXED (envCanon; test red without it)
- [WARNING] it2 engine/worlds.js restorePreWorldRoots - helpers would mutate process.env --> FIXED (copies only)
- [WARNING] it2 envcase test - bracket assignment unseen; comment-strip limits undocumented --> FIXED (pattern + header)
- [WARNING] it3 engine/worlds.js - a named world on a copy used exact-case roots and HOME --> FIXED (canonicalise all world names; test red on the partial version)
- [WARNING] it3 envcase test - world names not scanned --> FIXED (#1704 names + control)
- [WARNING] it4 engine/worlds.js preWorldEnv/applyWorldEnv - one spelling not guaranteed without a marker / via applyActiveWorldEnv --> FIXED (canonWorldNames in every entry point; tests)
- [WARNING] it4 envcase test - fixed NAMES list --> FIXED (+5 names; header says new names must be added)
- [BLOCKER] it5 engine/win32anchor.world-1704.test.js:63 - the stand-in engine's hand-kept module list lacked win32env.js once worlds.js required it --> FIXED (list derived from load-time requires, with a guard)
- [WARNING] it5 worlds applyWorldEnv path untested --> FIXED (applyActiveWorldEnv with a real temp world; red without the fix)
- [WARNING] it6 win32anchor stand-in reader too narrow --> FIXED (any top-level form, either quote; control caught a bare require missed)
- [WARNING] it7 engine/worlds.js canonWorldNames - promoted an odd spelling on a Mac --> FIXED (Windows only, seam setWorldCaseFoldPlatformForTests excused in engine.reachable; Mac test red without the gate)
- [WARNING] it8 engine/worlds.js delVar/setVar - folded case on a Mac --> FIXED (shared foldsCase; Mac delete assert red when it folds)
- it9 opus: NITs only (boardrestart folds world names everywhere, kept on purpose; scan scope engine/ only; stand-in reader may over-include a column-0 lazy require) --> recorded in the plan

### NITs (non-blocking)
- inline require('./win32env') calls hoisted (it2, it3); compound assignment and constant-key forms added to the scan (it7); the stand-in reader and its control share one regex (it8).
- Deferred: subscription.test.js's odd spelling discriminates only on a case-sensitive host (the source scan is the host-neutral guard); orgchartcodex CODEX_HOME via envSet is a no-op in effect, kept for uniformity.

### Strengths (across iterations)
- One helper (win32env) for every env copy; process.env keeps plain access; the scan covers every non-test engine module with per-form controls and pinned before-lines, so it stays armed after merge.
- Every behaviour fix carries a test that was planted red on the code before it.

Merged origin/main 2026-10-07 22:40 (one seam-list conflict in engine.reachable.test.js, both kept); on the merged tree main's 87 changed test files: 2347 tests, 0 fail; engine.reachable and envcase-5386 pass.
