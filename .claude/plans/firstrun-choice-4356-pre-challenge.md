---
pre_challenge: true
method: challenge-loop
branch: firstrun-choice-4356
diff_hash: 66eccb2f6dd11985a5214c74dfe0746473d98121b17314ff667ec5adc97780ef
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T04:52:56Z
iterations: 34
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 34
**Converged:** Yes (iteration 31 found nothing; 32 found NITs only; 33 and 34, on the third and fourth merges of main, found nothing new)
**Total findings:** 2 BLOCKERs, 56 WARNINGs, 7 CONVENTIONs, 64+ NITs (iteration 17's NIT count was not recorded)
**Fixed:** all BLOCKERs, CONVENTIONs and WARNINGs except those DEFERRED below | **Deferred:** 3 | **Asked (awaiting user):** 0

Reviewer models rotated opus, sonnet, fable. Every iteration was a fresh blind agent that saw only the code.
Main was merged five times (after 17, after 30, after 32, after 33, after 34; the last had one conflict, the browser-check site count, resolved to 202 in e980274); later iterations reviewed the merged diff.
Full per-round log: ~/work/workers/kano/state/4356.md (timestamped, append-only).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs
**Self-generated:** 0
- [BLOCKER] + 5 [WARNING] across web/index.html and native-app/main.swift --> FIXED (6738e8c)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 NIT
- [WARNING] x3 --> FIXED (f0df87e)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 5 NITs
- [BLOCKER] web/index.html: the tour could open under the first screen --> FIXED (fbeb7cb)
- [WARNING] x2, [CONVENTION] x1 --> FIXED (fbeb7cb)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 2 NITs
- [WARNING] x3 --> FIXED (0cd4d6f); browser check found the page not inert to later layers --> FIXED (MutationObserver)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs
- [WARNING] x3 --> FIXED (abb813f)

#### Iteration 6
**Reviewer model:** fable
**New findings:** 2 WARNINGs, 3 NITs
- [WARNING] x2 --> FIXED (4af3d30)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 4 NITs
- [WARNING] x3 --> FIXED (c9138a6); two design gaps posted on the #4356 card

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 WARNING
- [WARNING] comment overclaim --> FIXED (18cd2d0)

#### Iteration 9
**Reviewer model:** fable
**New findings:** 3 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] x3, [CONVENTION] --> FIXED (71f0f40)
- [WARNING] Connect after a damaged mode file on a Mac with agents stops the board, not the agents --> DEFERRED: accepted, on the card

#### Iteration 10
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 2 NITs
- [WARNING] x4 --> FIXED (267e678; mid-run Connect re-read simulated)

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs
- [WARNING] x3 --> FIXED (6fbc5a4)

#### Iteration 12
**Reviewer model:** fable
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING], [CONVENTION] --> FIXED (2aee660)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 2 CONVENTIONs, 2 NITs
- [WARNING] x3, [CONVENTION] x2 --> FIXED (0f8643a); install/setup.sh now lets the latest reading of the choice decide (9 combinations simulated)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
- [WARNING] docs/message wording --> FIXED (f0149ca)

#### Iteration 15
**Reviewer model:** fable
**New findings:** 1 WARNING, 3 NITs
- [WARNING] native-app/main.swift stopBoard outcome was a Bool --> FIXED (c5498a0, StopOutcome)

#### Iteration 16
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 4 NITs
- [WARNING] --> FIXED (68c245f)
- [WARNING] install/setup.sh read-then-act window when the choice changes mid-install --> DEFERRED: documented in setup.sh and on the card; no lock built (decision)

#### Iteration 17
**Reviewer model:** sonnet
**New findings:** NITs only
**Converged** pre-merge. Merged origin/main (d2947d9).

#### Iteration 18
**Reviewer model:** fable
**New findings:** 1 WARNING, 2 NITs
- [WARNING] #4347 relaunch armed after Connect --> FIXED (3d67d82)

#### Iteration 19
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
- [WARNING] x2 --> FIXED (4157d0b)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
- [WARNING] choice message trusts the page on this install's port --> DEFERRED: same trust as the Dock badge, on the card
- [NIT] missing marker --> FIXED (2753cc2)

#### Iteration 21
**Reviewer model:** fable
**New findings:** 2 WARNINGs, 2 NITs
- [WARNING] pre-#4356 installs asked again on update --> FIXED (d0b0052, migration writes run)
- [WARNING] update overlay under the first screen --> FIXED (d0b0052)

#### Iteration 22
**Reviewer model:** opus
**New findings:** 5 NITs
**Converged.** Final validation then failed 2 (stale-silences, consolidated-980) --> FIXED (3fb5662)

