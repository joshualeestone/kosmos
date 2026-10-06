---
pre_challenge: true
method: challenge-loop
branch: tmphome-5325
diff_hash: b118000b94cbe7e743ece09adb4881f4767c8887b164912b714f14074355e1fd
validation: passed
subdir_audit: passed
timestamp: 2026-10-06T14:52:31Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Fixed:** 2 | **Deferred:** 1 (to #5334) | **Asked (awaiting user):** 0

Validation on the exact head 0544e54f4, after the 0.7.25 cut: tools/run-tests.sh on Mortals (status clean), 15592
tests, 15368 pass, 0 fail, 0 cancelled, EXIT 0 at 09:50 CDT. The changed browser check render-update-toast.js run on
this head: TOAST DRIVE OK, and a fresh TMPDIR is empty after it. CONTROL: main's version of the same check, run the same
way, left six folders, 215 MB (the card's defect), so the empty result is the fix and not a silent run.
Merged onto newer main under Splinter's 19:29 ruling: merge-tree clean; the one shared file, engine/projects.test.js,
has main's #5334 tmpscope line at the top and this change's test.after at the end (with tmpscope the after hook is now
redundant for that file, and harmless).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet (blind)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] render-update-toast.js removed its data root while its board could still be writing --> FIXED (0544e54f4): waits up to 5 s for the board to stop
- [NIT] Ctrl-C or SIGTERM skipped the cleanup --> FIXED (0544e54f4): both exit through the same handler
- [NIT] projects.test.js also makes clipath, cli path, cli$evil, aw-real and aw-link folders beside its sandbox --> DEFERRED to #5334 (since landed on main as tmpscope)

Author's own check at merge time (not a review iteration): main's #5334 tmpscope and this change's test.after in
engine/projects.test.js do not fight; both remove only this process's folders.

### Weakest premise
That test.after runs on a failing run too. node:test runs after hooks whether tests pass or fail; SIGKILL still leaks.
