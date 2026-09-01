---
pre_challenge: true
method: challenge-loop
branch: runnable-dir-shell-1716
diff_hash: eac20a9ae4093a6a83888479e8764b06183794e15414c4730db27cb1260f6c13
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T04:06:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 4 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 2 | **Deferred:** 2 | **Asked:** 0

kosmos#1716. `[ -x "$p" ]` succeeds on a DIRECTORY, so a directory named like a
binary read as an installed program across the shipped shell installer -- the
shell origin of the class #1592 fixed in JavaScript. Guarded every executable
test in the three installer files with a same-path file test: positive
`[ -x P ]` -> `[ -f P ] && [ -x P ]`, negated `[ ! -x P ]` -> `[ ! -f P ] || [ ! -x P ]`,
covering quoted and unquoted paths. Added a regression guard and reconciled four
JS tests that pinned the exact pre-fix installer lines.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
- [WARNING] tools/test-installer-runnable-guard.sh -- the coverage scan matched only QUOTED `[ -x "..." ]`, so it was blind to unquoted bare sites, and `install/kosmos-report-hook.sh:135` (`[ -x /opt/homebrew/bin/jq ]`) was left unfixed while the scan's PASS overstated completeness --> FIXED (40f3f42d): fixed the unquoted site and widened the scan to unquoted paths.
- [WARNING] install/kosmos:400/821, install/kosmos-report-hook.sh:213 -- three NEGATED `[ ! -x "$p" ]` tests are the same bug class, unguarded and uncatchable by the scan (a +x directory reads as executable to `[ ! -x ]` too); `$NODE` was guarded in cmd_start/cmd_version but not cmd_adopt --> FIXED (40f3f42d): `[ ! -f "$p" ] || [ ! -x "$p" ]` at each; scan widened to the negated form; control now plants both an unquoted `[ -x ]` and a `[ ! -x ]` and requires both flagged.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged.** Both NITs are latent scan-coverage limitations with no current instance in the installer:
- [NIT] the scan is line-based and covers `[ -x P ]` / `[ ! -x P ]` only, so it would not see `test -x`, `[[ -x ]]`, or an `-x` split across a `\` line-continuation --> DEFERRED: no such form exists in the installer today (it uses `[ ]` throughout; setup.sh is POSIX sh and cannot use `[[`), and the PASS message names its scope ("positive or negated, quoted or unquoted") rather than claiming all forms. A future edit using another spelling is the residual.
- [NIT] the guard is co-occurrence (`[ -f P ]` appears on the line), not proof the `-f` logically gates the `-x`; a contrived `[ -f P ] || echo; [ -x P ]` would pass --> DEFERRED: not produced by any current line; parsing the shell condition is disproportionate to a contrived edge.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | test-installer-runnable-guard.sh + report-hook:135 | unquoted bare [ -x ] unguarded + scan blind to it | FIXED | 40f3f42d |
| 2 | 1 | WARNING | kosmos:400/821, report-hook:213 | negated [ ! -x ] unguarded + scan blind to it | FIXED | 40f3f42d |
| 3 | 2 | NIT | test-installer-runnable-guard.sh | scan blind to test -x / [[ -x ]] / line-continuation | DEFERRED | no current instance |
| 4 | 2 | NIT | test-installer-runnable-guard.sh | co-occurrence not logical guarding | DEFERRED | unexploitable today |

### Outstanding questions (ASKED)
None.

### Validation
Full `yarn test` -- 3348/3348 pass (the installer content change broke four JS
tests that pinned exact pre-fix lines: server.connect, install.ends-on-action,
install.uninstall-sweep; each pinned string was tightened to the new guarded form,
not loosened). `yarn test:shell` green (installer syntax checks + the new guard).
The guard demonstrates the class (a +x directory passes bare [ -x ] but not the
guarded form; a real executable still passes) and its coverage scan is non-vacuous
(a planted unquoted [ -x ] and a planted [ ! -x ] are both flagged).

### NITs (deferred, non-blocking)
- test-installer-runnable-guard.sh -- scan covers [ -x ]/[ ! -x ] forms only, not test -x / [[ -x ]] (iteration 2)
- test-installer-runnable-guard.sh -- co-occurrence heuristic, not logical-gating proof (iteration 2)

### Strengths (verified by the reviewers)
- Precedence preserved on every one of the ~30 changed sites -- `(A && B) || C` grouping across || die / || return 1 / || { rm -rf; return 1 } / || true / || continue / if-then, including the dangerous rm -rf "$KOSMOS_HOME" OR-guard (setup.sh:1451) and the FRESH_INSTALL state gate.
- The negated transform is a correct De Morgan of the positive form, verified by truth table (real exec file passes; +x directory, missing, and non-exec file all read as not-runnable), including the OR-chained kosmos:821 with [ ! -d ].
- The guard ships a real negative control (a +x directory) and a planted-bare control proving the scan is not vacuous, and reaches all three files (proven by planting in the last-listed one).
- speaks_report's precedence change is strictly improved: a directory path now returns cleanly instead of trying to exec a directory.
- No em dashes in added lines.
