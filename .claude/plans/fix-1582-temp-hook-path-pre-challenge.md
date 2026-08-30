---
pre_challenge: true
method: challenge-loop
branch: fix-1582-temp-hook-path
diff_hash: b85869c8f4032f75fe1cd83fcf983065b681e80dc148f59d5bda83b365e6df7d
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T23:22:39Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2's only actionable finding deduplicated to a deferred entry)
**Total findings:** 6 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs, 1 dup)
**Fixed:** 3 | **Deferred:** 2 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 NIT
- [WARNING] engine/reporthook.test.js:144 — the macOS-trap test only discriminated the fix from a raw-only comparison on macOS; on Linux CI os.tmpdir()==realpath so a raw-only bug would also pass --> FIXED (the test now exercises BOTH the raw os.tmpdir() and resolved forms, guarding both branches)
- [WARNING] engine/reporthook.js:124 — a null/undefined settingsPath now threw (my prefix check called .startsWith on it), violating the module's never-throw fail-soft doctrine --> FIXED (underRoot is type-safe; settingsDurable guards a non-string settingsPath; new fail-soft test)
- [WARNING] engine/reporthook.js:119 — under-fire coupling: the guard keys on the setup process's os.tmpdir(), so a cut that rooted its sandbox outside that root would re-poison silently --> DEFERRED (verified the real cut scripts create sandboxes under $TMPDIR via `mktemp -d` at test-install.sh:56 and `${TMPDIR:-/tmp}/...` at release.sh:350, and the Node process shares that $TMPDIR, so os.tmpdir() names the same root; documented the coupling in-comment; the operator-level post-cut check is noted in the PR body as belt-and-suspenders)
- [NIT] engine/reporthook.js:122 — raw prefix compare assumes normalized absolute paths, so a relative or `..`-containing path could slip --> DEFERRED (not reachable: the real caller hookScriptPath() uses path.resolve; underRoot is now additionally type-safe)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT
**Duplicates of prior findings:** 1 (the TMPDIR-coupling WARNING re-raised iteration 1's deferred #3; deferral reasoning still applies, plus a runbook post-cut-verification suggestion now noted in the PR body)
- [NIT] engine/reporthook.test.js:168 — the "#1582 control" test was named "into a durable settings file" but passed an ephemeral fresh() path; the assertion was valid but the name overclaimed --> FIXED (renamed to "a non-temp (installed) script is never refused as temp-rooted" with a comment explaining what it proves)
**Converged** — no new actionable BLOCKER/WARNING/CONVENTION findings after deduplication.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | reporthook.test.js:144 | trap test only discriminates on macOS | FIXED | iter1 commit |
| 2 | 1 | WARNING | reporthook.js:124 | null settingsPath throws (fail-soft regression) | FIXED | iter1 commit |
| 3 | 1 | WARNING | reporthook.js:119 | under-fire if sandbox rooted outside os.tmpdir() | DEFERRED | verified cut scripts use $TMPDIR; documented + PR-body operator check |
| 4 | 1 | NIT | reporthook.js:122 | relative/.. paths slip the prefix compare | DEFERRED | not reachable (caller uses path.resolve); underRoot now type-safe |
| 5 | 2 | WARNING | reporthook.js:134 | TMPDIR-coupling (dup of #3) | DEFERRED | duplicate of #3 |
| 6 | 2 | NIT | reporthook.test.js:168 | control test name overclaimed | FIXED | iter2 commit |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking)
- [NIT] reporthook.js:122 — relative/.. path normalization (iteration 1, deferred: not reachable in production)

### Strengths
- Boundary-correct temp-root matching (`p === root || p.startsWith(root + path.sep)` avoids the /tmp-foo false positive); verified by both challenge agents. (iterations 1, 2)
- The macOS trap (os.tmpdir() /var/folders vs realpath /private/var/folders) is handled by comparing against both forms, with a realpathSync try/catch fallback. (iterations 1, 2)
- The refinement (refuse only ephemeral-script-into-durable-settings) faithfully implements the card's rationale, returns early before any filesystem access (no side effects), and preserves the existing all-ephemeral test fixtures. (iterations 1, 2)
- Pure early return positioned after the truthiness and shell-special-char refusals: zero regression risk to the four prior refusals or the wiring flow. (iteration 2)

### Note on validation
The final full-suite run initially showed one red (`server.test.js:5575` "first-run routes", `read ECONNRESET`) that is unrelated to this diff (which touches only engine/reporthook.js). It passed green in isolation and the harness itself flagged machine contention (live board on :16180, load 3.87) per the repo's #708 guidance. A clean re-run passed (fail 0), which is the validation recorded above.
