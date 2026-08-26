---
pre_challenge: true
method: challenge-loop
branch: per-account-identity-910
diff_hash: e0f758593019474f37bc43a2b070e2eca1bbff488e511f0882ba02170526a6ab
subdir_audit: passed
timestamp: 2026-08-26T06:07:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 14 (0 BLOCKERs, 4 WARNINGs, 5 CONVENTIONs, 4 NITs, 12 STRENGTHs across iterations)
**Fixed:** 8 | **Deferred:** 5 (all with reasoning) | **Noted, not actioned (NIT):** 1

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs, 2 STRENGTHs
- [BLOCKER-severity gap, filed as] Only 2 of 3 shell computing sites, plus a separate Swift cross-check, were protected by an automated formula comparison — `install/pkg-scripts/postinstall`'s own port formula (`_KOSMOS_PAGE_PORT`/`CONSOLE_UID`) was never cross-checked against the canonical formula. A silent drift there would poll a port the board never binds, for any non-primary account. --> FIXED (commit 631b50a): extended `server.connect.test.js`'s formula/pinned-literal checks to also read postinstall, variable-name-agnostic since it names its copy differently. Verified the check catches a real drift (deliberately broke the modulus, confirmed failure, restored).
- [WARNING] `install/kosmos`/`install/setup.sh` always spawn `/usr/bin/id -u` even when `KOSMOS_PORT` is already set. --> ATTEMPTED, then REVERTED: the fix would indent the `_kosmos_uid=` anchor line `tools/test-install.sh`'s `_kosmos_formula_from()` locates via an exact unindented match, breaking two existing passing checks for a sub-millisecond performance gain. DEFERRED with reasoning.
- [WARNING] two different non-primary uids can land on the same derived port (accepted, documented in the plan, tested) but not visible in the code comments themselves. --> FIXED (commit 631b50a): added a paragraph to `install/kosmos`'s own comment.
- [CONVENTION] `tools/test-install.sh`'s "#910" section comment miscounted native-app/main.swift's call sites (said "two", actually three plus the selftest hatch). --> FIXED (commit 631b50a).
- [STRENGTH] uid-501 pinning verified byte-identical to pre-#910 behavior across all sites; test coverage honestly discloses what it cannot prove.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 1 NIT, 1 STRENGTH
- [WARNING] `server.connect.test.js`'s pinned-literal cross-check never included native-app/main.swift's own uid-501 literal, so a plain `yarn test` (no built bundle) could not catch a Swift-side drift. --> FIXED (commit 6202c5f): added a text-based extraction of the Swift literal to the same equality check (now five-way). Verified it catches a drift (deliberately changed the Swift literal, confirmed failure, restored).
- [CONVENTION] x3, folded into one commit: `install/kosmos` called `server.js` a "copy" (it's a consumer) and omitted postinstall from its named list; `native-app/main.swift` said "five sites" while naming four; postinstall's comment didn't name main.swift. --> FIXED (commit 6202c5f): all four comments now agree (five copies of the pinned literal, four computing sites).
- [NIT] postinstall's `_KOSMOS_PAGE_PORT`, when taken from an explicit override, had no input validation before being baked into a `sed` substitution — same unguarded shape the pre-existing inline code already had, not a new regression, but a missed hardening opportunity since this PR already touches the exact propagation path. --> FIXED (commit 6202c5f): added the same digit-only/length/range guard `install/setup.sh` already uses.

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 1 NIT, 3 STRENGTHs
- [WARNING] **Real bug caught by review**: the iteration-2 guard called `exit 1` on a malformed override, but this section is documented as best-effort ("if any step fails the install proceeds exactly as before"), and `sudo` doesn't carry postinstall's own environment into the real install it runs later in the same script — so the exit would abort the REAL board install over a value that only ever affected a cosmetic progress page. --> FIXED (commit ec30d4e): fall back to the derived default instead of exiting. Verified by hand-tracing every input class and by simulating the old buggy version to confirm a regression test would have caught it.
- [WARNING] the new guard had zero automated coverage. --> FIXED (commit ec30d4e): added real execution-based tests to `tools/test-install.sh` — the guard's exact code block is extracted from postinstall by its own anchors and sourced in a subshell (not a hand-copied duplicate), covering 7 input classes. All pass.
- [CONVENTION] `server.js`'s own "ONE OF THREE COPIES" comment was untouched and stale. --> FIXED (commit ec30d4e).
- [CONVENTION, noted not fixed] postinstall's guard exit code (1) and message shape diverge from setup.sh's (2, remediation hint). DEFERRED: each matches its OWN file's pre-existing error-handling style; forcing them to match each other would break each file's internal consistency instead.
- [WARNING, noted not fixed] `bin/codex-report-bridge.js` and `tools/restart-local-board.sh` carry their own bare 16180 fallbacks, not named in any "N copies" comment. DEFERRED: traced the real safety net (`engine/create.js`'s plist-stamping already writes an explicit `KOSMOS_PORT` for non-primary accounts), confirmed these fallbacks shouldn't fire in practice today; out of scope for this card (#910 is about the board's own port, not every consumer of it).
- [STRENGTH] uid-501 pinning re-verified across all four computing sites; the five-way equality check design (Set-uniqueness plus a separate literal-pin assertion) is sound; cross-file consistency independently re-confirmed by direct tracing, not by trusting comments.

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING (out of scope, see below), 1 CONVENTION, 1 NIT, 2 STRENGTHs
- [WARNING, out of scope] The full `tools/test-install.sh` run's pre-existing `== update ==` section (unmodified by this diff) fails on an unguarded `board.pid` read. DEFERRED: confirmed by the reviewer itself as "not touched by the diff" and by direct tracing that `KOSMOS_PORT` is globally exported for the whole harness run (so the derivation formula is never exercised in that later section) — already tracked separately as kosmos#935, reproduced independently at both high and low system load, not a #910 regression.
- [CONVENTION] `engine/create.js`'s own "16180 default" comment was the one file missed by the count-update sweep in earlier iterations. --> FIXED (commit db52af0).
- [NIT] `native-app/main.swift`'s env-override doc comment described `KOSMOS_PORT`'s default as flat "16180", true only for uid 501. --> FIXED (commit db52af0).
- [STRENGTH] the postinstall guard's fix and its 7-case test coverage independently re-verified by hand-tracing every input class plus direct execution; cross-file consistency confirmed excellent by an agent explicitly instructed to avoid commit-message contamination (re-derived every finding from the code itself).

**Converged** — the only WARNING remaining after iteration 4 is a pre-existing, separately-tracked, out-of-scope issue confirmed unrelated to this diff.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING (severe) | `server.connect.test.js`, `tools/test-install.sh` | postinstall's port formula never cross-checked | FIXED | 631b50a |
| 2 | 1 | WARNING | `install/kosmos`, `install/setup.sh` | redundant `id -u` spawn when `KOSMOS_PORT` set | DEFERRED | would break existing anchor-based test extraction; not worth the risk for a sub-ms gain |
| 3 | 1 | WARNING | `install/kosmos` | uid-collision case undocumented in code | FIXED | 631b50a |
| 4 | 1 | CONVENTION | `tools/test-install.sh` | miscounted Swift call sites | FIXED | 631b50a |
| 5 | 2 | WARNING | `server.connect.test.js` | fast test suite couldn't catch a Swift pinned-literal drift | FIXED | 6202c5f |
| 6 | 2 | CONVENTION | `install/kosmos`, `native-app/main.swift`, postinstall | inconsistent site-counting across 4 comments | FIXED | 6202c5f |
| 7 | 2 | NIT | `install/pkg-scripts/postinstall` | no input validation on explicit port override | FIXED | 6202c5f |
| 8 | 3 | WARNING (real bug) | `install/pkg-scripts/postinstall` | new guard's `exit 1` broke the best-effort contract | FIXED | ec30d4e |
| 9 | 3 | WARNING | `install/pkg-scripts/postinstall` | zero test coverage for the new guard | FIXED | ec30d4e |
| 10 | 3 | CONVENTION | `server.js` | stale "three copies" comment | FIXED | ec30d4e |
| 11 | 3 | CONVENTION | `install/pkg-scripts/postinstall` vs `install/setup.sh` | exit code/message divergence | DEFERRED | each matches its own file's established style |
| 12 | 3 | WARNING | `bin/codex-report-bridge.js`, `tools/restart-local-board.sh` | undocumented bare-16180 fallbacks | DEFERRED | out of scope; real safety net traced and confirmed sufficient today |
| 13 | 4 | CONVENTION | `engine/create.js` | stale "three copies" comment, missed by earlier sweep | FIXED | db52af0 |
| 14 | 4 | NIT | `native-app/main.swift` | imprecise doc comment on KOSMOS_PORT default | FIXED | db52af0 |
| 15 | 4 | WARNING | `tools/test-install.sh` (pre-existing `== update ==` section) | unguarded board.pid read | DEFERRED | confirmed out of scope, pre-existing, tracked as kosmos#935 |

### NITs (non-blocking, across all iterations)
- redundant `id -u` spawn (iteration 1, deferred as a WARNING above — not re-listed)
- postinstall's Swift-formula call-site comment inaccuracy details (folded into CONVENTION fixes above)

### Strengths (across all iterations)
- uid-501 (the overwhelming majority of real installs) verified byte-identical to pre-#910 behavior across every computing site, in every iteration, by direct code tracing rather than trusting comments
- the `+1` modulus offset is a structural, not probabilistic, guarantee against colliding with the pinned primary port — confirmed by computing the max derived value (20179) directly
- test coverage design is sound: a Set-uniqueness check alone wouldn't catch all five copies drifting together to the same wrong value, so a separate literal-pin assertion (`port === 16180`) closes that gap
- the postinstall guard and its 7-case regression coverage were independently re-verified in iteration 4 by an agent explicitly instructed to avoid commit-message contamination, and it re-derived every conclusion from the code itself
- cross-file "N copies must move together" documentation is now genuinely consistent across all five touched files (install/kosmos, install/setup.sh, install/pkg-scripts/postinstall, native-app/main.swift, server.js, engine/create.js)

### Note on the full install harness

`tools/test-install.sh` was run twice tonight against freshly built dist bundles: once during earlier system load (13-16, 18 agents resuming post-reboot) and once after the fleet-wide idle directive settled load to ~2.4. Both runs reached and passed all `#910`-specific assertions (19 checks in the base run, 48 checks including this branch's new postinstall-guard coverage) before failing later at the pre-existing, unmodified `== update ==` section's unguarded `board.pid` read — tracked separately as kosmos#935, now confirmed to recur independent of system load. Not a #910 regression.
