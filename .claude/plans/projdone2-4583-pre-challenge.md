---
pre_challenge: true
method: challenge-loop
branch: projdone2-4583
diff_hash: 76b9eb531a0e8ddef49a0df9d39f0f7131122b1be110421dc7b5a1adcfd887cc
validation: passed
subdir_audit: passed
timestamp: 2026-09-30T12:11:56Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 separate blind reviewers (Opus and Sonnet alternating)
**Converged:** Yes (round 6: nothing above NIT)
**Total findings acted on:** 0 BLOCKERs, 11 WARNINGs, several NITs
**Fixed:** every WARNING, each with a test that fails on revert | **Deferred:** 0 | **Asked:** 0

Full validation clean on Mortals at 1ebdb07fb, after main (with #4609) was merged in and main's newer guards were met
(fixture-discipline, the pointer-site count, the loadProjects harness, the notice wiring pin, five surface trailers).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs
- [WARNING] the coordinator rule matched Marketing Manager, Tech Lead, Lead Developer --> FIXED: its own narrow PROJECT_COORDINATOR
- [WARNING] "Done not set" showed for a folder with no BRIEF.md and on the welcome project --> FIXED: no brief says nothing; the welcome brief carries WELCOME_DONE
- [WARNING] a done typed for a folder that already had a BRIEF.md was dropped --> FIXED: fillDone replaces the placeholder or adds a Done section, and leaves a person's own section alone

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs
- [WARNING] fillDone passed the person's words as a replacement string ($& and $' interpreted) --> FIXED: a function replacement
- [WARNING] the page cleared the warning on any null read, even one started before the add --> FIXED: numbered reads
- [WARNING] a placeholder quoted inside other text counted --> FIXED: whole line only
- [WARNING] a Done heading titled another way got a second section --> FIXED: any level, any case, trailing words
- [WARNING] BRIEF.md could be read or written through a symlink or at any size --> FIXED: regular file under 256 KB (lstat)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING
- [WARNING] a project given a done but no goal told its agents to ask for the done again --> FIXED: the goal-only note is main's text; the combined note only when both are missing

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
- [WARNING] a done refusal reached no field --> FIXED: its own error line, a pre-check at 1000 code points, and the engine refusal routed there

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING
- [WARNING] the done-box route matched a folder refusal quoting a project named "What done looks like..." --> FIXED: anchored to cleanDone's two sentences

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
- [NIT] per-read file reads are uncached --> ACCEPTED
- [NIT] a person's own brief with no Done section reads as set --> ACCEPTED
