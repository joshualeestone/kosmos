---
pre_challenge: true
method: challenge-loop
branch: pluginreach-ui-5309
diff_hash: c51297c00d715a3683423096f609f90efcb6f3cd35aa5c9d28ee5334d92100c7
validation: passed
subdir_audit: passed
timestamp: 2026-10-13T20:07:48Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind passes (plus a final full-suite validation, 6j).
**Converged:** Yes (iteration 7 found zero new BLOCKER/WARNING/CONVENTION after dedup; no unresolved ASKED).
**Total actionable findings:** 2 CONVENTION, 8 WARNING (0 BLOCKER), plus NITs.
**Fixed:** 9 (8 WARNING + the no-plan-file CONVENTION) | **Deferred:** 4 | **Asked (resolved by Liu Kang):** 1

Reviewer models alternated Opus / Sonnet across iterations, so convergence was witnessed by both.
Several WARNINGs were consequences of this loop's own earlier fixes (the kosmos#120 dynamic), each a
CODE finding fixed normally rather than a prose-claim rewrite.

### Per-Iteration Breakdown

#### Iteration 1 (Opus)
**New findings:** 2 CONVENTIONs, 1 NIT. **Self-generated:** 0 (no loop fix had committed yet).
- [CONVENTION] .claude/plans/ -- no plan file for this branch --> FIXED iter 6 (wrote the plan file, 40fed8c16)
- [CONVENTION] engine/pluginreach.js + server.js -- .claude.json re-derived inline vs accounts.configFile --> DEFERRED: attachPluginReach is an injectable seam (opts.personHome/fs); accounts.configFile reads the real homeDir() and is not injectable, so routing through it breaks the test contract. Each inline derivation is correct for the branch it handles (person = default home-root; agent folderPluginSet only runs for a separate account = inside-dir), and the evidence gate is a second backstop.
- [NIT] server.js -- personCodexHome hardcodes ~/.codex, ignoring a CODEX_HOME override (safe fail direction; reading the board's process.env.CODEX_HOME could point at the board's isolated home, not the person's desktop app)

#### Iteration 2 (Sonnet)
**New findings:** 3 WARNINGs, NITs. **Self-generated:** 0.
- [WARNING] engine/pluginreach.js _enabledPluginIds -- counted DISABLED plugins ({"x": false}) as added --> FIXED (fa145ddfb): filter to enabled (truthy); matches the code's own "ENABLED is what loads tools"
- [WARNING] engine/pluginreach.js _mcpServerNames -- unioned EVERY project's mcpServers, over-firing on unrelated secondary-account agents --> ASKED Liu Kang (product decision), ruled option-c, FIXED (fa145ddfb): top-level plus only the projects entry keyed exactly by the agent's own working folder; unknown folder -> top-level only
- [WARNING] engine/pluginreach.js -- agent .claude.json read location possibly unconfirmed --> DEFERRED: matches accounts.configFile's authoritative non-default branch; the ENOENT->empty->notice path is correct for a separate account that configured nothing (not a false positive)

#### Iteration 3 (Opus)
**New findings:** 1 WARNING. **Self-generated:** 1 (from iteration 2's own wiring).
- [WARNING] server.js attachPluginReach -- agentWorkFolder computed eagerly (workerDir read + realpath) for EVERY agent every poll, used only on the separate-account path --> FIXED (b972ceb2d): pass it as a lazy thunk resolved only in the SEPARATE_ACCOUNT branch

#### Iteration 4 (Sonnet)
**New findings:** 4 WARNINGs. **Self-generated:** 1 (W5 from iteration 2's folder-in-cache-key).
- [WARNING] engine/pluginreach.js -- folder in the cache key re-parsed the person's settings.json + ~/.claude.json once per separate-account agent, breaking read-once-per-poll --> FIXED (ecf481736): a _parsedFile parse cache by (path, mtime), folder-independent and shared; the folder only projects from the already-parsed JSON (no I/O)
- [WARNING] server.js -- per-agent reach computed inline with no try/catch; an agents-list failure must never 500 /api/status --> FIXED (ecf481736): per-agent try/catch -> a.reach = null on a surprise
- [WARNING] server.js -- the per-agent folder path was not exercised through attachPluginReach by a test --> FIXED (ecf481736): opts.canonicalize made injectable alongside opts.workerDir; a server-level test drives own-folder -> counted, other-folder -> not, throwing-thunk -> top-level fallback
- [WARNING] engine/pluginreach.js codexPersonPresence -- any non-empty ~/.codex/plugins counts as evidence, risking a false Codex warning --> DEFERRED on evidence: measured ~/.codex on this box has NO plugins dir at all, and a missing dir is already treated as not-present, so it cannot false-fire for a real Codex home

#### Iteration 5 (Opus)
**New findings:** 1 WARNING. **Self-generated:** 1 (from iteration 4's _parseCache).
- [WARNING] engine/pluginreach.js -- _parseCache baked mtime into the KEY, leaking one permanent parsed-object entry per mtime on the long-lived board (where _resetCache never runs) --> FIXED (b66b805b7): rekey on PATH with mtime stored as a value and compared (the bounded _folderSetCache shape), one entry per file

#### Iteration 6 (Sonnet)
**New findings:** 1 CONVENTION (dedup of iter-1 no-plan-file, now fixed), 2 NITs. **Self-generated:** 0 (the stale header is slice-1's, BRANCH).
- [NIT] engine/pluginreach.js header -- said slice 1 "never a list of specific plugins", which slice 2's missing-ids made FALSE --> FIXED (40fed8c16): rewrote the header to describe the evidence gate + missing ids (test-guarded behaviour)
- [NIT] server.js -- attachPluginReach sits between the #2863 comment and withAgentSortFields --> NOTED (cosmetic; a function move for a NIT was judged higher-risk than the clarity gain)

#### Iteration 7 (Opus)
**New findings:** 0 actionable. 1 NIT. **CONVERGED.**
- [NIT] server.js -- the per-row try/catch guard is not test-exercised (agentPluginReach is engineered never to throw) --> NOTED (sound defense-in-depth; forcing it would need an injected throwing dependency)
- [STRENGTH] confirmed: fail-safe throughout; every unreadable/ambiguous input -> reaches:null; the UI fires only on reaches===false; comments and the module header now match the code.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file for branch | FIXED | 40fed8c16 (wrote plan) |
| 2 | 1 | CONVENTION | pluginreach.js/server.js | BRANCH | .claude.json inline vs configFile | DEFERRED | injectable seam; derivations correct per branch |
| 3 | 2 | WARNING | engine/pluginreach.js | BRANCH | disabled plugins counted | FIXED | fa145ddfb |
| 4 | 2 | WARNING | engine/pluginreach.js | BRANCH | per-project mcpServers over-fire | FIXED | fa145ddfb (Liu Kang option-c) |
| 5 | 2 | WARNING | engine/pluginreach.js | BRANCH | agent .claude.json location | DEFERRED | matches configFile; ENOENT path correct |
| 6 | 3 | WARNING | server.js | SELF | eager per-poll folder syscalls | FIXED | b972ceb2d (lazy thunk) |
| 7 | 4 | WARNING | engine/pluginreach.js | SELF | person files re-parsed per agent | FIXED | ecf481736 (parse cache) |
| 8 | 4 | WARNING | server.js | BRANCH | no per-agent try/catch | FIXED | ecf481736 |
| 9 | 4 | WARNING | server.js | BRANCH | server folder path untested | FIXED | ecf481736 (injectable canonicalize + test) |
| 10 | 4 | WARNING | engine/pluginreach.js | BRANCH | ~/.codex/plugins false-positive | DEFERRED | measured: no plugins dir on a real home |
| 11 | 5 | WARNING | engine/pluginreach.js | SELF | _parseCache unbounded (mtime in key) | FIXED | b66b805b7 (bounded, one per path) |
| 12 | 6 | NIT | engine/pluginreach.js | BRANCH | stale/false header | FIXED | 40fed8c16 |

### NITs (non-blocking)
- server.js -- attachPluginReach placement relative to the #2863 comment (iter 6)
- server.js -- per-row try/catch not test-exercised (iter 7)
- engine/pluginreach.js -- plugin ids and mcpServer names share one id Set; a collision is the safe under-warn direction (documented in code, iter 5/6)
- server.js -- personCodexHome does not honor a CODEX_HOME override (iter 1; safe fail direction)

### Strengths (across iterations)
- Fail-safe by construction: every unreadable/ambiguous input resolves to reaches:null; the board renders only on reaches===false, so the worst case is a missed notice, never a false warning on a healthy setup.
- The evidence gate is defense-in-depth: even a mis-resolved separate-account reads the same files for person and agent -> NO_EVIDENCE -> silence.
- Tests carry non-vacuous controls: the read-count tests assert zero re-reads on an unchanged mtime AND that a bumped mtime forces a re-read; the lazy folder thunk is proven to run zero times for a reaching agent and once on the separate-account path; per-project matching is proven for own-folder / other-folder / unknown.
- The obsolete reachForAgent export and its reachability excuse were removed with no dangling references; _resetCache is a documented test seam.

### Validation (6j, full suite at the converged head)
Node suite 20168 tests, 19924 pass, 0 fail; shell shard 232/232; validation PASSED (hash c51297c00d71, matching this diff_hash's prefix). The render-pluginreach-5309 browser-check PASSED at this head (10/10 assertions, 0 page errors); the full tools/browser-checks.sh run is posted on the PR.

### Still owed to human QA
The slice-1 wording actually ending a real restart loop in a user's session (the PR uses Addresses, not Closes).
