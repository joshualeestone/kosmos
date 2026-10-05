---
pre_challenge: true
method: challenge-loop
branch: settingsends-5168
diff_hash: 9674f5988c68a92481bb42f6e27fdc1bf7a30e4c42e5ba9d3f9a9795ed8a0edb
validation: passed
subdir_audit: passed
timestamp: 2026-10-05T21:04:31Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (Angel, 10-03 18:40, card comment on #5168)
**Converged:** Yes (Angel: CLEAN, no BLOCKER or WARNING)
**Total findings:** 1 NIT (fixed) | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation on the exact head f8acbe5ff:
- Full validation on Mortals through validation-log: 15056 tests, 14832 pass, 0 fail, 0 cancelled, ENTRY status clean
  (a real run), hash 9674f5988c68, matching this proof.
- FULL browser checks (web/ and server.js changed) on Agent1s at f8acbe5ff: all page checks passed, EXIT=0.

### Per-Iteration Breakdown

#### Iteration 1 (Angel, at 5f647dc10, stacked on #5164)
- No BLOCKER or WARNING. Checked: one keychain read gives both dates and is cached with the row's login generation
  (a sign-in still invalidates it, #5018); worksUntil reads only that cache, never the keychain (the test asserts no
  extra read) and fails soft to the old badge; it never outranks a rejection or a sign-out; the page's clock decides;
  the tests pin the live case and the controls, including the 0 a failed refresh writes.
- [NIT] the "stops at" line depends on validUntilWithin having run for that row earlier in the same /api/accounts
  request; say so at the call site --> FIXED in 19a17e266.
- Later commits change no behaviour: f257f8f84 (a measured surface-gate note) and f8acbe5ff (a trailer's .js).

## Merging onto newer main without a re-run (Splinter's 19:29 ruling)
1. Merge-tree of f8acbe5ff onto current main (261 commits ahead): 0 conflicts.
2. Overlap: main changed two files this PR touches, server.js and web/index.html. None of main's changes names this
   PR's symbols (loginStopsAt, claudeloginlive, acct-stopsat, acct-unverified, paintAccounts), none falls near either
   hunk (server.js about line 9473, the accounts route; web/index.html about 25610, paintAccounts), and main adds no
   rule on .acct-stopsat or .acct-unverified. engine/claudeloginlive.js and its test are untouched on main.
3. The runs were real: status clean, 15056 tests; browser checks all passed.
4. Backstop: the main canary. If it goes red on anything this PR touches, I revert first.