#### Iteration 23
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
- [WARNING] stale row numbers in comments --> FIXED (b9f714f)

#### Iteration 24
**Reviewer model:** fable
**New findings:** 1 WARNING, 1 CONVENTION, 1 NIT
- [WARNING] migration only grepped, not run --> FIXED (f136301, behavioural arms in tools/test-install.sh)
- [CONVENTION] grid row comment --> FIXED (f136301)

#### Iteration 25
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
- [WARNING] stale-app answer after Connect --> FIXED (15a68ac, offerRelaunch stands down)

#### Iteration 26
**Reviewer model:** fable
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] restart screen self-recovery left the first screen hidden --> FIXED (0ebfbe9)
- [CONVENTION] plan lacked the release switch --> FIXED (0ebfbe9)
- Validation then red on the browser-check surface gate --> FIXED (e7b980a trailers)

#### Iteration 27
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
- [WARNING] give-back only regex-pinned --> FIXED (82af8dc, sandboxed vm test, control seen red)

#### Iteration 28
**Reviewer model:** sonnet
**New findings:** 1 WARNING
- [WARNING] tools/test-install.sh -A6 window fragile --> FIXED (b0adf59)

#### Iteration 29
**Reviewer model:** fable
**New findings:** 1 WARNING, 4 NITs
- [WARNING] install/setup.sh "set not to run agents" also printed for an unreadable choice --> FIXED (36ff76f)

#### Iteration 30
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 2 NITs
- [WARNING] restart-guard check not mutation-proof; vacuous half-check --> FIXED (fc5cbc7)
- [WARNING] switch-off installer lines promise app behaviour --> DEFERRED: recorded in the plan (installer not behind the switch; with no choice file it behaves as today)
Merged origin/main (06a4c08).

#### Iteration 31
**Reviewer model:** sonnet
**New findings:** 0
**Converged.** The final run then found a -A3 window in tools/test-install.sh broken by a comment line --> FIXED (c55ae28, four windowed checks strip comments first)

#### Iteration 32
**Reviewer model:** fable (reviewed c55ae28)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - no new actionable findings. The final run then passed test-install 374/0, but main had moved 30 commits (conflict in web/index.html with #4407 and #4408); merged 2a3b753.

#### Iteration 33
**Reviewer model:** opus (the merged diff)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings:** 1
- [WARNING] native-app/main.swift:1987 switchToConnect - agents keep running after Connect on a damaged file --> duplicate of iteration 9 (DEFERRED, on the card); its new quit-dialog facet recorded in the plan (553495b)
**Converged** - no new actionable findings.
Main moved 29 more during the 0.7.07 cut hold; merged cleanly (3c956a0).

#### Iteration 34
**Reviewer model:** sonnet (the merged diff; focus #4390 consolidated Projects, #4438 first-run model step)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 new NITs (it restated the pending real-hardware proof, already named in the plan)
**Converged** - no new actionable findings.

Validation at the final head e980274: PASSED (11647 tests, 0 fail; run while another agent's full suite overlapped it). Two earlier reds at merged heads were flaky tests on main, filed as #4478 (a folder race between two test files) and #4483 (a 1ms clock race); each passes alone. test-install at c55ae28: 374 passed, 0 failed, #4356 section 53/53; main has not changed install/setup.sh or tools/test-install.sh since. Browser checks at 3c956a0: render-firstrun-choice-4356 33/33, render-restart-screen-4343 62, render-engine-restart-4408 all passed.

### NITs (non-blocking, recorded, not changed)
- [NIT] server.js /api/engine/restart - a browser tab's Restart pressed at the same moment as Connect can restart the board until the next app launch (iteration 33)
- [NIT] tools/test-install.sh:820,871,873,874 - a blank line between anchor and partner still false-reds; `grep -vE '^[[:space:]]*(#|$)'` would cover it (iteration 32)
- [NIT] c55ae28 commit message - its negative control used an unrelated file; test-install.sh itself self-matches checks 1-2 (iteration 32)
- [NIT] web/index.html update-overlay guard covers a state nothing reaches today (iteration 22)
- [NIT] two comments predate the migration (iteration 22)
- [NIT] two narrow races can put a board-only dialog on a connect Mac (iteration 22)
- [NIT] _do_open wording (iteration 29)

### Strengths (across all iterations)
- Pure Swift decision functions pinned by a 40-row selftest gated in the bundle build
- Installer re-reads the choice at every board decision; latest reading decides
- Each test had a mutation seen red
