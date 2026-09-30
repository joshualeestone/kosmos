---
pre_challenge: true
method: challenge-loop
branch: boughtaddr-4756
diff_hash: 6b99155f3d0068357eaa971ad5ae715667a2bac529c325a010690ba44ab458a5
validation: focused per round (engine #4756, the route test, the Kosmos+ page tests run from the repo root, both browser-check gates, the gated check render-plus-bought-4756 and the two Kosmos+ sign-in checks, all on the merged head 43f4869c4); the FULL suite runs once on this head through mortals-validate, queued at convergence (fleet rule: focused per round, full once), result in the PR
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-09-30T19:17:49Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (reviewer model alternated: opus on odd rounds, sonnet on even)
**Converged:** Yes, at iteration 18 (its findings were NITs only; no new BLOCKER, WARNING or CONVENTION)
**Total findings:** 0 BLOCKERs, about 45 WARNINGs, 1 CONVENTION (repeats of one concern counted each time), about 40 NITs
**Fixed:** about 44 distinct | **Deferred:** 4 distinct | **Asked (awaiting user):** 0

**Deviation, stated:** 6.0/6g/6j's full validation helper was not run on every round. The fleet rule (Splinter 09-29,
April's tip) is focused tests per round and one full run at convergence, because every full run queues for Mortals.
The full run is queued on this exact head after this file is committed; the PR carries its result and nothing merges
without it (or the CI-starved rule's conditions).

**The largest finding, round 15 (opus):** the first build sent the 30-day sign-in session token as a Bearer over
Node's own HTTPS, which trusts any system CA; a TLS-inspecting proxy would have seen a token that can register a
computer. The read now goes through the tunnel binary (`signin addresses`, token on stdin, pinned key), as register
spends it. Ice Cream Kitty added the verb on the server branch (82c7bbb5).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION (no TypeScript), 4 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] failed Check again fell back to the account's in-use address --> FIXED (7a68df76)
- [WARNING] no-address account took the pick panel --> FIXED (7a68df76)
- [WARNING] refused pick looped on Try again --> FIXED (7a68df76)
- [WARNING] no busy state or timeout on the read --> FIXED (7a68df76)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above (code written by iteration 1's fix; fixed as code)
- [WARNING] previous step left live during the read --> FIXED (a77393a1)
- [WARNING] expired session on re-read did not go to Start over --> FIXED (a77393a1)
- [WARNING] re-read taking the old path left the list visible --> FIXED (a77393a1)
- [WARNING] reset computer forced to pick --> DEFERRED: the coordinator refuses that register today; retiring frees it

#### Iterations 3 to 14
**Reviewer model:** opus, sonnet alternating
**New findings:** 2 to 4 WARNINGs each, 0 BLOCKERs; mostly races and fail-open edges in the new session step
**Self-generated:** most, in code the previous fix wrote; fixed as code
- [WARNING] pick during a re-read; refused-pick reason overwritten; network failure read as refusal --> FIXED
- [WARNING] refusal matched on any "taken" text; retry of a picked address looped; pending own address registered --> FIXED
- [WARNING] redirect test could not fail; GET route open to other sites (crossSiteRead); no server route test --> FIXED
- [WARNING] iteration 9's "may be held by an earlier sign-in" as a refusal banished a person's own address --> FIXED in 11 (SELF, reverted)
- [WARNING] own address absent from the list still auto-registered --> DEFERRED: deliberate fail-open, the refusal returns to the list

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] session token sent as a Bearer over non-pinned HTTPS --> FIXED (16ecbd02): read through the tunnel binary
- [WARNING] token-posture comment incomplete --> FIXED (16ecbd02)

#### Iterations 16 and 17
**Reviewer model:** sonnet, opus
- [WARNING] rollout order undocumented --> FIXED (plan, and kosmos#4754 comment)
- [WARNING] timeout budget equal to the page's --> FIXED (3 s switch + 11 s read, past the binary's 10 s)
- [WARNING] older binary showed clap's usage line --> FIXED (1b31157e)
- [WARNING] shared in-flight read not keyed by session --> FIXED (1b31157e)
- [WARNING] refusal keyed on English sentences --> DEFERRED: code also accepted if the tunnel prints it; asked on #4754

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger (condensed; full detail in the commit messages of 7a68df76 through 1b31157e)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1-14 | WARNING | web/index.html | BRANCH/SELF | session-step races and fail-open edges | FIXED | 7a68df76..d1f1a920 |
| 2 | 9 | WARNING | server.js | BRANCH | GET route open to other sites | FIXED | 148e6c0b |
| 3 | 15 | WARNING | engine/remote.js | BRANCH | token over non-pinned HTTPS | FIXED | 16ecbd02 |
| 4 | 17 | WARNING | engine/remote.js | SELF | old binary, shared read, timeouts | FIXED | 1b31157e |
| 5 | 2 | WARNING | web/index.html | BRANCH | reset computer offered other addresses | DEFERRED | coordinator refuses; retire frees it |
| 6 | 14 | WARNING | web/index.html | SELF | own address absent from list auto-registered | DEFERRED | fail-open by design |
| 7 | 16 | WARNING | web/index.html | SELF | refusal keyed on sentences | DEFERRED | code accepted too; asked on #4754 |

### NITs (non-blocking, across all iterations)
- [NIT] buy_url accepts any https host (iterations 15, 16, 17): opens a page only; coordinator trusted
- [NIT] seven module-level flags in the session step (18): covered path by path by the gated check
- [NIT] 1 s margin between the engine budget and the page timeout (18)
- [NIT] the engine's `unsupported` flag is not used by the route (18)

### Strengths (across all iterations)
- The session token never reaches the page, argv or a direct request; tests prove where it goes
- Every async re-entry is guarded by an epoch and a read sequence
- One gated browser scenario per path of the session step, with a control (main's page fails it)
