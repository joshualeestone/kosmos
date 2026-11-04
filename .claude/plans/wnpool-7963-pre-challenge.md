---
pre_challenge: true
method: challenge-loop
branch: wnpool-7963
diff_hash: aad4690b46d6832c0fa1c62731ee5485bbdf3b91fe268faf70eb05a9f2d19ab5
validation: passed (Mortals, full suite: 27047 tests, 0 failed, entry status clean, on hash 954f01b56b37; after it only two pool lines and the built list changed, and the pool, release-notes and whatsnew tests ran on them. PR CI runs the suite.)
subdir_audit: passed
timestamp: 2026-11-04T22:23:40Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Iteration 2's two wording WARNINGs were taken as the reviewer wrote them, with no further round, since they are words only.
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 1 NIT

Eight What's New pool items for 0.7.87 to 0.7.89, plus the rebuilt list (#7963).

### Iteration 1
- [WARNING] "Starred agents stay on top" described an iPhone-only change (#7684): stars were already first on the desktop since 0.7.63, and iPhone people do not read this list --> FIXED: removed, and the slot goes to held questions, which did change on the board in 0.7.89.
- [WARNING] the Linux line claimed more than was measured --> FIXED: "shows the command to run".
- [NIT] "your" changed reader between two notes --> FIXED.

### Iteration 2
- [WARNING] the window line implied agents hold questions unprompted, when the doctrine allows --held only if the person asked --> FIXED: "Ask an agent to hold its questions...".
- [WARNING] the held note did not say who gets the note --> FIXED.
- [WARNING] the Linux note names a command that today leaves a live Linux board stopped (#7981, fix in #7985) --> HANDLED BY ORDER, not code: notes ship only in a cut, and Splinter's ruling at 16:18 is that 0.7.90 is not cut until #7985 is on main, so the note and the fix arrive together. Rejected status held: it would need a second change to release it.

### Measured
- Every `since`, by the content of each cut's bump commit; the four agent commands are in both CLIs.
- web/whats-new.json is what the pool builds, online and offline; whats-new-check passes mac and windows.
- A rebuild on this head leaves the tree clean.
- Mona Lisa read the window copy. Her wording for the orb and address lines is in. Iteration 2's reword of the held line came after her read.

### Weakest premise
That the next cut really waits for #7985. It is a stated condition, in my notes and on this proof, and nothing mechanical enforces it.
