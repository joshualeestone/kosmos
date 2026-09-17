---
pre_challenge: true
method: challenge-loop
branch: reach-mark-badge
diff_hash: a8117517ecf5715a7e491903d87ede839b225978eeabd6cdb705394e474323ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-17T12:55:43Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 fresh blind passes (Sonnet / Opus / Sonnet)
**Converged:** Yes (iteration 3 found no new actionable BLOCKER/WARNING/CONVENTION on the code; its WARNING dedups against the documented weakest premise, its only actionable item was a plan-doc NIT, now fixed)
**Reviewer models:** sonnet, opus, sonnet (multi-model witness per 6a)
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Fixed:** the a11y WARNING + the check-coverage WARNING + 2 NITs | **Deferred:** the !present-proxy WARNING (documented design choice, flagged to Josh) | **Declined:** 1 NIT (dark arm, low value) | **Asked:** 0

Josh 6.72 (#3212): when a message cannot reach an agent, mark that agent's avatar with a
question mark instead of any visible status text. Implemented as a neutral grey LROW_REACH badge
on a  member's .pj-face, mutually exclusive with the needs-you triangle; the room's
"cannot see this agent" caption becomes visually-hidden (.vh) rather than printed.

### Per-Iteration Breakdown

#### Iteration 1 (blind, sonnet)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] a11y: the badge's aria-label sits inside the aria-hidden .pj-face (not exposed), and
  dropping the room caption left a screen-reader user with ZERO unreachable signal --> FIXED
  (85f6c68b0): the room caption is now VISUALLY HIDDEN (.vh) not dropped -- sighted see only the
  badge, screen readers still read the sentence. Check updated to assert caption is .vh + present.
- [NIT] badge is a fixed 15px (larger fraction on the 28px consolidated avatar) --> DECLINED:
  smaller than LROW_WARN at that size (18x16 centred), consistent with that precedent, not a regression.

#### Iteration 2 (blind, opus)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs. Verified the SHIPPED CODE sound
(mutual exclusion across all four states incl restarting, CSS specificity, tokens in all themes,
call-site coverage, contrast, isolation stubs, negative control).
- [WARNING] the check's Settings arm asserted the reason TEXT present but not that it is VISIBLE;
  a gate flipped to always-.vh (hiding Settings too) would pass --> FIXED (92d153509): added a
  symmetric chk(captionVh === false) on the Settings caption.
- [NIT] capOf/capVh read the first <small>, but a member with a role emits <small class="pj-member-role">
  first --> FIXED (92d153509): scoped to small:not(.pj-member-role) + gave the room fixture a role
  so the scoping is exercised.
- [NIT] no dark-mode arm --> DECLINED: the badge's visibility is theme-independent display logic and
  its colours are tokens that adapt; a dark arm re-tests identical display (low value per review).

#### Iteration 3 (blind, sonnet) -- CONVERGED
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT. Extensive verification: mutual
exclusion by construction, CSS specificity, ran the check (10/10) + a forced-render negative control
(2 fail) + origin/main negative control (3 fail), server.test.js 301/301, web.layout-picker 13/13, a
light+dark headless screenshot (clean badge both themes), and confirmed the aria-hidden/.vh a11y path.
- [WARNING] the !present signal is not identical to an actual per-post delivery failure
  (TOLD.COULD_NOT / DELIVERY.COULD_NOT); a present member with a transient post failure shows no badge
  --> DEFERRED: this IS the plan's documented weakest premise (dedup), flagged to Josh. !present is the
  live, glanceable proxy that covers the dominant "cannot reach" case; per-post failure semantics are a
  redirect if Josh wants them. The reviewer confirmed it is plausible/correlated, not a hidden gap.
- [NIT] the plan's shorthand implied the caption is dropped in the room; the code keeps it .vh -->
  FIXED (535622d1d): plan pseudo-code corrected to match the code + comment.

### Validation
Full `bash tools/run-tests.sh`: 7645 pass, 0 fail; surface + coarse browser-check gates RC=0. The
new hermetic check render-reach-mark-3212.js is wired into the runner (#1387) with a README row.
An EARLIER validation run (before the fixes below) correctly caught 4 real consequences of the
LROW_REACH addition -- the check booting a server with tmux=/bin/echo (#1575; made hermetic), the
LROW_REACH ReferenceError in the two server.test.js pjMember isolation preludes (stubs added), and
web.layout-picker.test.js pinning the exact .lav .lring/.lwarn hide rule (regex updated for .lreach)
-- all fixed before this converged run.
