---
pre_challenge: true
method: challenge-loop
branch: switcher-4648
diff_hash: d62c5501dfae796596a0aca6413bd29fafb8a19053ad7274cc10589371c039fc
validation: passed (full tools/run-tests.sh through validation_log_run_or_skip, run on MORTALS via ~/.cache/claude-handoffs/mortals-validate.sh at dc27240a7, ended 2026-09-29 21:36 CDT: EXIT=0, node 12321 tests, 0 failed, 0 cancelled, shell part green; recorded entry hash d62c5501 equals this worktree's. Its suite may have overlapped Splinter's #4609 jam-unstick run of pgroup-4669 on the same box; an overlap causes false reds, not false greens)
subdir_audit: passed
timestamp: 2026-09-30T02:37:37Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (fable, sonnet, fable, then a fourth blind round)
**Converged:** Yes, at iteration 4: zero NEW BLOCKERs or WARNINGs.
**Total findings:** 2 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 6 NITs, all fixed or written down (details per round in .claude/plans/switcher-4648.md).
**Deferred:** a short cache for fidgety menu opens (each open is one signed call plus N probes).

- Round 1 (fable): the browser check was not gated (BLOCKER, enrolled); any DNS name passed validation (now one label under the coordinator's domain, enforced before any probe); offline rows linked to an error page; a reopened menu showed stale state; two tests weaker than they read.
- Round 2 (sonnet): tools/test-connector-verbs.sh pins the macRequest callers and account-computers.js is a new one (BLOCKER, re-decided in writing, list now six, 22/22); the render-side hide was unguarded.
- Round 3 (fable): the browser check's not-signed-in control read the DOM before the stub was served (WARNING, now waits for the served counter; red-checked 4 FAILED with that mutation).
- Round 4: converged. After it, the only change is the test leak fix (fake.cleanup()), which is inside the validated head dc27240a7.

The relay half (#212) is merged and deployed (coordinator 212acd0, and now d0b75bd). The connector rebuild that makes this list appear on a Mac is a separate step (release step 1d refuses a stale connector).
