---
pre_challenge: true
method: challenge-loop
branch: sheetrows-8940
diff_hash: 7bd9828f499d657a0a3fc2c606e7166e5e49719abdadce5dc8c701f140615c36
validation: passed
subdir_audit: passed
timestamp: 2026-11-23T18:46:46Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind review rounds, plus the initial validation pass (6.0), which passed clean.
**Converged:** Yes. Round 8 raised no BLOCKER, WARNING or CONVENTION finding, only NITs.
**Total findings:** 12 actionable (0 BLOCKERs, 12 WARNINGs, 0 CONVENTIONs), plus NITs
**Fixed:** 11 | **Deferred:** 1 (recorded as a plan residual) | **Asked (awaiting user):** 0

Validation: 6.0 at ccd787642e, rc 0 and audit rc 0. 6j at dbc438c3fb: 30,716 unit tests with 0 failures, all 4
shell shards passed, audit rc 0, tree clean. Between rounds, the two attachtext test files, plus orgchartfile.test.js
whenever orgchartfile.js changed, were run after every fix.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 (ITER_COMMITS was empty)
- [WARNING] engine/attachtext.js headerOf: a header cell of only spaces cancelled the whole header --> FIXED (ed0092b1bf)
- [WARNING] engine/attachtext.js sheetRows: a row numbered only on `<row r>` was numbered wrong --> FIXED (ed0092b1bf; oc.blocks gains an optional onOpen callback)
- [WARNING] engine/attachtext-8940.test.js: no cap test for long header names repeated on every row --> FIXED (ed0092b1bf)
- [NIT] sheet name unescaped (fixed), rows of spaces printed empty (fixed), U+2028/2029/0085 (fixed), year-like headers refused (plan residual), column-letter or ": " header words (plan residual), boolean other than 0/1 (left)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (a code line, fixed normally)
- [WARNING] engine/attachtext.js:146: oc.attr's `\br=` also matched a namespaced `x:r` --> FIXED (b869b52996, with a test and a measured before/after: 9 vs 2)
- [NIT] header heuristic, literal "(blank)", blanks memory: already plan residuals or fixed later (iteration 4)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the WARNINGs. One NIT was SELF and about prose: the row-number comment. The claim was DELETED, per 6e.
- [WARNING] engine/attachtext.js: the reading note did not say `\\` is one backslash --> FIXED (7b4f188652)
- [WARNING] engine/attachtext.js rowLinesInto: the blank list came last and was lost to the output cap on big sheets --> FIXED (7b4f188652, moved under the heading, with a test that the cap is reached)
- [WARNING] engine/attachtext.js headerOf: a one-column sheet never gets a header --> DEFERRED as a plan residual. A blank cell in a one-column sheet is an empty row, which is skipped, so only the column's name is lost.
- [NIT] a cell of only a line break showed `\n` rather than (blank) --> FIXED (trim before escaping); the cap test's length assertion could not fail --> FIXED (asserts the rows are cut)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the blank-scan line from 7b4f188652, code)
- [WARNING] engine/attachtext.js:212: the blank scan escaped every named cell --> FIXED (baaa14b35a, raw trim test plus a timed wide-whitespace test)
- [NIT] plan's "7 of 8" control count was stale (SELF, prose) --> FIXED by re-measuring, not rewording (4a41528eb7: 17 of 18 fail with main's two files swapped in)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] engine/attachtext.js rowLinesInto: about 1.7x the old table's size, so a 5000x20 sheet reaches the 2 MB cap near row 3732 and later sheets drop --> FIXED as a recorded decision (15b84107f4): the plan's "Cost" section states the measured numbers and why the cap is not raised here; the card's earlier "still under the cap" comment is corrected on the card
- [NIT] note wording "each line is one row" --> FIXED; fixed 5 s test deadlines --> eased to 20 s

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (prose at orgchartfile.js onOpen)
- [WARNING] engine/attachtext.js:148: the row number relies on onOpen running before each yield, unstated --> FIXED (7706f64e93). The comment was kept only because a check guards it: moving the call after the yield fails 15 of the 18 tests, measured.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (lineValue, code)
- [WARNING] engine/attachtext.js:186: VT, FF and U+001C to U+001E passed through and could forge a row for readers that split on them --> FIXED (dbc438c3fb, with a test)
- [WARNING] engine/attachtext.js:175 and orgchartfile.js:281: nothing pinned that an empty row still counts --> FIXED (dbc438c3fb). A test for self-closed and empty rows; both perturbations the reviewer named turn it red, measured.
- [NIT] single-quoted r --> FIXED; the others are left (doc comment on blocks, sheet-name pipe escaping, deadlines, a "later sheets left out" note, which predates this branch)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged**: no new actionable findings. The whole branch was reviewed, with nothing treated as settled.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/attachtext.js headerOf | BRANCH | space-only header cell cancels header | FIXED | ed0092b1bf |
| 2 | 1 | WARNING | engine/attachtext.js sheetRows | BRANCH | row numbered only on `<row r>` | FIXED | ed0092b1bf |
| 3 | 1 | WARNING | engine/attachtext-8940.test.js | BRANCH | no cap test for repeated long headers | FIXED | ed0092b1bf |
| 4 | 2 | WARNING | engine/attachtext.js:146 | SELF | x:r read as the row number | FIXED | b869b52996 |
| 5 | 3 | WARNING | engine/attachtext.js note | BRANCH | `\\` not explained | FIXED | 7b4f188652 |
| 6 | 3 | WARNING | engine/attachtext.js rowLinesInto | BRANCH | blank list lost to the cap | FIXED | 7b4f188652 |
| 7 | 3 | WARNING | engine/attachtext.js headerOf | BRANCH | one-column sheet has no header | DEFERRED | plan residual: nothing but the name is lost |
| 8 | 4 | WARNING | engine/attachtext.js:212 | SELF | blank scan escapes every cell | FIXED | baaa14b35a |
| 9 | 5 | WARNING | engine/attachtext.js rowLinesInto | BRANCH | 1.7x size reaches the cap sooner | FIXED | 15b84107f4 (decision recorded) |
| 10 | 6 | WARNING | engine/attachtext.js:148 | SELF | onOpen ordering unstated | FIXED | 7706f64e93 |
| 11 | 7 | WARNING | engine/attachtext.js:186 | SELF | VT/FF/FS/GS/RS unescaped | FIXED | dbc438c3fb |
| 12 | 7 | WARNING | engine/attachtext.js:175 | BRANCH | empty-row counting untested | FIXED | dbc438c3fb |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- Header rule both ways (`Region | 2023 | 2024` refused; an all-text first data row taken as the header): plan residual (iterations 1, 2)
- A cell whose text is literally "(blank)"; a header word that is a column letter or contains ": ": plan residuals (iterations 1, 2)
- A boolean whose value is neither 0 nor 1 shows its raw value (iteration 1)
- A `>` inside an attribute value can end the row tag early and mislabel a row; tabs are not escaped (iteration 6)
- blocks' doc comment does not list onOpen; a sheet name's pipe and backslash are escaped too (iterations 5, 7, 8)
- When the cap ends the sheet loop, the note does not name the sheets left out (predates this branch; iteration 7)

### Strengths (across all iterations)
- Every new loop and regex is linear, and every line goes through the existing capped sink. Shared-string amplification probes ran within about 1.2x of main's time (iterations 1, 3, 5, 7).
- oc.blocks' onOpen is optional and adds no second walk. The other callers are unchanged, and orgchartfile.test.js passes (iterations 2, 4, 6).
- The escaping order (backslash, then line breaks, then pipe) keeps the escapes unambiguous (iterations 1, 3, 6).
- The tests assert exact output, with controls: 17 of 18 new tests fail on main's code, and the 6098 rewrites keep what each one guarded (iterations 3, 4, 8).
