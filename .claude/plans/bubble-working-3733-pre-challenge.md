---
pre_challenge: true
method: challenge-loop
branch: bubble-working-3733
diff_hash: fe4172e551338928dfc6df3cf2fe8b1f07e6310430e96d61d2939389817ba7f9
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T15:43:26Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 had nothing at WARNING or above)

#### Iteration 1 (opus)
- [WARNING] The working dots were rebuilt every paint, restarting their animation (#3421). Fixed: written only when a keyed set of inputs changes; B20 asserts one node across ticks.
- [WARNING] A reply that had landed sat under a "working" from an older board snapshot. Fixed: heardAt against LAST_AT, as paintBusy does; B20 arm.
- [WARNING] A broken sign-in showed nothing in the chat. Fixed: busyRow's sign-in line, no folded dots for it; B20 arm.
- [NIT] The folded bubble's label says working, with "something new to read" first. Taken.

#### Iteration 2 (sonnet)
- [WARNING] The panel's starting markup still carried the cut "An AI that knows Kosmos" line. Fixed: empty, one copy of its words; B3 asserts neither cut line is anywhere in the page (control: with the line back, it fails).
- [NIT] heardAt not reset with heard; wasWorking not reset when the assistant hides. Taken.
- [NIT] The B16 tips-retry fix is out of scope. Kept: it is a flake fix for an arm this branch runs.

#### Iteration 3 (opus)
- [WARNING] The working row took the thread's height, so a reply could land under it. Fixed: the thread stays at its end as the row shows or goes; B20 arm.
- [WARNING] heardAt moved forward on every poll while folded. Fixed: timed once, when the dot lights.
- [WARNING] "Working" replaced the reply in one polite live region before it was read. Fixed: its own region, #asp-live-busy; B20 arm.
- NITs taken: sign-in announced once; the opening message drawn before the first read; wasWorking reset on forget.

#### Iteration 4 (sonnet)
- [WARNING] asbOpen clears the dot before the poll reads it, so the round-3 guard never fired. Fixed: a dotTimed flag; B6 asserts heardAt survives the open (control: with the old guard it fails).
- [NIT] saidSignIn undeclared. Taken. [NIT] A folded broken sign-in has no bubble cue. Noted: the plan names only "working" for the label.

#### Iteration 5 (opus)
- [WARNING] The sign-in line was re-announced whenever its evidence changed. Fixed: keyed on the guide and its state; B20 arm (control: fails).
- [WARNING] The spoken sign-in included the hidden face and "!". Fixed: the words alone; B20 arm (control: fails).
- [WARNING] The scroll arm tested the direction that works without the fix. Fixed: B20 asserts the thread is at its end as the row shows (control: fails).
- NITs taken: README row for #3738 and B20; saidSignIn and wasWorking reset everywhere; dotTimed cleared once an open read has run; the scroll also runs when a shown row changes height.
- [NIT] No working row for a guide between Send and the next board snapshot (up to 5s). Noted: working comes from the board for a guide.

#### Iteration 6 (sonnet)
No BLOCKER or WARNING.
- [NIT] No arm for the hosted assistant's folded dots. Noted.
- [NIT] A folded broken sign-in has no bubble-level label. Noted, as in iteration 4.

## Validation
Full suite clean (6j 2026-09-25T15:42:54Z, hash fe4172e551338928dfc6df3cf2fe8b1f07e6310430e96d61d2939389817ba7f9), rebased on main with #3741 and #3742. render-assistant-bubble-3034 73 passing, render-assistant-hosted-3660 96 passing.
