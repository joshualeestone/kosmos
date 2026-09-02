---
pre_challenge: true
method: challenge-loop
branch: firstrun-isolation-1780
diff_hash: 123640e43f9a91edd6a743b8773c00b764ce4aaa80576e8e11c0a3736788dff2
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T04:16:28Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 produced zero findings of any level)
**Total findings:** 8 (0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs) across iterations
**Fixed:** 6 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Validation note
Kosmos's shared validation helper routes lockfile-less kosmos to pnpm/typescript; workaround per
the standing convention is to pin the JS runner to yarn after sourcing
(`_vlog_js_runner() { echo yarn; }`). With that pin, `validation_log_run_or_skip` PASSED on the
6.0 baseline (hash 858a0e5b) and after every iteration's fixes; the 6j final gate PASSED on the
converged tree (hash 123640e4). Full suite (33 arms) green; no regression from the core-module
change. Directly ran the affected suites too: store/create/you (163/163), accounts/connect/
openaiaccounts/runners (100/100), instructions (67/67).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NITs
- [WARNING] plan Boundary + trust.js — plan mislabelled trust.js "read-side" when it is a WRITER
  (writes ~/.claude.json). --> FIXED (0e6cc0c4): corrected the plan; trust.js is out of #1780's
  About-you write path but a real broader-QA-walk gap, follow-up flagged.
- [NIT] instructions.js:53 rootDir doesn't honour the seam, diverges from create.workersDir under
  a HOME-only sandbox. --> FIXED (0e6cc0c4): honours AGENT_WORKFORCE_HOME (WORKERS still wins).
- [NIT] test cleanup: temp dirs never removed, HOME not restored. --> FIXED (0e6cc0c4), then
  completed at iter 2.

#### Iteration 2
**New findings:** 0 BLOCKER, 1 WARNING (dedup of iter-1 trust.js, confirmed handled), 0 CONVENTION, 2 NITs
- [NIT] after() left AGENT_WORKFORCE_HOME/TMUX_BIN/DATA/WORKERS unrestored (only HOME restored).
  --> FIXED (05f7c4a5): snapshot + restore all five mutated env vars.
- [NIT] plan omits firstrun.js's require-time freeze alongside you.js. --> FIXED (05f7c4a5).

#### Iteration 3
**New findings:** 0 BLOCKER, 1 WARNING, 1 CONVENTION, 1 NIT
- [WARNING] plan overclaimed "HOME isolates the four roots (DATA, WORKERS, HOME, PROJECTS)";
  projectsRoot honours only AGENT_WORKFORCE_PROJECTS, not HOME. --> FIXED (f82f7118): corrected
  the scope in the plan (HOME covers the store + workers roots of the About-you write, not
  projectsRoot, which has its own var).
- [CONVENTION] store.js comment "redirect every derived path ... instead of four" overstated. -->
  FIXED (f82f7118): tightened to the two write-chain roots, noting projectsRoot's own var.
- [NIT] instructions.rootDir change is beyond #1780's minimal footprint (labelled consistency).
  --> DEFERRED: kept (inert-when-unset consistency, commit labels it as such).

#### Iteration 4
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT --> CONVERGED (zero actionable)
- [NIT] store.js comment wrapped AGENT_WORKFORCE_PROJECTS across a line break (ungreppable). -->
  FIXED (commit after iter 4): kept the name on one line.

#### Iteration 5
**New findings:** 0 of any level. Confirming pass on the iter-4 comment fix. **Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | plan / trust.js | trust.js mislabelled read-side (it is a writer) | FIXED | 0e6cc0c4 (corrected + follow-up carded #1821) |
| 2 | 1 | NIT | instructions.js:53 | rootDir didn't honour the seam | FIXED | 0e6cc0c4 |
| 3 | 1 | NIT | test | temp/HOME not cleaned up | FIXED | 0e6cc0c4 / 05f7c4a5 |
| 4 | 2 | NIT | test | after() left 4 env vars unrestored | FIXED | 05f7c4a5 |
| 5 | 2 | NIT | plan | firstrun.js freeze unmentioned | FIXED | 05f7c4a5 |
| 6 | 3 | WARNING | plan | overclaimed HOME isolates PROJECTS | FIXED | f82f7118 |
| 7 | 3 | CONVENTION | store.js | comment "every derived path" overstated | FIXED | f82f7118 |
| 8 | 3 | NIT | instructions.js | consistency change beyond minimal footprint | DEFERRED | kept, inert-when-unset |
| 9 | 4 | NIT | store.js | AGENT_WORKFORCE_PROJECTS split across a line | FIXED | post-iter-4 commit |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Follow-up carded
- kosmos#1821: trust.js writes ~/.claude.json via raw os.homedir(); a QA walk that connects a
  provider or creates an agent can mutate live trust state. OUT of #1780's About-you scope
  (Splinter's ruling: ship #1780 as scoped; his morning install genuinely wants real trust
  writes). Fix per Splinter's steer: standardise the connect/create writers on trust.js's
  EXISTING CLAUDE_CONFIG_DIR seam, not a second AGENT_WORKFORCE_HOME seam.

### NITs (non-blocking)
- [NIT] instructions.rootDir consistency change (iter 3) — DEFERRED (kept; inert when unset).

### Strengths (across all iterations)
- Both fixed roots use the established `AGENT_WORKFORCE_HOME || os.homedir()` pattern (6 sibling modules already carry it); precedence preserved (DATA > HOME in store; WORKERS > HOME in workers/rootDir); resolved per call (no #1432/#1443 re-freeze).
- Inert in production: identical to prior behaviour when the seam is unset (zero blast radius); confirmed by the test's control arm and the full suite.
- The whole About-you write chain is sealed by the two roots; no writer in the syncEveryone chain bypasses the seam; recorded folders isolate too (agentDirRecorded reads store.readProfile under the seam).
- The proof test proves isolation by real-file sha, with a hard os.homedir===throwaway guard (fails loud rather than reaching the real machine), the write actually executing, a load-bearing PERTURB arm, both control arms, and a complete env-restore cleanup.
- Plan and comments accurately scoped, no overclaim (projectsRoot, you.js/firstrun.js freezes, and trust.js all honestly flagged). No em dashes in any added line.
