---
pre_challenge: true
method: challenge-loop
branch: keychain-9254
diff_hash: fa2e837471843f903e484177d6a26c1e274da54338b5d70922eebeff4694434a
validation: passed (local, 31885 tests, 0 failed, entry clean fa2e83747184)
subdir_audit: passed
timestamp: 2026-11-28T05:14:18Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. The loop stopped after iteration 8 under Splinter's standing review-usage rule ("A review loop stops at 8 rounds unless a BLOCKER is still open", 2026-10-22, restated in Fleet Builders m510). No BLOCKER was ever raised. Round 8's two WARNINGs (an argv form of `/usr/bin/open`, and home-rooted paths) were fixed in f40ec2b2be, with controls. Those edits were not reviewed again.
**Total findings:** 58 (0 BLOCKERs, 20 WARNINGs, 0 CONVENTIONs, 38 NITs)
**Fixed:** 39 | **Deferred:** 19 | **Asked (awaiting user):** 0

Each round's findings tightened one guard test, browser-launch-keychain-9254.test.js. The deferred items are all one of three kinds:
- shapes a text scan cannot read (a Chrome path held in a variable; non-JavaScript spellings), which the header states;
- contrived shapes that fail closed;
- reviewers asking whether this closes the card. It does not: the launcher is not covered by any record we hold, and the header says so.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS was empty)
- [WARNING] the walk skipped the repo root --> FIXED (28839a5d68)
- [WARNING] the defaults-off patterns missed variables, quoted keys, multi-line arrays and spreads --> FIXED (28839a5d68)
- [WARNING] the direct-run rule missed some shapes, and its check was file-wide --> FIXED (28839a5d68)
- [WARNING] the repo-written MCP config had no assertion --> FIXED (28839a5d68); later dropped as duplicated by engine/agentbrowser.test.js (iteration 6)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (the value scanner, from iteration 1)
- [WARNING] values like `x ? [...] : ALL` and `.concat(...)` read as safe --> FIXED (e133af3014): a strict shape rule (a literal safe list, or a ternary of two)
- [WARNING] shorthand and assignment forms went unseen --> FIXED (e133af3014)
- [WARNING] the header overclaimed what it covers --> FIXED (e133af3014)
- [WARNING] some rules could be removed with every control still green --> FIXED (e133af3014): a control per clause
- [WARNING] the walk used a folder list --> FIXED (e133af3014): git ls-files

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1
- [WARNING] a one-arm ternary, and Prettier-style continuation lines --> FIXED (52fa399be6)
- [WARNING] clauses that survived mutation --> FIXED (52fa399be6): controls for each
- [WARNING] an escaped quote in `open -a` --> FIXED (52fa399be6)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the null value, from iteration 2)
- [WARNING] `offenders()` crashed on a file that only names the option --> FIXED (e970355390)
- [WARNING] the argv `open` form was not caught --> FIXED (e970355390)
- [WARNING] the header should name the one direct run it cannot see (agentbrowser.js `execP`) --> FIXED (e970355390)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the header did not say that the original launcher is unidentified --> FIXED (ee3efc9e99)
- [WARNING] `open -a Chrome` was missed --> FIXED (ee3efc9e99); superseded in iteration 6

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1
- [WARNING] a `.app` path opened without `-a`, `path.join`, and `executablePath()` run raw --> FIXED (ea246c2d8c)
- [WARNING] the rule demanded a mock keychain for the person's own Chrome, which would lose their logins --> FIXED (ea246c2d8c): scoped to test browsers, with controls showing the person's Chrome is left alone

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the open arm, from iteration 6)
- [WARNING] prose such as "we open Chromium" read as a launch --> FIXED (94503ac572): `-a`/`-b` or a rooted `.app` path required; prose controls added

#### Iteration 8 (the last under the cap)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [WARNING] `spawn('/usr/bin/open', [...])` was not caught (this repo calls it that way) --> FIXED (f40ec2b2be), not re-reviewed
- [WARNING] `$HOME/` and `~/` paths, where Playwright keeps the incident's browser --> FIXED (f40ec2b2be), not re-reviewed
- [NIT] the ignoreAllDefaultArgs comment wrongly called it Puppeteer's --> FIXED (f40ec2b2be)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 6 | WARNING | browser-launch-keychain-9254.test.js RUN_ARMS | SELF | the person's own Chrome was asked to use a mock keychain | FIXED | ea246c2d8c |
| 2 | 2 | WARNING | dropValues/unsafeDrop | SELF | loose value reading | FIXED | e133af3014 |
| 3 | 8 | WARNING | RUN_ARMS | BRANCH | /usr/bin/open argv, home paths | FIXED | f40ec2b2be (not re-reviewed) |

### NITs (non-blocking, across all iterations)
- A comment that names `ignoreDefaultArgs` fails the scan. This fails closed, deliberately, with a control.
- A Chrome path held only in a variable cannot be read. The header says so.

### Strengths (across all iterations)
- It fails closed on any value it cannot read.
- Every clause has a control, and reviewers' mutants turned the suite red.
- No false positives on the real repo, or on ordinary prose.
