---
pre_challenge: true
method: challenge-loop
branch: leftover-disk
diff_hash: 6d7954082a04e8b95e0b0b73eb65af6ffed920b317bd66ac1a9c7520f7de2893
subdir_audit: passed
timestamp: 2026-08-24T04:08:49Z
iterations: 3
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** No (stopped under the fleet stopping rule after iteration 3; see the stop record)
**Total findings:** 13 (2 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 12 | **Deferred:** 1

### Stop record (why no iteration 4)

The fleet stopping rule: a round finding new defects in ORIGINAL code earns
its cost; a round finding defects in the previous round's FIXES means the
loop is eating itself, ship. Iteration 1 found the branch's two real
blockers in the original work (a false name-freeing promise; the birth tie
keyed on typed names while folders live under slugs), both measured live by
the reviewer and both fixed with pins. Iteration 2's warnings tightened the
tie (a birth line vouches for its own era, not the name forever) and the
sentences; iteration 3's findings were wording and accounting defects in
iteration 2's own fixes (the job-arm sentence, the flag's coverage of the
birth log). No security-grade finding after iteration 1; the loop turned to
face itself. The same rule the PM endorsed in writing twice tonight.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 BLOCKERs, 2 WARNINGs, 3 NITs
- [BLOCKER] the stray sentence promised "Remove it here to free the name" and removal cannot deliver it: remove is not delete by design, and create refuses names whose files survive --> FIXED: sentences promise only what removal does, the retracted promise pinned dead by doesNotMatch, the scope correction recorded in the plan, and the delete-leftover feature carded as #514 (also corrected #127's same-shaped sentence beside it)
- [BLOCKER] the birth tie keyed on the name as typed while folders are made under the slug, so capitalized creations' remains stayed invisible --> FIXED: slug-keyed, pinned with a Casey line against a casey folder
- [WARNING] a test title claimed a state its body never constructed --> FIXED: the removed-stray state is now really built and asserted (carried as removed, never queued for repair)
- [WARNING] neverRecorded renders a loose provenance label on stray cards --> DEFERRED with the reasoning at the site: the sentence the person acts on (the panel explainer and the because) is true; relabeling the card state belongs with #514's surface work
- [NIT] "only" claimed exclusivity the walk cannot see --> FIXED: dropped
- [NIT] a directory named like a plist would enumerate --> FIXED: isFile gate
- [NIT] plan named the wrong test file --> FIXED

#### Iteration 2
**New findings:** 3 WARNINGs, 3 NITs
- [WARNING] a created line blessed its name forever, so a later checkout under a once-used name would surface wearing a Remove control --> FIXED: the latest line's time bounds the folder's birthtime (a day of slack); the later-tenant case has its own control-paired test
- [WARNING] the no-hostage comment was false on case-insensitive filesystems --> FIXED: the comment now names the case-variant limit honestly and routes the class to #514 (a row whose removal must refuse exact-spelling is worse than the blindness)
- [WARNING] "no record" was contradicted by the receipt that surfaced the folder row --> FIXED: per-arm sentences
- [NIT] could-not-look collapsed into found-nothing --> FIXED: straySweepFailed flag with the ENOENT split, driven by an unreadable-root test
- [NIT] the fail-soft test comment claimed an arm it never drove --> FIXED
- [NIT] one uncomposable row emptied the whole offline list --> FIXED: per-row guard

#### Iteration 3
**New findings:** 2 WARNINGs, 3 NITs (all in the prior rounds' fix layer)
- [WARNING] the job-arm sentence claimed no-record universally while the arm is selected by which files remain --> FIXED: claims exactly what was checked ("no longer has this agent set up")
- [WARNING] createdLog swallows read errors into [], so an unreadable birth log hid every folder stray with the flag false --> FIXED: an empty answer from a file with bytes raises the flag; ENOENT stays a fresh machine
- [NIT] per-entry stat errors did not raise the flag --> FIXED
- [NIT] the per-row drop is unaccounted --> noted at the site, accounting field routed to #514
- [NIT] the restored-folder class was unnamed --> FIXED: named in the KNOWN LIMIT block

### STRENGTHs carried across iterations
- The roster-from-records ruling survives: a stranger's checkout stays invisible, pinned at unit and route level with positive controls beside every absence assert, and verified against this very machine's 17 checkouts (zero ties).
- The repair guard is proven in its failing direction with a repaired control beside the unrepaired stray.
- The enumeration-from-profiles-only failure was proven by perturbation: union disabled, both route pins went red with their own message; restored, green.

### Validation
Full suite green after every iteration, exit codes read from log files, never a pipe. Final validation: PASSED, hash 6d7954082a04. Subdir audit: passed. No em dashes in any added line.
