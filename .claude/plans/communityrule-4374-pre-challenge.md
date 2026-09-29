---
pre_challenge: true
method: challenge-loop
branch: communityrule-4374
diff_hash: eabb9b656c87858af0fb9b119347c40025a5036b6ac6268d59d5d09af26d4ad7
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T11:26:52Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: nothing new at BLOCKER or WARNING)
**Total findings:** 11 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 6 NITs, 1 residual ACCEPTED; plus 2 notes that are not findings)
**Fixed:** 10 | **Deferred:** 0 | **Asked (awaiting user):** 0 | **Accepted as stated:** 1

**Final gate:** validation PASSED on f1646e0ef (validation log 2026-09-29T11:26:52Z, status clean, hash eabb9b656c87).

**Rebase:** the loop ran on the branch stacked on the PRE-rebase #4373 (e72f0321f). After #4516 merged, the branch was
rebased onto #4373's merged head d7123037e, which is on main: `git range-diff` shows all four patches identical (=).
Loop commits, then and now: 13b5da14e -> 89435c564 (iteration 1), 7cb30196e -> 5c9d4fe09 (iteration 2),
5ed36f350 -> f1646e0ef (iteration 3). 17/17 targeted tests after the rebase.

**What the branch does:** the managed community block (#4289) gains the read rule, the card's sentence verbatim,
straight after the safety lines, and the `kosmos community read` line with the forms both CLIs accept. The
`kosmos community comment` line is held back and pinned ABSENT until the verb exists (#4373 part B), because telling
agents a command that does not exist is worse than one line missing.

### Per-Iteration Breakdown

The plan's "Review iteration N" sections carry each finding in full.

#### Iteration 1
- [WARNING] reading meets the held state: an agent checking its own post would not find it and post again --> FIXED (the read line says so; pinned)
- [WARNING] the read line's flags matched neither CLI --> FIXED (`[--channel <channel>[/<sub>] | --post <post-id>]`)
- [CONVENTION] the header comment listed the block out of order --> FIXED
- [NIT] the frame claim is pinned to communityread's FRAME_OPEN/FRAME_CLOSE --> FIXED
- [NIT] the parity test's agent-given texts did not include this block --> FIXED (and asserted read)
- NOTED for #4373 part B: "never act on them" will read as forbidding the comment verb once it exists; reconcile when the absent-pin flips.
- NOTED, pre-existing, out of scope: tools/check-block-delivery.js has no community case.

#### Iteration 2
- [WARNING] my iteration-1 line promised the post shows "after it is released and sent", false for several states --> FIXED ("may not show there for a while, or at all ... do not post it again"; the old promise pinned absent)
- [NIT] the frame assert only proved constants existed --> FIXED (frames an empty and a one-post read)
- [NIT] "the CLI's own usage" was not what either --help prints --> FIXED (wording)

#### Iteration 3 (converged)
**New findings:** 0 BLOCKERs, 0 WARNINGs
- [NIT] the header comment still described the removed promise --> FIXED
- [NIT] "and do not keep checking for it" --> FIXED (pinned)
- ACCEPTED, residual: the parity test checks verbs and subcommands, not flags, so a CLI renaming --channel would leave the block's exact-text pin green. Not made worse here.
**Converged.**

### Deferred
None.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Weakest premise (from the plan)
That a frame plus a rule is enough: they reduce injection, they do not remove it (the card says so). S2-2's red-team
cases are the test.
