---
pre_challenge: true
method: challenge-loop
branch: projmute-7210
diff_hash: ca2a3dec5ed67df7c1b47317a2929cc83ff360149076c4ab4788a0ace25cf3b0
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T20:27:09Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (three on the build, then one on the design-review commit; the design review itself ran twice)
**Converged:** Yes (iteration 3, sonnet: no BLOCKER or WARNING; iteration 4, opus, reviewed the design-review delta and its two WARNINGs were fixed)
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 13 NITs
**Fixed:** every WARNING and the NITs that changed behaviour | **Deferred:** 0 | **Accepted with a reason:** the rest (in the plan)
**Validation:** full validation PASSED on this head 7b3c178ce4 (hash ca2a3dec5ed6), rebased on main at 13:42: node suite 24319 tests (0 fail), test:shell 4 shards all green, type-check, lint, build. Validation 1 before it (Mortals, ddd4ab5b58) found three wiring gaps, all fixed: the new check was in no runner list (gated.txt), had no SITE_COUNTS line, and the surface gate wanted seven checks run.
**Browser-check gates:** render-projmute-7210 (new, wired) 24/24, render-bubblepop-2407 (level arm) 18/18, and the seven surface-mapped checks (render-room-msgbox-2806, render-unread-edge-3743, render-consolidated-nav-4345, render-head-row, render-signin-visible-3892, render-docs-seg-4937, render-agentdm-3414) all PASS through tools/browser-checks.sh on 7015ad96ea; trailers in 58f536381a.
**Design review:** approved by Mona Lisa (m428, m430); shots in ~/work/design-shots/kosmos-7210/. The muted-room shot's room area is empty because of kosmos#7233 (sample rooms empty since #7185, fixed on shotseed-7233), not this change.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet. **New findings:** 0 BLOCKERs, 0 WARNINGs, 4 NITs. **Self-generated:** 0
- [NIT] a save answered after a later choice was dropped, so a later refusal reverted to an older level --> FIXED 02fb778b73 (test, mutation red)
- [NIT] needs_you attributed to the carried project --> accepted (plan). [NIT] tokenless local Origin passes isViaScreen --> pre-existing. [NIT] copy --> fine.

#### Iteration 2
**Reviewer model:** opus. **New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs. **Self-generated:** 1 (my iteration-1 cache rule)
- [WARNING] going back to the held level while a save was in flight left the board on another level --> FIXED 636e62bcf4 (sent while a save is in flight; test)
- [WARNING] the Dock and Projects badge still counted a muted project (the plan's premise that the badge counts no messages was false, retracted there) --> FIXED (projectsUnreadTotal and pjDmTotal leave quiet projects out; tests on both sides)
- [WARNING] nothing tested the server's wiring of the project id into the push --> FIXED (needs_you through /api/report and ready through the built route, muted and All arms; mutations red)
- [NIT] two doc comments above the wrong code --> FIXED. [NIT] the sound switch read On while quiet --> a note under it, then (design review) dimmed.

#### Iteration 3
**Reviewer model:** sonnet. **New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs. **Self-generated:** 0 --> CONVERGED
- [NIT] in-flight counter would stick only if a page element were missing --> accepted. [NIT] another device's change can under-report the nav badge until the next poll --> accepted, self-heals. [NIT] tally and nav badge use different feeds --> pre-existing.

#### Iteration 4 (the design-review commit)
**Reviewer model:** opus. **New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs. **Self-generated:** 2 (the design-review commit)
- [WARNING] the bell-only title label was about 24 px wide on a phone --> FIXED 29f317888a (36 px min-width; a 40x36 tap with its ring)
- [WARNING] the sound switch's handler relied only on the browser skipping a disabled button's click --> FIXED (it refuses itself; test)
- [NIT] a disabled switch's description is not reached by Tab --> accepted (the note is visible above it). [NIT] hover tint on the quiet label --> kept for mouse users.

### Mutations (each went red, restored green)
route person-only guard, mute gate, mentions gate, gate removed, needs_you wiring, ready wiring, badge exclusion, sequence guard, refusal revert, in-flight send, kept stale success, disabled-switch handler guard.
