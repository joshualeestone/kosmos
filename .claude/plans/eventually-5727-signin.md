# Plan: eventually-5727-signin (#5727 follow-up 1, batch 1)

## Scope (Liu m4885)
Follow-up 1 of #5727 migrates the remaining ~86 hand-rolled (c) poll-until-deadline copies
onto the shared `eventually()` helper (landed in PR-1 #5738), in per-directory batches,
seen-red first, one PR per batch, each byte-identical at scale 1, small enough for Sonya to
read in one sitting.

Batch 1 = the provider sign-in status polls in `engine/`, the direct analog of the two
openaiaccounts files PR-1 already migrated. Three files, three `waitFor` helpers:
- `engine/grokaccounts.reauth-3391.test.js` -- `waitFor(pred, ms=15000)` (25ms step).
- `engine/grokaccounts.subscription-3391.test.js` -- byte-identical `waitFor(pred, ms=15000)`.
- `engine/openaiaccounts.devicecode-3436.test.js` -- `waitFor(sessionId, pred, ms=8000)`,
  the same shape as the two already migrated.

## Change
Each local `waitFor` loop becomes a thin wrapper over `eventually()`, preserving its
signature, its default timeout, its 25ms step, and its first-probe-before-deadline order.
At scale 1 `Date.now() > start + ms` is exactly `eventually`'s `Date.now() - start > budget`,
so behaviour (when it resolves, when it fails, what it returns) is identical; only the throw
TEXT changes to `eventually`'s richer form, and no test asserts on the old text (verified:
the `/timed out/` asserts in the grok files are on the product's `grokLoginStatus().error`,
not the helper's throw; devicecode's old `timeout; last <status>` detail is preserved via
`describe`). The grok `waitFor` caught a thrown `pred()` and rejected; `eventually` awaits the
probe so a throw propagates the same way.

## Deliberately NOT migrated
`engine/openaiaccounts.devicecode-3436.test.js`'s second helper `readArgs` is a count-bounded
(200 x 25ms) file-parse retry that RETHROWS the underlying parse error on exhaustion.
`eventually` throws its own generic timeout, so migrating it would not be byte-identical and
would lose the parse-error diagnostic. Left as-is; a later PR can revisit it if wanted.

## counts-before-and-after (the byte-identical check)
Before: each file had 1 hand-rolled `waitFor` with a wall-clock deadline (grok: one
`Date.now()` compare each; devicecode: the `Date.now() - start > ms` in `waitFor` plus one
unrelated elapsed-time string in a failure message).
After: 0 hand-rolled poll deadlines in the `waitFor` helpers, 1 `eventually()` call per file,
1 `eventually` require per file; devicecode keeps its one unrelated `Date.now()` message
compose and `readArgs` untouched.

## What "done" looks like
- The three files pass at scale 1 (byte-identical) and at a forced scale (budgets stretch).
- No assertion depends on a migrated helper's throw text.
- Whole suite green on CI by name; Sonya reviews (one directory, small).

## Weakest part (named)
The throw-text change. Mitigated by grepping every migrated helper's old message and
confirming no assertion reads it; the `/timed out/` matches are product error text. If a
future test began asserting on a helper's throw text, that would surface as a red, not a
silent pass.
