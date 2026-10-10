---
method: challenge-loop
branch: eventually-5727-signin
diff_hash: 36ac16fe147cad3032b94639fba833410b0492894a87359100d8b4f3c735cb0f
validation: passed
subdir_audit: passed
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-signin (#5727 follow-up 1, batch 1)

Batch 1 of the follow-up that migrates the remaining (c) poll-until-deadline copies onto the
shared `eventually()` helper from PR-1 (#5738). This batch: the three provider sign-in status
polls in `engine/`, the direct analog of the two openaiaccounts files PR-1 already migrated.

## Validation

The three changed files were run directly (`unset KOSMOS_AGENT_TOKEN && node --test <the 3
files>`) on the committed HEAD 2c24f0954, on Mortals (12 cores, 1-min load ~8.8):
- scale 1 (the byte-identical path): 54 tests, 54 pass, 0 fail, 0 cancelled, exit 0.
- forced KOSMOS_TEST_TIME_SCALE=2.5 (stretched budgets): 54 tests, 54 pass, 0 fail, 0
  cancelled, exit 0.

A full local suite was NOT re-run for this batch: the diff touches only three test files, no
runner or helper code, and every migrated budget is byte-identical at scale 1 (the scale the
runner computes on a quiet box, and the scale CI runs at), so suite-scale behaviour is
unchanged from main. CI re-runs the whole suite on the PR head and is the authoritative
green-by-name gate for merge.

counts-before-and-after (the byte-identical check):
- Before: grokaccounts.reauth-3391, grokaccounts.subscription-3391 each had 1 hand-rolled
  `waitFor` with 1 `Date.now()` deadline compare; openaiaccounts.devicecode-3436 had 1
  `waitFor` deadline plus 1 unrelated elapsed-time string in a failure message (2 total).
- After: 0 hand-rolled poll deadlines in the `waitFor` helpers; 1 `eventually()` call and 1
  `eventually` require per file; devicecode keeps its 1 unrelated `Date.now()` message compose
  and its `readArgs` file-parse retry untouched.

SUBDIR AUDIT: passed (no CLAUDE.md under engine/ or test-support/, so no subdir convention
file needed updating; the diff adds no new directory).

The diff_hash above is computed as the pre-challenge-gate hook recomputes it:
`git diff origin/main...HEAD` excluding this proof file, `shasum -a 256`.

## Challenge-loop ledger (1 blind pass)

### Iteration 1 (Sonnet, blind)
No [BLOCKER], no [CONVENTION], no actionable [WARNING] (the one [WARNING] line was a clean
result: the reviewer found no caller that depends on `waitFor` rejecting vs resolving, or on
timing). The reviewer read `test-support/eventually.js` and all three diffs in full and ran the
three files green (54/54). It independently confirmed the load-bearing properties:
- grok `waitFor(pred, ms=15000)`: 15000ms default, 25ms step and probe-first order preserved;
  `Date.now() - start > budget` (strict, scale-1 budget === ms) equals the old `Date.now() >
  until`; `eventually(pred, (v) => v, ...)` returns the first truthy `pred()` value and
  propagates a sync throw from `pred()` exactly as the old `reject(e)` did; `(v) => v` treats a
  0/''/false result as not-ready, same as the old `if (v)`.
- devicecode `waitFor(sessionId, pred, ms=8000)`: probe `chatgptLoginStatus(sessionId)`,
  predicate, 8000ms default, 25ms step, and returned value all preserved; the old `timeout;
  last <status>` detail is reproduced through `describe`.
- No assertion depends on a migrated helper's throw text: the only `/timed out/` matches are
  `assert.match(s.error, /timed out/)` and `assert.equal(m.error, 'the OpenAI sign-in timed
  out')`, all reading the PRODUCT's status/error, never the helper's throw. The old grok throw
  text `'timed out waiting'` is matched nowhere.
- `../test-support/eventually` resolves from engine/; `readArgs` is untouched and still rethrows
  its underlying parse error (correctly left unmigrated).

Two [NIT]s, both documented, no change:
- [NIT] `eventually` does `await probe()`, so a predicate that RETURNED A PROMISE would be
  awaited/unwrapped by the new code where the old sync `if (pred())` treated the promise object
  as immediately truthy. Every grok caller passes a SYNC predicate (verified), so there is no
  behavioural change today; awaiting the probe is `eventually`'s intended async-probe support.
- [NIT] the helper's timeout MESSAGE differs from the old `'timed out waiting'` / `timeout;
  last ...`. Nothing asserts on either (see above), and the richer message names the scale.

## Convergence
One blind pass, zero [BLOCKER]/[CONVENTION] and no actionable [WARNING]; the two NITs are
harmless and documented, needing no code change. A single mechanical, byte-identical migration
that the reviewer verified line by line against the helper converges on the first pass (6d). No
code changed after the pass, so the diff_hash above is final.

## Origin classification
Every change is BRANCH-origin: the three `waitFor` wrappers, the three `eventually` requires,
and the plan. No other file is touched.
