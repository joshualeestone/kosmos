---
pre_challenge: true
method: challenge-loop
branch: findall10-location
diff_hash: c4d928b0d2796cb8bcb73fea6ac0dc29bb0df174134d2ae4b4f44ec6f6c6b174
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T19:14:33Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (all blind, independent)
**Converged:** Yes (iteration 4 produced no new BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** 7 | **Deferred:** 1 | **Asked (awaiting user):** 0

Change under review: extends `engine/discover.acceptance-1329.test.js` with a "Part F" LOCATION-reach
section (2 tests + helpers), completing the find-all-10 acceptance guard for card #1329 - classification
(#1329, already merged) plus location reach (#2414, already merged). Test-only.

The findings narrowed monotonically toward hermeticity completeness: each pass found one more
home-derived env var that a bare Part F scan (which, unlike Parts A-E, runs under a CONSISTENT sandbox
so found()/foundCodex/foundGemini actually execute) could read the operator's real machine through -
SCAN_ROOTS, then CODEX_HOME, then AGENT_WORKFORCE_HOME - until iteration 4 confirmed every one is pinned.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] Part F did not clear AGENT_WORKFORCE_SCAN_ROOTS; an ambient value bypasses defaultScanRoots
  (scanRootsFromEnv wins first), silently defeating the #2414/#2125 machinery under test (a false RED).
  --> FIXED (52752e15): folded the clear into withHome; verified 2-red-before / green-after with it set.
- [NIT] the #2125 test lacked an in-test positive control proving the fresh fixture home was walked.
  --> FIXED (52752e15): added a reachable arbitrary-folder agent asserted present on the auto scan.
- [NIT] Part F omitted the os.homedir()===HOME sanity check the sibling uses.
  --> FIXED (52752e15): withHome now asserts it (later moved inside try in iter 2).
- [CONVENTION] no plan file for this branch. --> DEFERRED: card #1329 acceptance-test work.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] withHome did not clear CODEX_HOME. Part F runs under a consistent sandbox so foundCodex
  actually runs, and codexupdate.defaultHome() reads AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME || ...
  The fleet's codex supervisor exports CODEX_HOME, so a bare scan read the operator's real ~/.codex.
  --> FIXED (c9c9c87a): withHome clears CODEX_HOME + AGENT_WORKFORCE_CODEX_HOME. PROVEN before/after
  with a planted ~/.codex agent (a first perturbation probe gave a false 'no leak' because its rollout
  fixture missed the rollout-*.jsonl glob - re-checked the code path and re-ran with the right name).
- [NIT] the os.homedir sanity assert sat before try, so a throw skipped the env restore.
  --> FIXED (c9c9c87a): moved inside try.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] withHome's docstring claimed "every home-derived read is pinned", but AGENT_WORKFORCE_HOME
  - the shared third fallback of both codexupdate.defaultHome() and geminisession.HOME() - was cleared
  only via the nested withNoGeminiHome, not by withHome itself (latent: a future withHome-only test on
  a box exporting it would leak). --> FIXED (9029531c): withHome clears AGENT_WORKFORCE_HOME too, made
  self-sufficient; verified with AGENT_WORKFORCE_HOME + CODEX_HOME set ambiently.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings:** 1 (the no-plan-file CONVENTION, already deferred)
**Converged** - no new actionable findings.
- [NIT] the two positive-control folders used a generic 'proj' leaf; reach runs through
  alreadyIn -> runningUnderName(basename, paneRoster), and paneRoster reads the operator's REAL tmux
  (the one Part F input not pinned to the fixture), so a live session named 'proj' could spuriously
  exclude the candidate. --> FIXED (0d579194): distinctive leaves (findall10-work1 / findall10-reachable).
- [NIT] Part C's local 'const withHome' (a scan result) shadowed Part F's module-level withHome().
  --> FIXED (0d579194): renamed to geminiScan.

### Final Ledger

| # | Iter | Category | Site | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | withHome | SCAN_ROOTS not cleared (false-red bypass) | FIXED | 52752e15 |
| 2 | 1 | NIT | #2125 test | no positive control | FIXED | 52752e15 |
| 3 | 1 | NIT | withHome | no os.homedir sanity | FIXED | 52752e15 |
| 4 | 1 | CONVENTION | .claude/plans/ | no plan file | DEFERRED | card-driven acceptance-test work |
| 5 | 2 | WARNING | withHome | CODEX_HOME not cleared (real ~/.codex leak) | FIXED | c9c9c87a |
| 6 | 2 | NIT | withHome | sanity assert before try | FIXED | c9c9c87a |
| 7 | 3 | WARNING | withHome | AGENT_WORKFORCE_HOME not cleared (latent leak) | FIXED | 9029531c |
| 8 | 4 | NIT | Part F / Part C | generic 'proj' leaf + withHome name shadow | FIXED | 0d579194 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- All four NITs raised were fixed (see the ledger); none deferred.

### Strengths (across all iterations, blind agents concurring)
- Hermeticity ends thorough and correct: every home-derived read a bare consistent-sandbox scan
  performs is pinned to the fixture (Claude via CONFIG_ROOT; Codex via the cleared vars + remapped
  os.homedir; Gemini via withNoGeminiHome + remapped os.homedir; defaultScanRoots via os.homedir).
  Part F in fact hardens beyond its own reference sibling discover.location-2414.test.js, which never
  clears CODEX_HOME.
- Non-vacuity is real and code-verified: the deep arbitrary-folder agent and the loose files are
  reachable ONLY via #2414's discoverHomeParents (neither parent name is in SCAN_DEEP_NAMES), so a
  reach regression reds them; the #2125 no-ambush arm carries a positive control proving the fixture
  home was walked, so the ~/Documents absence is a genuine TCC skip. Perturbation-proven (an arbitrary
  deep folder is found; a SCAN_SKIP/dotdir parent is not).
- The granted-TCC arm is honest and non-circular: the stub returns a pre-read head (invokes no
  discovery), so the asserted name comes from scan()'s own looseRow/identityFromText parse, proving
  the hatch merge; it guards the tcc-partition invariant (every root handed to it carries tcc:true).
- Env save/restore is leak-free across the withHome / withNoGeminiHome nesting despite the shared
  AGENT_WORKFORCE_HOME appearing in both var lists.
