# Plan: render-accounts-openai meets the Gemini choice (follow-up to #3874 / #3910)

Found and bisected by Renet Tilley (on #3874, 2026-09-26 04:31): since #3910 (c00ccac97) picking Gemini in
Settings, Add a provider asks "Sign in with Google / Use an API key" first where the subscription is offered,
and docs/browser-checks/render-accounts-openai.js waited for a key box one press away, timing out. It is not
in CI's browser-checks allowlist, so CI stayed green; my #3910 run did not include it through the runner.

## Finished looks like
render-accounts-openai passes through tools/browser-checks.sh on a Mac, and where the subscription is offered
it asserts the choice shows first with no key box, then presses Use an API key and checks the key step as before.

## Change
A `geminiToKey(report)` helper in the check: when #acct-gemini-flow is visible, (first time) assert the choice
and no key box, press Use an API key. Used at both Gemini picks. Where the subscription is not offered the old
path runs unchanged.

## Decided
- Walk through the real choice rather than stub /api/antigravity as "not offered" (what the three hermetic checks
  did): this check runs against a sandboxed board, so it should see what a Mac user sees.
- Every other check that picks Gemini in Settings was already covered in #3910 (grep of docs/browser-checks).
