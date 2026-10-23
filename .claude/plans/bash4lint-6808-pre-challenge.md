---
pre_challenge: true
method: challenge-loop
branch: bash4lint-6808
diff_hash: 0d16c7c61fb64bd031cd8df6255c710e1b4c7433993250395a234d008c59c7a3
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T20:52:57Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 33 (0 BLOCKERs, 10 WARNINGs, 0 CONVENTIONs, 23 NITs)
**Fixed:** all 10 WARNINGs; NITs fixed or documented as listed per iteration | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation for this branch is the lint itself under the Mac's /bin/bash 3.2.57 (exit 0, tree scan of every product
shell file clean) plus tools.every-test-runs and tools.shell-shard-4317 (27/27), the same set the original #6808 PR
used. A planted `mapfile` in install/kosmos-report-hook.sh turned the lint red naming that line (control; restored).
Every bash 3.2 claim a reviewer raised was re-measured on 3.2.57 before acting, each form in its own file.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-gnu-only-forms-6808.sh:60 — declare -A/-n matched only as the last flag letter (declare -Ag missed) --> FIXED (dfc3b84057)
- [WARNING] tools/test-gnu-only-forms-6808.sh:60 — `[ -d /usr/local -o -n x ]` flagged (local after a slash) --> FIXED (dfc3b84057, BK without the slash)
- [WARNING] tools/test-gnu-only-forms-6808.sh:67 — shopt covered only globstar/lastpipe with exact `-s ` (inherit_errexit, -qs missed) --> FIXED (dfc3b84057)
- [WARNING] tools/test-gnu-only-forms-6808.sh:63,65 — no-space `make|&tee` and `x;&` missed --> FIXED (dfc3b84057; HTML entities after a pipe in tools/post-release-notes.sh then needed an exclusion, added with a planted case)
- [NIT] header said bash -n accepts most forms; measured: it rejects |&, &>>, ;;&, ;& --> FIXED (header says which)
- [NIT] ${!x,,} missed --> FIXED
- [NIT] trailing comment naming a form is flagged --> FIXED (documented)
- [NIT] duplicate empty comment line --> FIXED
- [NIT] lookalikes `cmd &> log`, `${x:0:1}` --> FIXED (planted)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (compat3[0-9], added in iteration 1's fix)
- [WARNING] tools/test-gnu-only-forms-6808.sh:69 — compat3[0-9] flagged compat31, valid on 3.2 --> FIXED (7cbfa0e5bc, compat32 and compat4x only)
- [WARNING] tools/test-gnu-only-forms-6808.sh:26-31 — ${x:0:-1}, declare -g/-l/-u, read -t 0.5 unflagged (all measured failing on 3.2) --> FIXED (7cbfa0e5bc)
- [NIT] plan counts stale --> FIXED (counts dropped; one overclaim in the plan narrowed)
- [NIT] |& inside a sed string flagged; `;;&&` flagged; re-confirm |& under -n (it is rejected) --> documented / confirmed

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (both on patterns iteration 2's fix wrote; code lines, fixed normally)
- [WARNING] tools/test-gnu-only-forms-6808.sh:72 — ${x::-1}, ${x:i:-1}, ${x:${#x}:-1} missed --> FIXED (45fcc0a092)
- [WARNING] tools/test-gnu-only-forms-6808.sh:73 — read -t "0.5" and read -p q -t 0.5 missed --> FIXED (45fcc0a092)
- [NIT] readonly -A, newer shopt options, |& in a string, shopt -q probe --> FIXED or documented
- [NIT] GNU grep stray-backslash question --> FIXED (literal $ { } [ ] as bracket expressions)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the EPOCH pattern after iteration 3's rewrite)
- [WARNING] tools/test-gnu-only-forms-6808.sh:75 — `shopt -s globstar;` missed (terminator) --> FIXED (c24669a5fe)
- [WARNING] tools/test-gnu-only-forms-6808.sh:76 — EPOCHSECONDS without $ in arithmetic missed (silently 0 on 3.2, measured) --> FIXED (c24669a5fe)
- [NIT] declare -A; terminator, /var/mapfile path, unset -n --> FIXED (planted)
- [NIT] |& in sed alternation; assertion matches form not line --> documented / accepted

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-gnu-only-forms-6808.sh:60 | BRANCH | declare flag only as last letter | FIXED | dfc3b84057 |
| 2 | 1 | WARNING | tools/test-gnu-only-forms-6808.sh:60 | BRANCH | /usr/local flagged | FIXED | dfc3b84057 |
| 3 | 1 | WARNING | tools/test-gnu-only-forms-6808.sh:67 | BRANCH | shopt reach | FIXED | dfc3b84057 |
| 4 | 1 | WARNING | tools/test-gnu-only-forms-6808.sh:63 | BRANCH | no-space pipe-amp / case-fall | FIXED | dfc3b84057 |
| 5 | 2 | WARNING | tools/test-gnu-only-forms-6808.sh:69 | SELF | compat31 false positive | FIXED | 7cbfa0e5bc |
| 6 | 2 | WARNING | tools/test-gnu-only-forms-6808.sh:26 | BRANCH | neg length, declare -g/-l/-u, read -t fraction | FIXED | 7cbfa0e5bc |
| 7 | 3 | WARNING | tools/test-gnu-only-forms-6808.sh:72 | SELF | empty / bare / nested offset | FIXED | 45fcc0a092 |
| 8 | 3 | WARNING | tools/test-gnu-only-forms-6808.sh:73 | SELF | quoted or later read -t | FIXED | 45fcc0a092 |
| 9 | 4 | WARNING | tools/test-gnu-only-forms-6808.sh:75 | BRANCH | shopt terminator | FIXED | c24669a5fe |
| 10 | 4 | WARNING | tools/test-gnu-only-forms-6808.sh:76 | SELF | EPOCH in arithmetic | FIXED | c24669a5fe |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-gnu-only-forms-6808.sh:71 — `sed 's/.*/|&|/'` is flagged as bash4-pipe-amp; only `# bash4-ok:` clears it (iteration 5; the quoted-string over-reach is documented in the header)
- [NIT] tools/test-gnu-only-forms-6808.sh:73 — `;& ` inside a string is flagged (iteration 5)
- [NIT] tools/test-gnu-only-forms-6808.sh:77 — `${x:${start:-0}}` flagged as neg-length; it is invalid on 3.2 anyway, for another reason (iteration 5)
- [NIT] tools/test-gnu-only-forms-6808.sh:68,75 — declare -I, bash 5.3 shopt options, `|&cat;` and `mapfile<f` not flagged (iteration 5; a floor)
- [NIT] tools/test-gnu-only-forms-6808.sh:75 — shopt's `.*` crosses a `;` (iteration 5)
- [NIT] tools/test-gnu-only-forms-6808.sh — GNU grep is not on this Mac; the Linux shards are the measurement (iterations 3, 5)

### Strengths (across all iterations)
- Each excuse clears only its own kind, with a control in each direction (iterations 1-5)
- Planted positives assert their own form name; planted lookalikes assert empty output (iterations 1, 5)
- The pre-existing GNU-form checks are unchanged apart from the excuse split (iterations 2, 4, 5)
