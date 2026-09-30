---
pre_challenge: true
method: challenge-loop
branch: projdone2-4583
diff_hash: 6791cdfdbf4a322d8801aa55d6c89fee0e73a9f6b2f5067a2b055b68e89b61f6
validation: passed
subdir_audit: passed
timestamp: 2026-09-30T14:19:57Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 separate blind reviewers, Opus and Sonnet alternating: 6 before main was merged, then 10 more
after merging main exposed a conjunction with #4581 (its show read this card's placeholder as the done)
**Converged:** Yes (second loop, round 10: nothing above NIT)
**Total findings acted on:** 0 BLOCKERs, 11 WARNINGs, several NITs
**Fixed:** every WARNING, each with a test that fails on revert | **Deferred:** 0 | **Asked:** 0

Full validation clean on Mortals at 8e28e4bd4 (hash 6791cdfdbf4a), after the second loop. The first validation
(1ebdb07fb) predates it.

### The second loop (after merging main), rounds 1-10
- R1 Opus: 2 WARNINGs (badge and show judged "done set" by different rules) --> FIXED: brief.doneSetFrom is the one rule
- R2 Sonnet: 2 WARNINGs (a retitled heading; fillDone adding a second Done section) --> FIXED
- R3 Opus: 3 WARNINGs (fillDone merging into a written done; a second section; heading shapes) --> FIXED
- R4 Sonnet: 2 BLOCKERs, caused by R3's widening of the Done heading (a "# Done Deal" title, a "### Done so far" note)
  --> FIXED: main's level-2 rule restored; fillDone scoped to the Done section
- R5 Opus: 3 WARNINGs (a Markdown-led done; own-heading levels; a placeholder remnant) --> FIXED
- R6 Sonnet: 2 WARNINGs (a backslash-led done; a note with a false reason) --> FIXED
- R7 Opus: 1 WARNING (a filled ## Done section dropped the typed done silently) --> FIXED
- R8 Sonnet: 2 WARNINGs (a Goal line vouching for a lost done; unreadable or read-only briefs) --> FIXED: any typed
  done not in the Done section is quoted to the team with its true reason
- R9 Opus: 1 WARNING (the welcome home's own done written into a person's brief) --> FIXED: seedDoneOnly
- R10 Sonnet: nothing above NIT. Converged.
Twenty controls, each red on revert. NITs accepted in each round's commit message.

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
