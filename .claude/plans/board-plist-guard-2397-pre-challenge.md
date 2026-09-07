---
pre_challenge: true
method: challenge-loop
branch: board-plist-guard-2397
diff_hash: 7a75becb885f7eee336d24c16fd91fa32f8413a89718aa789a086c2eacc4d3fd
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T18:59:52Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 produced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 4 NITs)
**Fixed:** 8 | **Deferred:** 1 (a NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/machine.js — `fs.existsSync` collapsed an unreadable LaunchAgents dir (EACCES/ENOTDIR) into "file absent" -> false ATTENTION, inconsistent with installedCheck/labelTruthCheck fail-soft --> FIXED (99571a1b): statSync + ENOENT-vs-other split; non-ENOENT -> UNKNOWN. +test.
- [WARNING] engine/machine.js — disable-token regex matched only `=> disabled`; older macOS `print-disabled` emits `=> true`, so a disabled board could fall through to a false OK (cannot-see-zero direction) --> FIXED (99571a1b): match `(?:disabled|true)\b`. +test.
- [NIT] web/index.html:10635 — stale "the five are…" check enumeration (now six with autostart) --> FIXED (99571a1b): five -> six.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] .claude/plans/board-plist-guard-2397.md — em dashes (Josh's absolute no-em-dash rule) --> FIXED (e29807b7).
- [NIT] engine/machine.js — the `uid === null` guard is unreachable on the darwin path --> FIXED (e29807b7): comment noting it is a consistency mirror of restartCheck/labelTruthCheck, kept deliberately.
- [NIT] engine/machine.js — comment asserted an unverifiable "verified against live launchctl" claim --> FIXED (e29807b7): softened to "the format launchctl prints on current macOS"; the (?:disabled|true) match makes the exact token non-load-bearing.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
- [CONVENTION] engine/machine.js — the statSync comment overstated cross-row agreement (a genuinely-missing LaunchAgents dir makes this check diverge from labelTruthCheck) --> FIXED (iter-3 commit): corrected to state non-ENOENT fails soft to unknown, while a missing plist/dir is deliberately reported as "no login job".
- [NIT] engine/machine.test.js — the never-mutates-launchd test would pass vacuously on zero calls --> FIXED (iter-3 commit): `assert.ok(calls.length >= 1)` before the verb loop.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (one a duplicate)
- [NIT] engine/machine.test.js:772-790 — the "five checks" test's `mixed` call reads the real ~/Library/LaunchAgents (AGENT_WORKFORCE_LAUNCH restored before it) --> DEFERRED: robust in practice (the mixed check passes `installedRoot:null`, so it resolves OK deterministically regardless of the real dir; the same real-dir exposure pre-exists for labelTruthCheck in that block). Pure symmetry, no behavior risk.
- [NIT] engine/machine.js uid guard — DUPLICATE of iteration-2's finding; the reviewer confirmed it is documented dead code, not a defect.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/machine.js | existsSync collapsed EACCES into missing -> false attention | FIXED | 99571a1b |
| 2 | 1 | WARNING | engine/machine.js | disable token only `disabled`, misses older `true` | FIXED | 99571a1b |
| 3 | 1 | NIT | web/index.html:10635 | stale five->six check enumeration | FIXED | 99571a1b |
| 4 | 2 | CONVENTION | .claude/plans/board-plist-guard-2397.md | em dashes | FIXED | e29807b7 |
| 5 | 2 | NIT | engine/machine.js | uid guard unreachable on darwin path | FIXED | e29807b7 (documented) |
| 6 | 2 | NIT | engine/machine.js | unverifiable "verified" comment claim | FIXED | e29807b7 |
| 7 | 3 | CONVENTION | engine/machine.js | statSync comment overstated row agreement | FIXED | iter-3 commit |
| 8 | 3 | NIT | engine/machine.test.js | never-mutates test vacuous on zero calls | FIXED | iter-3 commit |
| 9 | 4 | NIT | engine/machine.test.js:772 | mixed check reads real dir (symmetry) | DEFERRED | robust; installedRoot:null mitigates; pre-existing in spirit |

### Contention note (not a defect)
6j final validation first went red on `tools.release-gate.test.js` — a concurrent `tools/test-install.sh` (another agent's harness, pid 84148) held the install gate's fixed port, and the release-gate test's own guard fired against it. Re-run of that file alone: 22/22 pass. Full 6j re-run once the box was quiet: passed. Unrelated to this change (which touches only engine/machine.js + its test + a one-line web/index.html comment).

### NITs (non-blocking, across all iterations)
- [NIT] engine/machine.test.js:772 — "five checks" mixed block reads real ~/Library/LaunchAgents (deferred; robust via installedRoot:null).

### Strengths (across all iterations)
- Delivers the cannot-see-zero guard the card names, correctly distinguished from labelTruthCheck's impostor-only contract.
- statSync ENOENT split fails soft to UNKNOWN (never fabricates a checked negative from a could-not-look), matching the module's discipline.
- `(?:disabled|true)\b` regex is precise across modern/legacy launchctl tokens; closing-quote anchor blocks a suffixed-label false match; `\b` blocks `disabledx`.
- Detection-only conservatism enforced by a spy test (only ever `print-disabled`, never a mutating verb), now non-vacuous.
- `launchAgentsDir()` extraction is behavior-preserving and collapses the #1732 env-home coupling to one site.
- Tests perturbation-armed; wiring test asserts 5 rows + exact key order; non-darwin null filtered by check().
