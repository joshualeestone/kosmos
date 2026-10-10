---
pre_challenge: true
method: challenge-loop
branch: shots-marketing-5782
diff_hash: d74d4d0ad85f5d3af3b54665abff213976407ca6eea989768d490c298d9fe887
validation: Scoped, stated plainly. Only docs/browser-checks/mobile-shots.js (a dev tool) and plan files change. The six test files that read mobile-shots.js pass 85/85. The tool itself ran on the box three times: 8 marketing shots (0 overflow, 0 errors, leak guard clean), and a verification run on the final head (marketing org-chart and project-room at desktop2x come out 2560x1600 with no --scale flag; the store set's project-room has no hover bar, the one behaviour change to existing sets). The full node and shell suites were NOT run locally; the merge is gated on GitHub CI.
subdir_audit: passed
timestamp: 2026-10-10T22:06:34Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one blind review; then fixes and a verification shoot)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 6 NITs
**Fixed:** both WARNINGs and 4 NITs; 2 NITs left with reasons. | **Asked (awaiting user):** 0

The change (#5782, installkosmos.com product shots): a `--data marketing` set (the store fleet with a team shape, a made-up person, tasks spread across agents with their own reports), `--faces DIR` (pictures through the engine's own writers), a `desktop2x` size, and project-room parking the pointer.

### Per-Iteration Breakdown

#### Iteration 1 (blind review)
- [WARNING] desktop2x saved 1280x800 unless --scale device was also passed --> FIXED: the size carries scale 'device'.
- [WARNING] agents' reports go stale after 30 minutes, so a long sweep would show "last reported N minutes ago" --> FIXED: re-stamped before a screen that shows tasks.
- [NIT] r.ok checks after writers that throw --> FIXED: a failing face names its file.
- [NIT] --faces accepted a file; a folder matching nobody seeded nothing silently --> FIXED: must be a folder; says when nothing matched.
- [NIT] only jpg/png --> FIXED: webp and gif too.
- [NIT] header did not explain the set or the folder --> FIXED, with a warning that the folder must never hold a real person's photo (the leak guard reads text only).
- [NIT] seeding skips the Settings routes' instruction-file updates --> LEFT: nothing on screen shows them; the shots are of screens.
- [NIT] a real photo in --faces would go unchecked --> LEFT as a stated rule in the header: the guard cannot read faces.
- Reviewer confirmed: sample and store sets unchanged but for the pointer park; all seeding in the sandboxed data root; keys match how the board keys agents.

#### Iteration 2 (re-check)
- Verification shoot on the fixed head: 3 shots, 0 errors; 2560x1600 without the flag; no hover bar on the store project page.
