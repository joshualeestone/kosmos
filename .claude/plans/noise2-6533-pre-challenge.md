---
pre_challenge: true
method: challenge-loop
branch: noise2-6533
diff_hash: 23d1c82907376530349baa2632f39131fa7b559bc52577aa592e40a833726f67
validation: passed
subdir_audit: passed
timestamp: 2026-10-19T05:35:21Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings:** 1 BLOCKER, 20 WARNINGs, 0 CONVENTIONs across 10 iterations (plus 22 NITs; iteration 8's
CONVENTION line reported that it found no guard breaks, so it is not counted as a finding)
**Fixed:** the BLOCKER and 14 WARNINGs | **Withdrawn:** 1 (#6534) | **Decided and disclosed:** 5 WARNINGs (below) |
**Asked:** 0

The branch was squashed and amended across rounds, so each round reviewed a different commit. Dispositions below
are recorded by what the final code (18d8475c) shows.

Validation (6j), through queued-heavy:
- Run 1 at dd097683 (before the last fix): 1 fail, web.consolidated-774 (a source pin: paintPjNone within 4 lines
  of `PJ_READ_FAILED = false`). Fixed by moving the offline-note call above the outcome lines. Run 1's browser
  checks did not run (Playwright was not on NODE_PATH; two printed SKIPPED), so they are not counted.
- Run 2 at 18d8475c, tools/run-tests.sh: node 22077 tests, 21779 pass, 298 skipped, 0 fail, RUN_EXIT=0.
- Browser checks at 18d8475c with NODE_PATH set, each exit 0: render-phone-offline-718 19 pass,
  render-acct-stopmove-6214 42 pass, render-unread-edge-3743 72 pass, render-agentdm-3414 40 pass,
  render-restart-screen-4343 78 passed (its tally form). render-update-abort-2055 was not run locally: it needs the
  sandboxed board that tools/browser-checks.sh boots (a direct run got connection refused). This branch does not
  change it or its surface (#6534 withdrawn); CI runs it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] #6534 hid the update chip while the abort notice shows, but the abort marker is sticky and with
  auto-update off the chip is the only Update door on the board --> WITHDRAWN: #6534 not built, the chip and its
  paint order are as on main, the card closed as not planned with the reason recorded on it
- [WARNING] the #6533 comment ("the reloaded page offers Update again from its own chip") contradicted #6534 -->
  FIXED (with #6534 withdrawn the comment is true)
- [WARNING] loadProjects set BOARD_DEVICE_OFFLINE but never painted the top note, so a phone could show the
  shortened sentence with no "You are offline" --> FIXED (loadProjects' catch paints the offline note)
- [WARNING] under 720px the note's small line is hidden, so the not-connected sentence is not on screen on a phone
  --> FIXED (stated in the code comment and the plan; the bold "You are offline" carries the fact)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a Browser-check-surface trailer described the withdrawn #6534 change --> FIXED (trailer gone)
- [WARNING] the plan said the top note names the machine that did not answer; only true when nothing answered -->
  FIXED (plan and the render-phone-offline-718 header say "when nothing answered")
- [WARNING] the #6537 loadProjects test was a loose source-order pin --> FIXED (a bounded pin inside the catch, and
  the real loadProjects runs end to end against the real paintOfflineNote)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the flag-site count matched only one assignment shape --> FIXED (every non-false assignment is counted,
  with a control that a stray `= true` with no paint reds it)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a readable projects read reset the flag but left the offline note up --> FIXED (offlineNoteDown on a
  readable read)

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] the success-path clear read `dataset.on` on a test stub with no dataset, turning a 200 into a failed
  read in web.projects-signed-out-718 --> FIXED (dataset checked, and the call is try-wrapped)
- [WARNING] a failed read with the device online never took down an offline note --> FIXED (the catch's else runs
  offlineNoteDown)
- [WARNING] comments claimed the projects path clears only "its own" note --> FIXED (comment says whichever poll
  painted it; a "not answering" note is never cleared from there)
- [WARNING] the plan called the no-version branch unreachable and removed --> FIXED (the plan says the sentence went
  and the branch stays, defended by its own test)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] after a projects read clears the note, the agents card can keep its shortened sentence until the next
  status poll --> DECIDED: accepted gap, new with this change, disclosed in the code comment, plan and commit
  message; the device is online then
- [WARNING] the did-not-take line rebuilt the `still` string in a second form --> FIXED (reuses `still`)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the commit message said the shortened box never shows without the note --> FIXED (the message states
  the gap)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] the gap was described as "as before" --> FIXED (now "new with this change")
- [WARNING] the projects read putting the note up and taking it down is new behaviour on a removals board -->
  DECIDED: needed so the shortened sentence is not shown alone; disclosed in the plan and commit message
- [WARNING] with no version known, did-not-take stops at the bold line --> DECIDED and recorded on #6533: the case
  cannot occur (did-not-take needs both versions), the overlay never names an empty version, and a test pins it
- [WARNING] the #6536 cannot-restart tail is a merge with new wording --> DECIDED and recorded on #6536: the old tail
  repeated "still running the old copy" from the line before it
- [WARNING] the shortened small lines are hidden under 720px --> DECIDED: the bold lines carry the news at every
  width; stated in the plan

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged**: no new actionable findings.

### NITs left open (non-blocking)
- loadProjects' catch-side `offlineNoteDown()` is not try-wrapped like its siblings: the paint is an innerHTML
  clear and a dataset delete, very unlikely to throw.
- #6538: a refusal that gets no top note leaves the card naming no machine; disclosed in the plan, and the removed
  sentence was loose there too.
- The plan names "review 1" and "review 5" without saying what they were.

### Strengths
- One rule (offlineNoteDown) for taking the offline note down, and every place that sets BOARD_DEVICE_OFFLINE true
  paints the note in the same branch, guarded by a count with a control.
- Each removal has a test arm with a control on the kept line, so a removal that took the kept line too goes red.
