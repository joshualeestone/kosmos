---
pre_challenge: true
method: challenge-loop
branch: leakscan-9117
diff_hash: 0a997370571d141ed63c374e80f46aeeea3e255fc235d63af1723e11bb393275
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T09:45:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review round (a fresh agent, given the diff and the card, not my reasoning).
**Converged:** Yes. The round found no BLOCKER, no SHOULD and no NIT. Its experiments ran under /bin/bash 3.2 and macOS awk 20200816.
**Change:** tools/lib/test-leak-guard.sh gains `leak_root_lines`, a single awk pass that keeps only the ps-snapshot lines containing the root in either spelling. It uses `index()`, with the paths passed through ENVIRON. All 3 per-line loops in leak_process_check and leak_process_stop_root read only those lines, and leak_names_root still judges each one. Details: .claude/plans/leakscan-9117.md.

## Validation
- Full validation on this Mac (validation_log_run_or_skip), head 37e687d8f8: node suite 0 fail; test:shell 4 shards all green; "validation PASSED for stack=typescript hash=0a997370571d", status clean.
- tools/test-test-leak-guard-4273.sh: 82 checks pass, 5 of them new. Perturbations turn them red: no filter turns 2 new checks red, and one loop back on the whole snapshot turns the wiring check red.
- Measured at load 10.5 with 1,127 processes: `ps -A` 0.05 s, the old per-line loop 0.91 to 1.32 s, the new filter 0.04 s. The card's 11 s at load 17 was not reproduced.
- Subdir audit: the branch changes no subdirectory CLAUDE.md.

### Per-Iteration Breakdown
#### Iteration 1 (fresh agent)
- Superset: every pattern in leak_names_root contains $root or $real literally, so every line the old loops could match passes the prefilter. A trailing "/" is stripped by both callers first; spaces, dots and backslashes are literal (checked).
- awk: index() with an empty value would return 1, but root is guarded non-empty and real is pwd -P output or root. Were it ever empty, every line would pass, so nothing would be lost. Invalid UTF-8, multibyte text and a 200,000-character line passed through intact.
- bash 3.2: `done < <(...)` keeps the loop in the current shell, so found, cands, stopped and n stay visible. set -e and set -u behave as before. In the exit trap the substitution is made after the snapshot, so it is never in `mine` and cannot be signalled.
- The pass-2 and KILL loops use a fresh snapshot, the same filter and the same judge: correct.
- Tests: a missing, regex or -v version fails them. Keeping kt429 is right, and its CONTROL shows leak_names_root refuses it. The structural grep fails loudly on a cosmetic rewrite, which is tolerable. The existing end-to-end checks already run the new path on real processes.
- No findings to fix.
