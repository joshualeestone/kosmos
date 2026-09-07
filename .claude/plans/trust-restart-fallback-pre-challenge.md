---
pre_challenge: true
method: challenge-loop
branch: trust-restart-fallback
diff_hash: 5fc3d6d119b5ec33a5d35876da43cfcdbfe5421ef88c410b8dab3b67e545ca02
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T06:57:39Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 4 (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 2 | **Deferred:** 3 | **Asked (awaiting user):** 0

Change: a new HTTP route `POST /api/agent/:name/trust-and-restart` (the #2129
one-click fallback) plus a top-level `require('./engine/trust')`, and a new test
`server.trust-restart-fallback-2129.test.js`. The route writes the folder-trust
key for an agent's own folder+account through the create path's own native-keyed
writers, then restarts it; the trust write is best-effort/non-gating.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] .claude/plans/ -- no plan file for this branch --> DEFERRED: a single fallback route riding on #2129; design is in the commit message and card #2129, no standalone plan warranted.
- [NIT] server.js -- three name forms in the handler (readJob(name) raw, workerDir(cleanName(name)) cleaned) could theoretically diverge --> FIXED (commit 45df5012): one `clean` name used for readJob, workerDir, and restart.
- [NIT] server.js -- route never reads the request body, unlike the /restart sibling --> DEFERRED: deliberate, the route takes no input and hard-codes cause 'restart'; matches the body-less /restore route.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 NIT
**Duplicates (confirmed):** the plan-file CONVENTION (already deferred).
- [NIT] server.js -- the `if (!folder)` guard is unreachable: a truthy job means the name passed readJob's NAME_RE, so workerDir always returns a real path --> FIXED (commit 3d91df69): removed the dead branch and its misleading "could not resolve folder" message.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates (confirmed):** the plan-file CONVENTION; the no-body-read NIT.
- [NIT] server.js -- the codex trust branch reports no `already` flag (the Claude branch does) --> DEFERRED: cosmetic; `trustCodexFolder` is void and a no-op when already trusted, so reporting `already` would require changing that shared function's signature. The folder is trusted either way, which is what the caller acts on.
**Converged** -- no new actionable BLOCKER/WARNING/CONVENTION; the only new findings were cosmetic NITs.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | No plan file for this branch | DEFERRED | Single fallback route on #2129; design in commit + card |
| 2 | 1 | NIT | server.js | Name forms could diverge | FIXED | 45df5012 |
| 3 | 1 | NIT | server.js | Route does not read body | DEFERRED | By design; matches /restore |
| 4 | 2 | NIT | server.js | Unreachable `if (!folder)` guard | FIXED | 3d91df69 |
| 5 | 3 | NIT | server.js | Codex branch reports no `already` | DEFERRED | Cosmetic; would change void trustCodexFolder |

### NITs (non-blocking)
- All NITs are captured in the ledger above (two fixed, two deferred).

### Strengths (across all iterations)
- Security posture inherited by construction: not in REMOTE_AGENT_ROUTES, so remoteWriteGuard refuses network peers; board-token gated as an /api/ write; CSRF-covered. No new auth surface. (iters 1-3)
- Path traversal via :name closed at multiple layers (decodeSegment, readJob NAME_RE, workerDir nameUsable). (iters 1-3)
- Best-effort/non-gating trust write implemented correctly: trustFolder soft-fails read (not caught), trustCodexFolder wrapped, and removal.restart runs unconditionally after -- a failed trust write never withholds the restart. (iters 1-3)
- The trust key is the NATIVE realpath (the #2382 anti-divergence property), asserted by content in the test. (iters 1-3)
- The test seals BOTH providers' config roots, so the default-account arm (the fresh-user catastrophe) cannot touch a real ~/.claude.json or ~/.codex; each of the 4 arms carries a discriminating control and was verified red under a matching perturbation. (iters 1-3)
