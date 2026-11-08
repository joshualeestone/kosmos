---
pre_challenge: true
method: challenge-loop
branch: testonly-8236
diff_hash: 262dddafd576e8f455d560bbd32051d020eab865ceee50b81d61d59162544880
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T10:07:35Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes. Round 6 (a whole-branch read) raised three WARNINGs, each a repeat of a decision already recorded in the plan (the fleet-wide re-read after a new rule, Windows agents and the board token, an agent able to turn the flag off), and NITs only otherwise.
**Total findings:** 1 BLOCKER, 19 WARNINGs, 1 CONVENTION, 21 NITs (from the per-iteration lists below)
**Fixed:** 1 BLOCKER, 13 WARNINGs, 1 CONVENTION, 9 NITs | **Deferred:** 6 WARNINGs (with reasons, in the plan) | **Asked:** 0

Final validation (6j) on 4ecc446: 27636 node tests passed, 0 failed, plus the shell shards; subdir audit clean.
Note: round 5's validation was stopped by me because I edited the worktree during it (two doc files); the final validation ran on the committed head after.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/projects.js rulesChangedIn: a running agent never re-read its instructions when its project became a test project --> FIXED (4873f9d)
- [WARNING] server.js: an agent's change was silent --> FIXED (4873f9d): a room note, as an agent's pause gets
- [WARNING] both CLIs: the older-board sentence was unreachable --> FIXED (4873f9d)
- [WARNING] both CLIs: a 200 with project null read as failure --> FIXED (4873f9d)
- [WARNING] engine/projects.js: the entry still invited new tasks --> FIXED (4873f9d)
- [WARNING] engine/assigner.js goalAskGaveUp: a test project shown as stalled --> FIXED (4873f9d)
- [CONVENTION] plan test count --> FIXED (4873f9d)
- also fixed: two pinned tests (cli.project-show-4581, tools/windows-tests.js HOST_BRANCH_EXCLUDED)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] turning it off never reached a running agent --> FIXED (95dcd02)
- [WARNING] any agent can clear it --> DEFERRED: deliberate, testers are agents; every agent change is said in the room
- [WARNING] shared rules still teach task add --> DEFERRED: the invitations are per-project lines, already dropped
- [WARNING] does a room note wake members --> DEFERRED: measured, roomNote only appends a log row
- also fixed: a source-scanning test (pausedrough-7812) pinned the resume tell near the edit; the room note moved

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] the re-read counted the whole block, so a join or leave owed one and a swap owed none --> FIXED (b97394a)
- [WARNING] the Mac answer branches had no test --> FIXED (b97394a): stub-board tests
- [NIT] stale comments, the taught rule's wording --> FIXED (b97394a)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] Windows agents taught a verb they may not run --> DEFERRED: REASONED, pause's existing route limit; for Homer's lane to confirm
- [WARNING] the Mac substring check --> DEFERRED: measured unreachable, the quote before : is escaped inside any string
- [WARNING] one fleet-wide re-read after the upgrade --> DEFERRED: how a new standing rule reaches running agents

#### Iteration 5 (whole branch)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] create-time notes told a test project's agents to ask about the goal, before the flag could be set --> FIXED (41f1deb): `project create ... --test`, POST /api/projects {testOnly}
- [WARNING] the overview route's flag had no test --> FIXED (41f1deb)
- [WARNING] a person-set flag can be turned off by an agent --> DEFERRED (duplicate of iteration 2)
- [NIT] the line's wording, a screen-change test, a stale comment --> FIXED (41f1deb)

#### Iteration 6 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs (3 duplicates of recorded decisions), 3 NITs
**Self-generated:** 0 of the above
**Converged.** The two doc NITs (a CLAUDE.md row, the plan's quote) were taken (4ecc446).

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Strengths (across all iterations)
- One flag through the existing paused pattern: validated before the one write, absent means off.
- Every guard was perturbed and its test turned red (13 perturbations across the loop).
- Mac and Windows CLIs print the same words and handle older boards honestly, each with a stub-board test.
