---
pre_challenge: true
method: challenge-loop
branch: invfield-5275
diff_hash: 79d6391968fe12fb436a9f1a80d2c2f6a046958fb0dd030087d39eb09e1167e5
validation: not run locally (suite queue). Run instead after every round: federation page tests 87/87 and web.federation-3312.test.js 25/25 (from the worktree); page script parses; fixture-discipline and no-name-refs 24/24; surface gate rc=0 with two per-check trailers. A mutation control: removing selectForCopy's focus guard fails the moved-focus unit test (23/24), restored 24/24. render-federation-invite-4649's new arms are first run by CI's browser-checks on the PR.
subdir_audit: not run (same queue)
timestamp: 2026-10-06T08:34:04Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: no issues above low; two low notes kept)

#### Iteration 1 (opus)
- [MEDIUM] F1 select() moves focus even when the guard said not to (measured in Chromium, WebKit, Firefox); also on slice 1's two screens --> FIXED (selectForCopy: setSelectionRange when focus moved on)
- [MEDIUM] F2 "selected below" while the field sat above the line; no wording for the unfocused case --> FIXED (field moved below; a click + select-all line)
- [LOW-MEDIUM] F3 a 7-row field may not fit a short phone in a sheet that cannot scroll --> FIXED (5 rows, max-height 40vh; not measured on a phone)
- [LOW] F4 hiding the focused field dropped focus out of the sheet --> FIXED (focus returns to Copy the invitation)
- [LOW] F5 arms missed focus and the late-write hide --> FIXED (C4 focus, C6 moved focus, C7c hidden; header comment updated)

#### Iteration 2 (sonnet)
- [MEDIUM] unit harness never ran selectForCopy (a ReferenceError swallowed by a catch) --> FIXED (lifted; both branches tested; mutation control run)
- [LOW] the two code screens told a person who had moved on to press the copy keys --> FIXED (copyRefusedLine)
- [LOW] the field's aria-label promised a usable selection --> FIXED ("The whole invitation")
- [LOW] no arm for focus return --> FIXED (C4 focus-return arm); reopen-clears arm not added (fedInviteOpen's two lines are read in review 2 and 4)

#### Iteration 3 (opus)
- [MEDIUM] the sheet's bare Copy still called select() unconditionally --> FIXED (selectForCopy + copyRefusedLine)
- [MEDIUM-LOW] the create screen's moved-focus refusal reverted after 2 s --> FIXED (only "Code copied." reverts)
- [LOW] focus already in the field counted as moved away --> FIXED (activeElement === el counts as in; unit test)
- [LOW] select-all keys unchecked --> FIXED (C5 per platform)

#### Iteration 4 (sonnet)
- No issues above low. Matrix of four paths x focus (button / elsewhere / in field) x timing (at once / at the limit / late write): button text, line, selection and focus are consistent; no existing arm expects old text (C5b passes on the Chromium-only check; S1-S5 hit the focused branch).
- [LOW] no browser arm for the moved-focus branch of the two code screens (a unit test covers pjCopyInvite) --> KEPT
- [LOW] a late success while the person is inside the field empties it and moves focus to Copy the invitation --> KEPT (true to what happened)
