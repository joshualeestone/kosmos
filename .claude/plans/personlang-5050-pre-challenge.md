---
pre_challenge: true
method: challenge-loop
branch: personlang-5050
diff_hash: 2ddf45df8145ea38126e015a768450dafed18122e00ea84f11af25a81ea14b80
validation: passed
subdir_audit: passed
timestamp: 2026-10-03T02:05:30-0500
iterations: 23
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 23
**Converged:** Yes (iteration 23, opus: 0 new BLOCKER/WARNING/CONVENTION; its one WARNING, no opt-out, duplicates reviews 8/12/16/20 and is deferred to #5080)
**Total findings:** 1 BLOCKER-class bug caught in-session before commit (a `trusted` flag colliding with tellAgent's vouch bypass, renamed `sure`), about 35 [WARNING]s across 23 iterations, most fixed. Full per-review record: .claude/plans/personlang-5050.md.
**Deferred:** opt-out (#5080), first-boot write cost, defaults stall, size-limit noise, near-empty files (each recorded in the plan with its reason).

### Per-Iteration Breakdown

Reviewer models alternated opus (odd) and sonnet (even). Self-generated counts were not recorded per iteration.

#### Iteration 1
**Reviewer model:** opus
- The block is now kept at the END: writing it takes it out and appends it again unless it is already last (then it is replaced in place, byte-equal when unchanged, so no boot rewrites the file). The boot sweep runs after the About-you sweep, the last one that can append a block. A block added between boots sits behind it until the next start. - The test runners export AGENT_WORKFORCE_PERSON_LOCALE=en, so no test dep

#### Iteration 2
**Reviewer model:** sonnet
- A boot read that failed or timed out (Mac `defaults`) falls back to Node's locale, often en-US, which used to remove the block from every agent. Now `read()` says whether the answer is sure (the override, or a Mac `defaults` answer) or a fallback (Node's Intl locale): a fallback may ADD a block but never removes one, like the About-you sweep's add-only boot. While building it I first named the flag `trusted`, which

#### Iteration 3
**Reviewer model:** opus
- Off a Mac every read was a fallback, so a block could be added (from the Windows REGION setting) and never removed. Now a fallback changes nothing in either direction: this ships for Macs only, and Windows is untouched. - A fallback read is no longer cached for the process (a Mac read that timed out at boot is retried by the next create). A seam lets the test give the no-argument read a failing Mac; mutations cachi

#### Iteration 4
**Reviewer model:** sonnet
- A failed Mac read is kept 5 minutes (FALLBACK_MS) before `defaults` is asked again, so a hanging `defaults` (2 s timeout) costs at most one stall per 5 minutes, not one per create; a sure read is kept for the process. - Nothing to do is TOLD without touching the file: an unsure read, or a sure English read for an agent with no instructions file. So an English Mac's boot log carries no "could not refresh ... your la

#### Iteration 5
**Reviewer model:** opus
- `defaults` is called by its absolute path, /usr/bin/defaults, as machine.js does, never whatever is first on PATH. - A behavioural create test (engine/create.test.js, #5050): with the override es-MX a real create writes a file that ENDS with the block; with en-US it has none. Disabling the create splice reds it. The splice happens before the runner picks the file name (CLAUDE.md or AGENTS.md), so both runners get t

#### Iteration 6
**Reviewer model:** sonnet
- The header says the override is read once per process, like the setting. - Deferred, as the sibling blocks do: a create-time step reports "may start in English" if the read itself throws (it does not in practice: `read` catches every failure), and an agent at the size limit logs once per boot.

#### Iteration 7
**Reviewer model:** opus
- Moving the block used removeBlock, which joined the person's own text after the block onto what came before it (a paragraph turned into a list item) and rewrote the file at every boot. Now the block moves ONLY when everything after it is other Kosmos blocks (the case moving exists for); if the person wrote anything after it, it stays where it is and is replaced in place. The move cuts exactly the block and rejoins 

#### Iteration 8
**Reviewer model:** sonnet
- `macPreferred` reads only the FIRST array element; one that does not parse gives null (not sure), never the second language. Test + mutation (the old whole-output scan) reds. - Deferred: a sure English read from the override strips the block at boot, a wider reach than the add-only About-you sweep. The override is a test seam (production boards run under launchd with a fixed env); the Mac `defaults` answer is the p

#### Iteration 9
**Reviewer model:** opus
- MEASURED the mid-file position the block spends time in between boots (a block added behind it, or the person's note): the branch's block placed at 64% of zz-test-4491's 7,670-word file, the person's own note last, April's setup exactly. Probe: it quoted the last heading ("## A note from the person"), so the file is loaded. Result: Spanish 2/2. So the end position is what April measured, and the mid-file gap betwee

#### Iteration 10
**Reviewer model:** sonnet
- The header, create and boot comments now say what the code does: appended at the end, moved back behind a Kosmos block appended after it, left in place when the person wrote after it; and that every measured position held (end, top, 64%), so none depends on the move. Rewrapped. - Duplicates of deferred items: the size-limit drop and its boot log (review 6), the `defaults` stall (review 4).

#### Iteration 11
**Reviewer model:** opus
- Removing the block with the person's text after it now cuts exactly the block and keeps one blank line (removeBlock joined their paragraphs, the defect review 7 fixed on the move path). (Its line-ending and end-of-file handling is corrected in review 21.) Last in the file it is still removeBlock, byte for byte. Test with their text on both sides; mutation (back to removeBlock) reds. - The override must be a 2 or 3 

#### Iteration 12
**Reviewer model:** sonnet
- Deferred, with reasons. (1) No opt-out: a person who deletes the block, or wants English agents on a Spanish Mac, gets it back at the next boot; every managed block (connections, dmfiles) is re-asserted the same way, the block tells the agent to follow a person who writes in another language (the behaviour April measured), and the Settings picker is the named follow-up that gives the opt-out. (2) The first boot aft

#### Iteration 13
**Reviewer model:** opus
- `onlyManaged` counts only TIGHT marker pairs (no second start between, as findBlock pairs them) and treats any leftover marker as the person's text, so a stray start from a hand edit cannot get the block moved below their words. Test with a control; mutation (loose pairing) reds. - create reports the step failed for pasted instructions with two language blocks on ANY sure read (English too); a behavioural create te

#### Iteration 14
**Reviewer model:** sonnet
- create acts on a sure read only, and its step speaks only for what it did: two pasted blocks get their own message ("found two language sections ... left them as they are"); the size-limit message only when there was a block to add; an unsure read reports nothing. A create test runs the unsure case (a failing Mac read, Spanish region): no block, no step. Mutation (acting on an unsure read) reds. - An agent with no 

#### Iteration 15
**Reviewer model:** opus
- The move to the end is REMOVED. Every measured position held (end, top, 64%), so moving only rewrote the file, rotated the person's one-deep undo and prompted a restart for nothing, and it carried most of the module (onlyManaged and the review 7/11/13 rules). The block is appended when missing and replaced where it is after that. create still splices it last, so a new agent's file ends with it. A test pins that a b

#### Iteration 16
**Reviewer model:** sonnet
- Mac-only scope stated on #5050, and the follow-up filed as #5080 (Settings picker = the opt-out, a measured Windows source, Codex/Gemini/Grok). Duplicates: override removal (review 8), no opt-out and the restart prompt (review 12).

#### Iteration 17
**Reviewer model:** opus
- A Mac whose language read failed now says so once at boot ("Kosmos could not read this Mac's language setting ..."), so it no longer looks exactly like an English Mac. Pinned in the boot-wiring test. - The English boundary test uses enm (Middle English), which starts with "en" and is not English; the create comment says a sure English read also removes a block that came in with pasted instructions. - Recorded, same

#### Iteration 18
**Reviewer model:** sonnet
- Checked, not an issue: "check-block-delivery over-reports UNDELIVERED for agents with no file or two blocks". The tool lists only agents that HAVE a brief (tools/check-block-delivery.js:159, briefPath !== null), and counts delivery by the marker being present (:190), so a two-block agent reads delivered, never undelivered. - Duplicates: the first-boot undo and restart cost (reviews 12, 17), no opt-out (12, 16, #508

#### Iteration 19
**Reviewer model:** opus
- The language name carries the script and never the region: zh-Hant-TW reads "Traditional Chinese", zh-Hans-CN "Simplified Chinese", es-MX still "Spanish" (the tag beside it keeps the region). Supersedes the review-5 "known" note. Test with a control; mutation (base language only) reds. - Two pasted blocks on an English Mac now say "remove them", not "keep one".

#### Iteration 20
**Reviewer model:** sonnet
- On an English Mac, a language section that came in with pasted instructions is taken out at create AND a step says so (ok: true, "took out a language section ... because this Mac is set to English"). Behavioural create test; mutation (silent) reds. - Duplicates: no opt-out / destructive sure-English removal (reviews 8, 12, 16; stated on #5050, #5080), the defaults stall (4, 15).

#### Iteration 21
**Reviewer model:** opus
- Chinese with no script in the tag (zh-HK, zh-TW, zh-MO, as Apple writes them) now reads "Traditional Chinese": the script is inferred (Intl.Locale.maximize) for Chinese only, so "es" does not become "Spanish (Latin)". Tests; mutations (no inference, inference for all) red. - Removal keeps the file's own line ending at the seam and leaves everything after the block exactly as written (it used to turn CRLF into LF an

#### Iteration 22
**Reviewer model:** sonnet
- tools/test-install.sh (its export and its env -i reboot simulation) and tools/build-kosmos-bundle.sh's smoke boot pin AGENT_WORKFORCE_PERSON_LOCALE=en, so those real boards write no language block on a non-English Mac. Pinned in the runner test; mutation (bundle unpinned) reds. The 27 test files that read either script: the same 6 fail on origin/main outside the runner, none only on the branch. - Duplicates: the pr

#### Iteration 23
**Reviewer model:** opus
[NIT] only, plus one duplicate [WARNING] (no opt-out, deferred #5080). No new code finding: converged.

### After convergence

[WARNING] caught by the Mortals full validation at 6be01ae11 (14406 pass, 1 fail): engine/machine.test.js counts "this Mac" in person-facing files, and my new boot line said it. Fixed to "this computer's" plus its pin (e2faaccab), copy only. The failing run is its red control; machine + personlanguage 92/92 after.

### Validation

Full validation on Mortals at 71264265a (rebased on main, both browser-check gates green locally first): 14531 pass, 0 fail, EXIT=0, 01:59 CDT 10-03.
