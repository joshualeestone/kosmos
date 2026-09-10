# 9e-setup-2360 - 9e served-audit compares served /setup vs the deploy source, not the local tree

kosmos#2360, found during the 0.6.40 cut.

## Problem
The 9e outside-audit (`tools/kosmos-artifact-check.sh`, "The served installer matches the repo")
compared the SERVED /setup against the LOCAL working-tree `chaoskosmos-site/setup`. But the deploy
ships from origin/main via the #2286 fresh-origin-main mechanism, so a shared checkout that lagged
origin by a /setup commit made 9e FALSE-RED "served /setup DIFFERS" -> release-exit=1, though the
served bytes were correct. Measured on 0.6.40: served `cdbce978` == origin/main:setup, local working
tree `312cd7ed` (1 behind) -> false exit=1 that an operator had to rule benign by hand.

## Change
Derive the reference /setup sha from `git show origin/main:setup` (the deploy source), via a temp file
(not a `$(...)` capture, which strips the trailing newline and changes the sha), guarded on git's own
exit and a non-empty (`[ -s ]`) result. Detect the site checkout with `git rev-parse --git-dir`
(robust to a linked worktree / `.git`-file). Fall back to the local working tree only if
origin/main:setup is unreadable, and then always as UNPROVEN (never a pass, never a hard FAIL): a local
match does not confirm the deploy source (the local tree can be stale), and since UNPROVEN also exits
the check non-zero, the degraded path fails closed rather than green-lighting an unconfirmed artifact.

## Known residual (named, deferred)
Not window-free: if origin/main advances between the deploy and the audit with a NEW /setup commit,
the served (correct) bytes differ from the now-newer origin/main:setup and 9e FAILs. That window is
the deploy->9e gap inside one cut (seconds, under the merge-freeze) vs the always-open local-lag
window. The window-free fix is to compare against the exact deployed sha (#2286's SITE_SHA); it is a
larger change (threading SITE_SHA from release.sh) deferred to a follow-up.

## Tests
`tools/test-artifact-setup-source-2360.sh` (wired into test:shell): STATIC (the check reads
origin/main, the hard-FAIL names origin/main, the `[ -s ]` empty-guard is present) + BEHAVIOURAL (a
real repo where origin/main:setup=A and local=B - the exact #2360 condition - the derivation reads A,
with a control proving it discriminates from a stale local B, and a guard proving a missing path ->
empty -> fallback). Static asserts are red-capable against origin/main's pre-fix version.

## Out of tree
`kosmos-artifact-check.sh` is vendored byte-for-byte to `~/.claude/bin/`; the fix is copied back there
as a per-machine action the PR cannot perform (called out in the PR).
