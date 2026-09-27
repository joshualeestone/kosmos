---
pre_challenge: true
method: challenge-loop
branch: tiles-4053
diff_hash: 18c8a2541829f8cc01f4bec4dda971bd1d0c877749a6cbf892a159efd4567d55
subdir_audit: passed
timestamp: 2026-09-27T08:17:28Z
converged: true
---

## Challenge loop: #4053 the Tasks tiles, option C v2 (Josh approved)

#### Iteration 1 (blind, opus)
- [HIGH] the new "cannot tell" arm compared the red tile to In progress while a real click left the pointer hovering it (flaky) --> FIXED: compared to a var(--k-surface) probe.
- [MEDIUM] the red fill (0,4,0) outranked the shared :hover and [aria-pressed] rules, so the red tile showed no hover and no selected state --> FIXED: its own hover and selected rules (deeper red, red edge); browser arm, red without the rule.
- [LOW] the badge tint mixed into the surface, not the tile's current fill --> FIXED: mixed into transparent.

#### Iteration 2 (blind, sonnet)
- [MEDIUM] "one shared height" held only per grid row: at five across, Completed alone on row 2 was shorter --> FIXED: #tsk-tiles grid-auto-rows: 1fr; five-across arm (control: heights [113,108] without it).
- [LOW] the geometry reads ran with the pointer on a tile --> FIXED: mouse moved away first.
- [LOW] no unit pin for the new markup --> FIXED: web.tasks-look-3559 pins the badge row in both painter branches.

#### Iteration 3 (blind, opus)
- [LOW] the icon pin matched an unrelated "working:" entry --> FIXED: scoped to TSK_ICON (control: red with the icon removed).
- [LOW] the aria-hidden pin matched other markup --> FIXED: scoped to tskBadge (control: red without it).
- [LOW] the "tinted" arm could not fail --> FIXED: exact colour-mix probe, and not transparent.

#### Iteration 4 (blind, sonnet)
No issues found. NO NEW FINDINGS.

## Evidence
- render-tasks-view-3559: All checks passed, on the final commit and again after the rebase onto main.
- Control on main's page: the four #4053 arms FAIL by name (zero, unknown, badge geometry, red fill).
- web.*.test.js after the rebase: 1970/1970. Full suite on the final files: 10600 pass, 0 fail, exit 0. #1720 and #2518 gates pass.
- Rendered with the approved mock's fixture, light and dark: matches the v2 mock.
