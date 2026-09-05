---
pre_challenge: true
method: challenge-loop
branch: source-channel-2066
diff_hash: 8a15bd170a54f5e3776474063d4a9152818ac7ad36c01f8b664be793e863fa51
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T02:29:28Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero new BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 2 actionable (0 BLOCKERs, 1 WARNING, 1 CONVENTION) + 4 NITs
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
- [WARNING] install/setup.sh:3456 - the data-root else-branch used bare `$HOME`, but the read side (engine/store.js `root()`, store.js:158, the `dataRootFor` caller) resolves `AGENT_WORKFORCE_HOME || os.homedir()`. A board with `AGENT_WORKFORCE_HOME` set and `AGENT_WORKFORCE_DATA` unset would read a different root than the install wrote, so the STAGING badge would silently never light. --> FIXED (commit 3accc320): `_wf_data_root="${AGENT_WORKFORCE_HOME:-$HOME}/Library/Application Support/AgentWorkforce"`, an exact mirror; added a red-capable seam test arm + a grep guard.
- [CONVENTION] .claude/plans/source-channel-2066.md:1,30,43,48 - four em dashes in the plan file, violating the no-em-dash rule (shipped shell code was already clean). --> FIXED (commit 3accc320): replaced with hyphens.
- [NIT] tools/test-staging-wire-2036.sh - the `grep -qF` guards are brittle to reformatting the write across lines (fails safe: red, never false green). Recorded.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings. Five STRENGTHs confirmed the iteration-1 fix and the design:
the shell data-root now mirrors `dataRootFor`/`root()` exactly including the `:-` empty-string semantics
matching JS `||`; the write is errexit-safe and non-install-critical; the single-funnel claim is correct
(update.js `beginInstall` spawns setup.sh via `curl|sh` with the channel, no in-process install path);
`_PTR_FILE` is in scope and always set at the write site; the test asserts real postconditions and the
grep guards are red-capable on the load-bearing lines.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh:3456 | else-branch data root ignored AGENT_WORKFORCE_HOME (diverges from read side) | FIXED | 3accc320 |
| 2 | 1 | CONVENTION | .claude/plans/source-channel-2066.md:1,30,43,48 | four em dashes in the plan | FIXED | 3accc320 |

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-staging-wire-2036.sh - grep guards brittle to reformatting the write line; fails safe (iteration 1)
- [NIT] tools/test-staging-wire-2036.sh:135 - the extracted `source_channel_write` simplifies the real block's `if mkdir; then … || fallback; fi` to `mkdir && printf`, so the errexit-resilience property (a removed `|| printf`/`if mkdir` guard) is not behaviorally tested; low risk, the real block is short and read-verifiable (iteration 2)
- [NIT] install/setup.sh:3464 - the write is not atomic (plain `printf > file`, not tmp+rename); ~8-byte single write syscall and the read side folds unexpected content to prod, so a torn concurrent read degrades safely (iteration 2)
- [NIT] install/setup.sh:3458 - a trailing slash in AGENT_WORKFORCE_DATA/HOME yields an interior `//` where the read side's `path.join` collapses it; POSIX resolves `//` identically, so functionally equivalent (iteration 2)

### Strengths (across all iterations)
- The single-funnel decision is verified against source, not asserted (update.js spawns setup.sh via curl|sh; no in-process install path) (iterations 1 and 2)
- Errexit-safe under `set -euo pipefail`; a failed write never aborts the install; failure direction is safe (missing file folds to prod on both sides, so a prod board can never falsely paint a STAGING badge) (iterations 1 and 2)
- After the iteration-1 fix, the shell data-root mirrors `dataRootFor`/`root()` exactly, including `:-` empty-string semantics matching JS `||` (iteration 2)
- Red-capable test: real postconditions plus exact-line grep guards on the load-bearing lines, and a server.js filename cross-check tying the write to the read (iterations 1 and 2)
