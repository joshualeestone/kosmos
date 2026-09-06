# prompter-label-2301: fix the stale render-prompter-label-1843 Automation-headings check

## Problem
The 0.6.37 release cut red-aborted at step 3b: `docs/browser-checks/render-prompter-label-1843.js`
asserts the Automation section's headings are exactly `['Auto-save','Prompter','Agents talking to each
other']` (three), with a comment "Daily report (#2037) is not built yet". But #2301 (feedbackui-2037c)
shipped the Daily report automation (opt-in, default-ON), so the section now renders FOUR `h3.dlab`
headings. The product is correct; the check is a stale sibling #2301 did not update (same class as the
0.6.35 render-accounts-openai stale check).

## Fix (test-only)
- Update the executed assertion's expected array to the four shipped headings, in DOM order:
  `['Auto-save','Prompter','Agents talking to each other','Daily report']` (confirmed against
  web/index.html h3.dlab order).
- Update the stale inline comment and the top docstring to match (the inline comment records the prior
  claim rather than silently overwriting it).
- No product change; the assertion stays an exact, order-sensitive JSON.stringify equality over the
  live-rendered headings, so it remains non-vacuous and red-capable.

## Validation
This check runs only in the release cut's step 3b (Playwright page layer), not in CI's `test` job, so
it is validated by the next cut reaching a clean 3b. Two blind challenge reviews confirmed the expected
array matches the shipped page verbatim and in order, the "Daily report" heading is unconditional (so
the count does not flake), and no other assertion depends on the heading count.
