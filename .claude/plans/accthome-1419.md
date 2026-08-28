# #1419: unfreeze HOME in accounts.js

## The defect, both arms

`engine/accounts.js:43` resolved `HOME` once at require time, and 12 call sites read it. A caller that set `AGENT_WORKFORCE_HOME` **after** requiring the module read straight past the seam.

```
pre-fix,  set AFTER require   list() = 4   <- FOUR OF THE OPERATOR'S REAL ACCOUNTS, by real email
pre-fix,  set BEFORE require  list() = 2   <- the fixture
post-fix, set AFTER require   list() = 2
post-fix, set BEFORE require  list() = 2
```

Same call, opposite answers, decided by require order alone. This is #1412's shape: a module that is sandboxed *sometimes* is worse than one that never is, because the sandboxed half is the reassuring one.

## How I got the fixture right the second time

My first attempt (on the card) used a hand-built `.credentials.json`, which is **not** what this module recognises as an account, so the before-require arm returned 0 and the control proved nothing. I rebuilt it the way `accounts.test.js` builds one: a `.claude.json` carrying `oauthAccount.emailAddress` plus a `.claude-*` sibling.

⭐ **A fixture you invent encodes your belief about the input. The suite's own shape encodes what the code actually requires.**

## The change

`HOME` becomes `homeDir()`, called at all 12 sites. `HOME_FOR_TEST` is kept as a **lazy getter** so it cannot re-freeze what the function unfroze; four test files consume it and all 13 tests in `accounts.test.js` pass unchanged.

Same move as `openaiaccounts.js` in #1420, where Angel found this class.

## Verification

- `accounts.test.js` 13/13.
- Regression test added and **perturbed red** by reverting the file: exactly 1 failure, mine.
- The new test asserts by **shape** (`every(e => e.endsWith('@example.com'))`) rather than naming a real address, so it stays true on any operator's machine.

## What I expect to be wrong about

- **`HOME_FOR_TEST` changing from a value to a getter** is the riskiest part. No consumer observed a difference (13/13 plus `subscription.test.js`), but a consumer that captured it once and compared identity later would now see a fresh string each read.
- I did not audit whether any **product** path depends on the freeze as a performance property. `homeDir()` is two env reads; I judged that irrelevant and did not measure it.
- ⚠️ The full suite on this branch shows **1 unrelated failure**: `web.project-rows.test.js`, which is **already red on `origin/main`** (proven on a pristine `git archive` extract) from PR #1413 adding `max-width` to a CSS rule its test pins exactly. Not caused by this branch, reported separately.
