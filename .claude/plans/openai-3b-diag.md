# Plan: fix two stale OpenAI-connect browser-checks that aborted the 0.6.37 cut at 3b

## Context
The 0.6.37 cut aborted at step-3b (attempt 3) on two OpenAI-connect browser-checks.
Splinter routed both to me (connect-flow browser lane; I fixed #2235's
render-accounts version). The harness-vs-product question was asked FIRST on both,
and both were reproduced before touching anything (bulletin
an-anchored-pattern-matches-the-line-you-imagined). NEITHER is a product regression.

## FAILURE 1 — render-accounts-openai:107 (DETERMINISTIC stale check)
- Assertion: "the add message names the chosen account, never the full key".
  Actual at 3b (and reproduced uncontested): "Checking the connection…".
- Cause: #2303 (gold-box the OpenAI connected state) changed the success UI. On
  success the flow sets #acct-openai-msg to a transient "Checking the connection…",
  runs a live paintAccounts() verification, then acctShowSuccess() HIDES the whole
  acct-openai-flow (including #acct-openai-msg) and shows a gold #acct-success-box
  ("OpenAI GPT Codex is connected" + the key TAIL). So the msg line's frozen last
  value is the transient, never "Added: <label>". The label moved to the account
  ROW (#2095's primary display). Discriminator: the account adds correctly (later
  group/row assertions PASS; the row shows "Walk Test … API key ending WALK Signed
  in"); only the line-107 msg assertion is stale.
- Fix (check, not product): re-point line 107 to the gold #acct-success-box with a
  proper settle-wait (waitForSelector) replacing the fixed 1200ms; KEEP the
  never-full-key security assertion (Splinter's flag #1); re-establish "names the
  chosen account, never the full key" on the account row.

## FAILURE 2 — render-create-form:256 [webkit] (CONTENTION flake, not deterministic)
- Assertion: "choosing OpenAI parks the model menu with words". At 3b the webkit
  read #create-model-why empty. Reproduced uncontested: PASSES on BOTH engines
  (why = "Once this account is signed in, you can pick its model here…").
- Cause: #2140's per-account model picker. paintOpenaiCreateModel clears
  #create-model-why to '' (loading state) and sets the note synchronously in the
  no-account branch or AFTER an async models fetch when an account is selected. The
  check read the note synchronously right after the provider change, racing the
  populate; under the cut machine's load the webkit read caught '' (green alone ==
  contention, per the gate's own #704 note). Not a product regression.
- Fix (check, not product): a bounded settle-wait for #create-model-why to be
  non-empty before reading (Splinter's flag #2). Can't make it worse (only adds a
  wait); de-flakes the race so it cannot abort the re-cut.

## Verified
Reproduced both (one run: F1 red, F2 green-both-engines), applied fixes, re-ran the
full browser gate: 3b CLEAN — render-accounts-openai PASS (gold box + row-names-label
+ never-full-key), render-create-form PASS on chromium AND webkit. No FAILED verdict.

## Weakest premise
FAILURE 2 could not be reproduced red (it passes uncontested), so the settle-wait is
a hardening against the plausible mechanism (racing the async why-populate) rather
than a fix verified against a reproduced red. It is safe (additive wait) and directly
addresses the race; if the cut's re-3b still flakes on it under load, the next step is
to assert the #2140 loading/listable states explicitly rather than the note text.

## Sequencing (Splinter's ruling)
Baron re-cuts by resetting to origin/main, so these fixes must be ON MAIN before the
re-cut. This branch merges to origin/main first; only then is 3b-clean reported.
