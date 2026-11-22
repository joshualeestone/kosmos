---
pre_challenge: true
method: challenge-loop
branch: connaccurate-8868
diff_hash: 74685d1bf7501bcda90c617f927b3d2c745d9e97048ebb7c83d2e158fb9b4613
validation: passed
subdir_audit: passed
timestamp: 2026-11-22T00:42:14Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind whole-branch reviews, opus and sonnet alternating.
**Converged:** No: stopped at the 8-round cap (Splinter's 10-22 usage rule: past 8 only with a BLOCKER). No BLOCKER
was raised in any round. Round 8's two warnings were handled after it (one by pointing at an existing test, one a
stated limit); that last commit (c16996eee8) was comments and the plan only and was not re-reviewed.
**Total findings:** 23 actionable warnings across 8 rounds (0 BLOCKERs), plus NITs
**Fixed:** 19 | **Deferred:** 4 (stated limits or by design) | **Asked:** 0

**Baseline validation:** passed on a1906102dd (node 30447, 0 failed; shell 4 of 4).
**Final validation (6j):** PASSED on c16996eee8, the diff this proof hashes (validation-log hash 74685d1bf750): node
30448 tests, 0 failed; shell shards 4 of 4 status 0. Subdir audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] the control proved only the first check could fail --> FIXED (ed85898048, one control per check)
- [WARNING] the plan dated the bad text to #4451; it was 09-03 to 09-29 (phrase added c946e47994, removed 7328bedd16) --> FIXED (plan and a correction on the card)
- [WARNING] a second writer (engine/discover.js) was missed --> FIXED (a writer sweep)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 2 (the sweep, written in iteration 1)
- [WARNING] a third writer (engine/create.js) not named; the control required only discover.js --> FIXED (d653080042)
- [WARNING] the line-by-line sweep missed multi-line calls, a destructured START, a concatenated body --> FIXED (whole calls parsed)
- [WARNING] nothing checked the block still points at `kosmos connections --how` --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 8 NITs
**Self-generated:** 3
- [WARNING] another module's blockBody() on the Connections markers passed --> FIXED (bcdc5b135a)
- [WARNING] an inline `require('./connections').START` was not recognised --> FIXED
- [WARNING] projects.js was skipped without a reason --> FIXED (swept)
- [WARNING] a file with two marker pairs is never repaired; the plan claimed every write repairs --> FIXED (stated as a limit)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 4 NITs
**Self-generated:** 2
- [WARNING] the sweep read engine/ only, not subfolders, bin/, install/ or .mjs/.cjs --> FIXED (22d61a4c16, 491 files)
- [WARNING] comments inside a call can mis-split it --> DEFERRED: stated limit (a real tokenizer is needed, `//` appears in URLs)
- [WARNING] a literal marker string or an aliased spliceBlock was not recognised --> FIXED (literal) / stated (alias)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 2
- [WARNING] the guide was checked more loosely than the block --> FIXED (44ce617616, assertGuide with a control per check)
- [WARNING] a renamed destructured START or a marker bound to another name escaped --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs after deduplication (2 more were stated limits), 3 NITs
**Self-generated:** 1
- [WARNING] an empty block left in the loop --> FIXED (1d21629d69)
- [WARNING] the file-count bound (300) would rot --> FIXED (derived from engine/)
- [WARNING] NO_COMMAND misses "no command-line way" --> DEFERRED: by design (round 3 asked it not to fire on "command-line")
- [WARNING] a writer under an unrecognised name is skipped --> DEFERRED: stated limit

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 WARNING, 4 NITs
**Self-generated:** 1
- [WARNING] two more unrepaired shapes (an old block with no END marker; a new agent over the size limit) --> FIXED (ced1fe5fa1, stated beside the two-pair case)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] nothing shows board start calls the writer --> FIXED (c16996eee8: pinned by server.connections-refresh-1649.test.js, which boots a board; referenced)
- [WARNING] a call mis-split by an apostrophe in a comment goes unchecked --> DEFERRED: stated limit (iteration 4)

### Final Ledger (actionable, by state)

| Iter | Category | File | Origin | Description | Status |
|------|----------|------|--------|-------------|--------|
| 1 | WARNING | engine/connections-accurate-8868.test.js | BRANCH | control proved one check only | FIXED |
| 1 | WARNING | .claude/plans/connaccurate-8868.md | BRANCH | wrong dates for the bad text | FIXED |
| 1 | WARNING | .claude/plans/connaccurate-8868.md | BRANCH | discover.js writer missed | FIXED |
| 2 | WARNING | engine/connections-accurate-8868.test.js | SELF | create.js writer unasserted | FIXED |
| 2 | WARNING | engine/connections-accurate-8868.test.js | SELF | line-by-line sweep blind spots | FIXED |
| 2 | WARNING | engine/connections-accurate-8868.test.js | BRANCH | no --how pointer check | FIXED |
| 3 | WARNING | engine/connections-accurate-8868.test.js | SELF | another module's blockBody passed | FIXED |
| 3 | WARNING | engine/connections-accurate-8868.test.js | SELF | inline require missed | FIXED |
| 3 | WARNING | engine/connections-accurate-8868.test.js | SELF | projects.js skipped | FIXED |
| 3 | WARNING | .claude/plans/connaccurate-8868.md | BRANCH | two-pair case unrepaired | FIXED (stated) |
| 4 | WARNING | engine/connections-accurate-8868.test.js | SELF | sweep reach too narrow | FIXED |
| 4 | WARNING | engine/connections-accurate-8868.test.js | SELF | comments mis-split calls | DEFERRED (stated) |
| 4 | WARNING | engine/connections-accurate-8868.test.js | BRANCH | literal markers / aliased splice | FIXED / stated |
| 5 | WARNING | engine/connections-accurate-8868.test.js | SELF | guide checked loosely | FIXED |
| 5 | WARNING | engine/connections-accurate-8868.test.js | SELF | renamed bindings escaped | FIXED |
| 6 | WARNING | engine/connections-accurate-8868.test.js | SELF | empty block | FIXED |
| 6 | WARNING | engine/connections-accurate-8868.test.js | SELF | magic file count | FIXED |
| 6 | WARNING | engine/connections-accurate-8868.test.js | SELF | "command-line" not matched | DEFERRED (by design) |
| 6 | WARNING | engine/connections-accurate-8868.test.js | SELF | unrecognised name skipped | DEFERRED (stated) |
| 7 | WARNING | engine/connections-accurate-8868.test.js | BRANCH | two more unrepaired shapes | FIXED (stated) |
| 8 | WARNING | engine/connections-accurate-8868.test.js | BRANCH | board-start wiring unshown | FIXED (referenced) |
| 8 | WARNING | engine/connections-accurate-8868.test.js | SELF | mis-split call unchecked | DEFERRED (stated) |

### Outstanding questions
None.

### NITs (non-blocking)
- The guide is checked as guideText(), not as the `kosmos connections --how` output (connections.test.js covers the CLI)
- OLD_BLOCK is a paraphrase of the 09-03 to 09-29 block, labelled so
- NO_COMMAND is a tripwire for the listed spellings, not the whole class, and says so

### Strengths
- The guard checks the file an agent receives, on three regenerations (only the first changes it), and the repair of a file holding the old block, keeping the agent's own text
- Every check in the block and guide arms has its own control that turns only that check red
- The writer sweep parses whole calls across 491 files and must find all three known writers; perturbations of create.js and discover.js turn it red
- The plan names its weakest premise (a writer running old code on the reporting computer) and what would change it
