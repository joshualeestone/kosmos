---
method: challenge-loop
branch: gnulint-6808
diff_hash: 3471ebd25b009fb516abdfaaf69ea1099bee7d970f42061a9bc87d1949b027f5
timestamp: 2026-10-21T08:13:27Z
iterations: 5
converged: true
---

#### Iteration 1
Blind review of the first version. 0 BLOCKER, 8 SHOULD, 4 NIT, all on the regexes' reach. FIXED: counterparts no longer
excuse at 3 lines (same || chain or the line beside it); long spellings; flags with digits before the one that matters;
date -d@N; stat -Lc; timeout "$T"; a command after a quote, path or brace; sed -Ei '' allowed; #! /bin/sh listed.
DOCUMENTED, not built: backslash-continued commands, other GNU-only tools, git grep -P and quoted prose flagged.

#### Iteration 2
1 SHOULD: any || on the line excused a hit (`sed -i '' a && sed -i 's/p/q/' b || true` passed). FIXED: the line is
split at ; and &&, and the GNU form's own piece needs the counterpart and a ||. Two must-flag cases.

#### Iteration 3
1 SHOULD (regression of 2): a ; inside a quoted sed script split the command. FIXED: an awk walker splits outside
quotes only. Two allow cases.

#### Iteration 4
1 SHOULD: an escaped quote opened a quote that never closed (could only excuse). FIXED: a backslash outside single
quotes takes the next character. Two must-flag cases; mutant (rule removed) turns both red.

#### Iteration 5
Converged: no BLOCKER or SHOULD. The splitter's escapes checked on BSD awk and mawk (trailing backslash, escaped
backslash before a closing quote, backslash inside single quotes, escaped ;).

Tests: tools/test-gnu-only-forms-6808.sh 50 ok (117 product shell files, clean tree); a GNU form planted in
install/kosmos-report-hook.sh goes red naming the line; tools.every-test-runs and tools.shell-shard-4317 22/22.

### Final Ledger

| round | blocker | should-fix | nit | outcome |
|---|---|---|---|---|
| 1 | 0 | 8 | 4 | fixed, 2 documented as gaps |
| 2 | 0 | 1 | 1 | fixed |
| 3 | 0 | 1 | 0 | fixed |
| 4 | 0 | 1 | 0 | fixed, mutant-proved |
| 5 | 0 | 0 | 0 | converged |

#### Rebase 2026-10-22 03:4xZ
- Rebased onto main: package.json test:shell conflict resolved as all 278 of main's pieces plus the branch's two (checked by script). tools/test-gnu-only-forms-6808.sh passes on the rebased tree.
