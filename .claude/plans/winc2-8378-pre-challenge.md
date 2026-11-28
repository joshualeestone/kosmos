---
pre_challenge: true
method: challenge-loop
branch: winc2-8378
diff_hash: 0f3fbe740da957f9b8f285eb14e9d428d15b85659a0906b0c46e635f15bcd336
validation: on head 43c4ca38b1. Mac: the 59 changed test files 1452 pass, 0 fail, 0 skipped (none newly skipped); guard tests (windows-tests-1777, windows-coupling-audit, fixture-discipline, engine.reachable, win32-separator-guard, no-name-refs, tmpscope) 97 pass, 0 fail, 9 skipped as before. GitHub windows-latest (run 46120990799, branch icecreamkitty-c2-8378-never-merge = this head plus the measurement tool): 57 of 59 files 0 failures; the 2 that fail are the carded production bugs #9270 (musefront) and #9271 (disconnect-agent), both off the Windows job. Before the change: 59/59 red (run 46115809463). The full suite runs on the PR's CI.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-28T07:26:31Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, the cap (Splinter's 8-round rule).
**Converged:** Yes, by the cap rule. No round found a BLOCKER except round 6, whose six were one class: symlink arms unguarded on a non-admin Windows laptop. They were fixed by a mechanical sweep of every ALSO file, not by sampling.
- Round 8 found no BLOCKER. Its one WARNING, a false "only" in a windows-tests.js comment, and its comment NITs were fixed in 43c4ca38b1. That commit changes comments only and was not re-reviewed.

Measured arms, red and green as they should be:
- devicedoor's SIGTERM arm, with its trap set 2 s late: red on the premise ("ended before its handler was in place"); green as written. Same check for the earlier node stand-in.
- musestatus's legacy-mark arm: 2 of 8 Windows runs red before its mtime was set in the past, 8 of 8 green after.
- create.blockdrop: red on Windows ("could not check which agents are already running") until it stubbed the roster, as create.spoken-name does; green after.
- Every Windows number is from GitHub's runner, an admin Windows Server image, not a person's laptop.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] chmod used only to make a write fail was skipped as "checks POSIX file modes" --> FIXED: those arms say what exists on Windows and name kosmos#9269 (#8456 is closed)
- [WARNING] devicedoor's SIGTERM-ignoring arm passed on Windows without running the SIGKILL path --> FIXED: skips there (no signals); on the Mac a marker proves the trap was set
- [WARNING] guide-deny and agentautostart-4479 excluded although most arms run --> FIXED: both in ALSO (passing on Windows)
- [NIT] machine.linux early return reported a pass --> FIXED: t.skip

#### Iteration 2
- [WARNING] plan counts stale --> FIXED
- [WARNING] devicedoor premise could flake at 400 ms with node --> FIXED (2 s)
- [NIT] delete-leftover skip could name its Windows counterpart --> FIXED

#### Iteration 3
- [WARNING] enrolsign helperPath arm had a false reason --> FIXED
- [WARNING] guardstate checked production against itself on macOS --> FIXED: own formula off win32
- [WARNING] devicedoor's skipped arm need not use node --> FIXED: shell stand-in, marker kept
- [WARNING] loginexpiry-sandbox entry overclaimed --> FIXED

#### Iteration 4
- [WARNING] loginexpiry-sandbox absence-only arms passed on Windows because nothing read --> FIXED: skip with their Keychain control
- [WARNING] two ALSO comments false --> FIXED
- [NIT] offthread's 3 s bound for a node child --> FIXED (30 s, not a speed test)

#### Iteration 5
- [WARNING] musestatus garbled-note half vacuous on Windows --> FIXED: Muse's file written on every platform
- [WARNING] symlink arms unguarded in six files --> FIXED (12 arms)
- [NIT] handoversign reason names the stand-in where helperPath is the blocker --> not applied (the skip is right either way)

#### Iteration 6
- [BLOCKER] x6 symlinks unguarded in create.switch-claude (at load), instructionreread, instructions, enrolsign, installroot, guide-deny --> FIXED by a sweep of every ALSO file: 20 more arms skip; switch-claude's shared history is a junction
- [WARNING] chmod 0o000 arms pass on Windows by another rule (handoff, instructionadds, enrolsign, instructions x2) --> FIXED: skip, owed on kosmos#9269
- [WARNING] a third mkfifo arm in instructions --> FIXED

#### Iteration 7
- [WARNING] muserun's turnArgs arm skipped only for its fixture link --> FIXED: junction, runs on Windows
- [NIT] musestatus comment --> FIXED
- [NIT] installroot links could be junctions --> not applied (a coverage gap, not a wrong test)
- [NIT] devicedoor premise fails rather than skips under extreme load --> not applied (deliberate: a vacuous pass is worse)

#### Iteration 8
- [WARNING] filenotices-scale comment said "only the FIFO arm" --> FIXED (comment only, after the round)
- [NIT] four comments omitted skips --> FIXED (same commit)
- [NIT] instructionadds sets HOME without USERPROFILE --> not applied (traced: no read of the real home)
- [STRENGTH] the mechanical grep of every ALSO file finds every symlink, chmod 0o000, mkfifo and negative-pid kill guarded or a junction
- [STRENGTH] every subject-exists skip names kosmos#9269; no production file in the diff
