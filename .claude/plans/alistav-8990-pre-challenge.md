---
pre_challenge: true
method: challenge-loop
branch: alistav-8990
diff_hash: a648f422f090949af91267bcda9eda121e53291521cbdf91fb096b15eba1340d
validation: failed (2 machine-only failures, both red on main on this Mac: #7820 pwsh crashes on `1+1`, #185 the %99 pane test; 30,344 passed, 612 skipped)
subdir_audit: passed
timestamp: 2026-11-25T00:57:06Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (8 blind rounds plus the final whole-branch read with no plan file and nothing marked settled)
**Converged:** No. Stopped under the standing usage rule (Splinter, 10-22 and 10-26: past 8 rounds with no BLOCKER
open, WARNINGs go to a follow-up card). No BLOCKER was open after round 8 or after the final read. The open
WARNINGs were filed as kosmos#9004.
**Fixed:** every BLOCKER and every WARNING except those filed to #9004 or deferred below.
**Deferred:** 4 (below). **Asked:** 0.

**Validation.** Full suite on 14cd305266 at 18:55 CST: 30,958 tests, 30,344 passed, 2 failed, 612 skipped. Both
failures belong to this Mac, not to this branch:
- `#7820 the PowerShell scripts parse`: /opt/homebrew/bin/pwsh crashes on a bare `pwsh -NoProfile -Command 1+1`
  (System.IO.FileLoadException, SIGABRT) with no repo involved. The same test passed in this branch's 16:30 run.
- `#185: the room store refuses an agent-authored row with no command provenance`: this Mac's tmux now has a real
  pane %99; it fails on main here too (Angel, Fleet Builders m6401).
The 16:30 run on the same head passed every test (30,970; 0 failed) and recorded failed only because a screenshot
folder my own tooling left in the worktree made it dirty.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [BLOCKER] docs/browser-checks/render-teamcreate-4557.js:681 - waited for an idle poll to rebuild cards --> FIXED (measured red, then forced rebuild; a mutant proves the arm bites)
- [WARNING] docs/browser-checks/render-star-6719.js:181 - list-repaint arms could pass without keepStarFocus --> FIXED
- [WARNING] web/index.html tcGoToTeam - tabindex no longer wiped by a poll --> FIXED
- [CONVENTION] tools/browser-checks.sh - new check belongs in gated.txt --> FIXED
- Found by running, same class: render-federation-invite-4649, render-ownseal-4658 --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [WARNING] web/index.html setGridHtml - a failed avatar was never retried --> FIXED (later reworked, iter 3 and 5)
- [WARNING] web/index.html - in-place writers inside #grid/#alist --> DEFERRED: the plan's named weakest premise; swept, none found; later pinned by web.board-memo-8990.test.js
- [NIT] web/index.html #2698 comment - led to a real defect: grid/list avatar URLs unversioned, a new picture stayed old --> FIXED (?v=)
- [CONVENTION] stray untracked http:/ folder --> FIXED

#### Iteration 3
**Reviewer model:** fable
**New findings:** 1 BLOCKER, 4 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 2
- [BLOCKER] render-avatar-steady-8990.js - fixture picture undecodable --> FIXED (real PNGs, decode asserted)
- [WARNING] web/index.html retry - cleared the container memo; one broken picture rebuilt everything --> FIXED (per-element retry)
- [WARNING] arm 4 counted requests from any surface --> FIXED
- [WARNING] no source guard on writers --> FIXED (web.board-memo-8990.test.js)
- [WARNING] forced rebuilds stand in for a real poll --> DEFERRED, then filed to #9004
- [CONVENTION] plan stale; four "rebuilt every poll" comments --> FIXED

#### Iteration 4
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 3 NITs
**Self-generated:** 2
- [BLOCKER] web.avatarver-2762.test.js - pinned /avatar count 25 became 26 --> FIXED (measured, pin bumped with reason)
- [WARNING] arm 4 beta-fetch could not discriminate --> FIXED (node identity)
- [WARNING] arm 4 did not prove backoff or cap --> FIXED
- [WARNING] retry gave up after 75 s --> FIXED in iteration 5
- [WARNING] pin docstring overclaimed --> FIXED

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 2
- [WARNING] #8790 listener's second error double-counted --> FIXED (once per URL)
- [WARNING] give-up after 75 s regresses self-healing --> FIXED (backoff to 60 s, no cap)

#### Iteration 6
**Reviewer model:** fable
**New findings:** 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 3
- [WARNING] a picture that loaded after a failure was still swapped --> FIXED (load cancels)
- [WARNING] arm 4 passable on the rail alone --> FIXED (per-element readback)
- [WARNING] arm 3 passable by an unrelated rebuild --> FIXED (new v= required)
- [CONVENTION] README rows --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] service worker hid arm 4's forced 500 --> FIXED (serviceWorkers: 'block')
- [WARNING] side-chat busy key lacked avatarVer --> FIXED

#### Iteration 8
**Reviewer model:** sonnet (whole branch, but its prompt included the plan file)
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] a card that changes still rewrites its container and refetches every avatar --> FILED kosmos#9004
- [WARNING] arm 4 window tight --> FIXED (28 s)
- [WARNING] pulse check no longer drives a real poll --> FILED kosmos#9004

#### Iteration 9 (final whole-branch read, no plan file, nothing settled)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] same container-rewrite scope as iteration 8; the check and README overclaimed --> FIXED (scope stated plainly), cause filed #9004
- [WARNING] surface line missed the retry's tokens --> FIXED
- [NIT] three stale comments --> FIXED

### Measured (not reasoned)
- Idle project room on base: 32 avatar rebuilds and 16 fetches in 40 s; on the branch: 0 and 0.
- render-avatar-steady-8990 on main 87918b0c75: 7 of 17 fail. On the branch: 17 of 17 pass.
- Mutants on the branch's code: no retry (2 fail), unversioned list rows (5 fail), retry rebuilds container (3 fail),
  no backoff (2 fail).
- 13 related browser checks pass on the branch; render-projects, render-consolidated-layouts, render-thread and
  mobile-shots pass through the harness (frozen at a69c00698d).

### Deferred
- In-place writers inside #grid/#alist beyond those found: the plan's weakest premise; pinned by spelling.
- fedOwnRefocus's tabindex -1 on .fmsg/.fedout-h persists: not in the tab order.
- A card focused when the just-made mark ends keeps tabindex -1 until its markup changes.
- No browser check opens My Agents, though it gets the retry.

### NITs (non-blocking, across all iterations)
- [NIT] teamcreate's wait after a synchronous repaint is only a guard (iteration 7; commented)
- [NIT] #8790 re-set reusing the same URL is relied on without a pin (iteration 8)

### Strengths (across all iterations)
- The memos compare against the string last written, never reserialized innerHTML, the same rule MY_AGENTS_HTML uses.
- Every writer behind a memo clears it; the writers are pinned by a source test.
- Edited checks assert the rebuild really happened instead of passing on a skipped write.
