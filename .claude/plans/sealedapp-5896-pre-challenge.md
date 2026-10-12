---
pre_challenge: true
method: challenge-loop
branch: sealedapp-5896
diff_hash: bdd29a93b4bafc1b1ea8b1250e402f76595407b9cbb22f0d394b2a530dad92c1
validation: passed (Mortals, entry 2026-10-12T06:32:13Z, hash bdd29a93b4ba)
subdir_audit: passed
timestamp: 2026-10-12T06:33:10Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 raised one WARNING, a duplicate of a deferred iteration-8 finding)
**Total findings:** 20 WARNINGs (0 BLOCKERs, 0 CONVENTIONs), plus NITs listed below
**Fixed:** 11 | **Deferred:** 8 | **Duplicate:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift installConfigCandidates: the account file overrode a bundle copy that is this account's own --> FIXED (edf8fef75)
- [WARNING] install/setup.sh write_install_config: the sandbox guard compared strings and missed the firmlink/symlink spellings --> FIXED (edf8fef75, -ef)
- [WARNING] native-app/main.swift header: a sandboxed launch must avoid the real Library --> FIXED (edf8fef75, reworded dd5bf27fd)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] install/setup.sh uninstall: an interrupted write's temp file kept the folder --> FIXED (65099aad5)
- [WARNING] install/setup.sh guard: a custom KOSMOS_HOME self-host install writes no account file --> DEFERRED: the plan's weakest premise; a slice-2 gate, recorded on the card
- [WARNING] native-app/main.swift load: a stale account file once the bundle copy goes --> DEFERRED: slice-2 gate, recorded on the card

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift load: a stale account file beat a foreign bundle copy in slice 1 --> FIXED (dd5bf27fd; tightened 960ff02c6)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] install/setup.sh write_install_config: KOSMOS_HOME interpolated into JSON unescaped --> FIXED (2f2cc3d4b, a home with a quote, backslash or control character is refused)
- [WARNING] native-app/main.swift load: a sole stale account file is still read --> DEFERRED: nothing to yield to, and the defaults are a different install, no better

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] native-app/main.swift installConfigCandidates: the app ignored AGENT_WORKFORCE_HOME, which the installer honours --> FIXED (f3a273766)
- [WARNING] native-app/main.swift load: with no install folder visible, a stale own file won --> FIXED (f3a273766, the bundle copy wins)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] native-app/main.swift installConfigCandidates: an inherited AGENT_WORKFORCE_HOME points the app at a sandbox --> DEFERRED: every other Library read in the app honours it
- [WARNING] native-app/main.swift load: a same-uid bundle copy beats a newer account file --> DEFERRED: main's existing behaviour until slice 2 removes the copy

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-install.sh: the end-to-end suite cannot see the uninstall removal --> FIXED (557ffdf3a, stated at the chk)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] install/setup.sh guard: a harness moving only HOME --> DEFERRED: a harness bug, per the reviewer
- [WARNING] native-app/main.swift load doc: single-candidate wording --> DEFERRED: identical result, pinned by the selftest
- [WARNING] install/setup.sh uninstall: a bundle copy can name a deleted install --> DEFERRED: pre-existing behaviour

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] native-app/main.swift load: "folder exists" was looser than the #664 test (bin/kosmos executable) --> FIXED (960ff02c6, with a real-folder row)
- [WARNING] install/setup.sh uninstall: AGENT_WORKFORCE_HOME asymmetric between install and uninstall --> DEFERRED: the same as every AGENT_WORKFORCE_HOME-keyed write; the anchored match stays safe

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (after deduplication)
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (positional bundle detection = iteration 8, deferred)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | native-app/main.swift | BRANCH | account file overrode own bundle copy | FIXED | edf8fef75 |
| 2 | 1 | WARNING | install/setup.sh | BRANCH | string-compare sandbox guard | FIXED | edf8fef75 |
| 3 | 1 | WARNING | native-app/main.swift | BRANCH | header: sandboxed launch | FIXED | edf8fef75 |
| 4 | 2 | WARNING | install/setup.sh | BRANCH | temp file kept folder | FIXED | 65099aad5 |
| 5 | 2 | WARNING | install/setup.sh | BRANCH | custom-home self-host no account file | DEFERRED | slice-2 gate on card |
| 6 | 2 | WARNING | native-app/main.swift | BRANCH | stale account file after slice 2 | DEFERRED | slice-2 gate on card |
| 7 | 3 | WARNING | native-app/main.swift | BRANCH | stale account file beat foreign bundle | FIXED | dd5bf27fd |
| 8 | 4 | WARNING | install/setup.sh | BRANCH | unescaped KOSMOS_HOME in JSON | FIXED | 2f2cc3d4b |
| 9 | 4 | WARNING | native-app/main.swift | BRANCH | sole stale account file read | DEFERRED | defaults no better |
| 10 | 5 | WARNING | native-app/main.swift | BRANCH | AGENT_WORKFORCE_HOME ignored | FIXED | f3a273766 |
| 11 | 5 | WARNING | native-app/main.swift | BRANCH | no folder visible: stale own file won | FIXED | f3a273766 |
| 12 | 6 | WARNING | native-app/main.swift | SELF | inherited AGENT_WORKFORCE_HOME | DEFERRED | matches the app's other reads |
| 13 | 6 | WARNING | native-app/main.swift | BRANCH | same-uid bundle beats newer file | DEFERRED | main's behaviour until slice 2 |
| 14 | 7 | WARNING | tools/test-install.sh | BRANCH | e2e cannot see removal | FIXED | 557ffdf3a |
| 15 | 8 | WARNING | install/setup.sh | BRANCH | harness moving only HOME | DEFERRED | harness bug |
| 16 | 8 | WARNING | native-app/main.swift | SELF | single-candidate wording | DEFERRED | selftest-pinned |
| 17 | 8 | WARNING | install/setup.sh | BRANCH | bundle copy names deleted install | DEFERRED | pre-existing |
| 18 | 9 | WARNING | native-app/main.swift | SELF | folder-exists looser than #664 | FIXED | 960ff02c6 |
| 19 | 9 | WARNING | install/setup.sh | BRANCH | AGENT_WORKFORCE_HOME asymmetry | DEFERRED | anchored match safe |
| 20 | 10 | WARNING | native-app/main.swift | SELF | positional bundle detection | DUPLICATE | of #16 |

### NITs (non-blocking, across all iterations)
- Taken: mktemp for the temp name; lift _kosmos_home_default from setup.sh; failed-write case; assertion message; root skip; symlink-arm test; header lines; plan counts; rmdir pin; empty KOSMOS_APP_TEST_HOME helper; real-folder row.
- Not taken: re-validate PORT in the writer; an info line for the sandbox guard's rc=2 (raised three times; it fires in every harness too); Phase 3 header wording; a test title that claims more than its source match.

### Strengths (across all iterations)
- The sandbox guard compares homes with -ef and is tested against two real alternate spellings of one directory (iterations 2-10).
- The read order is a pure function pinned by 14 selftest rows; each rule was perturbed and its row failed (iterations 3, 5, 9).
- The tests lift the real write_install_config, uninstall block and _kosmos_home_default from setup.sh rather than copying them (iterations 4, 7).
