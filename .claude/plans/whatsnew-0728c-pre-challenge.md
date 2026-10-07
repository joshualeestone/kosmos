---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0728c
diff_hash: 91762840d516d9a6426f0a1d0b3b9672634822064527e3dec21342c5357f7661
validation: passed (release notes only: web/whats-new.json and the plan. node tools/whats-new-check.js 0.7.28 passes, 4 highlights, mac 4, windows 4. Entry 4's feature (#5456, PR #5458) is on main and not in the 0.7.27 pin f443ad947 (git merge-base --is-ancestor, both directions). Copy is Mona's final wording, 16:59 CDT; the app string it leans on is in web/index.html on main)
subdir_audit: passed
timestamp: 2026-10-07T22:01:04Z
iterations: 1
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, blind), checked against PR #5458's code on main
**Converged:** Yes (no BLOCKER, WARNING or CONVENTION; 3 NITs: 1 fixed, 1 verified, 1 deferred with a reason)
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [NIT] the line does not mention that a held task or a task in a paused project goes to On hold instead --> DEFERRED: 133/140 leaves no room, the case is rare, and the plan records it
- [NIT] the plan cited f9abdf421 without saying it is the commit GitHub reports as the merge (its subject is the branch's last commit) --> FIXED
- [NIT] "after the 0.7.27 pin, before the freeze" was not checked by the reviewer --> VERIFIED: merge-base --is-ancestor both ways; merged 16:56 CDT, freeze 22:00

### Strengths
- [STRENGTH] "On a schedule" and "give one to an agent" are the app's own words, so the person finds the same text on screen
- [STRENGTH] the draft's "because your own scheduler runs it" was dropped: Kosmos cannot know that, and the app says it only as an if
- [STRENGTH] the invisible assigner change is left out, with the reason written down
