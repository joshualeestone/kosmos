# Plan: #3874, Settings Add a provider offers Gemini on a Google subscription

Filed by Angel while building #3568 (merged as #3897, d3cbdf03).

## Finished looks like
In Settings, AI Models, + Add a provider, picking Google Gemini on a computer where Gemini on a Google
subscription is offered (a Mac, runner not switched off) shows the choice Grok shows: Sign in with
Subscription / Use an API key. Sign in with Subscription runs the SAME check, install, open driver the
first-run Gemini row runs (POST /api/antigravity/check, /install, /open), in the dialog. Use an API key
goes to the existing key step, through the Gemini CLI download first when it is not installed. Where
the subscription is not offered (Windows, AGENT_WORKFORCE_ANTIGRAVITY=0) Gemini behaves exactly as today.

## Measured before building (main at d3cbdf03)
- Settings' Gemini goes straight to the key step (acctApikeyShow -> acctKeyedReveal('google')), or the
  Gemini CLI download first. There is no subscription path in Settings.
- The first-run driver FR_AGY_SUB is an object hard-wired to fr-gemini-sub-* ids, and its Ready branch
  paints first-run things (the row's Connected button, frActions Next).
- web.agy-on-3568.test.js runs the driver as written by slicing `let FR_AGY_READY` .. `const KEYED_SUB_START`.
- acctApikeyShow is on every open, close and provider switch path, and already resets Grok's flow
  (acctGrokShow(null)); a Gemini sibling there is reset on the same paths.

## Change
1. Turn FR_AGY_SUB into a factory agySubDriver(pre, onReady) in place (same region, so the #3568 test
   still runs it); FR_AGY_SUB = agySubDriver('fr-gemini-sub-', first-run ready painter); a Settings
   instance ACCT_AGY_SUB = agySubDriver('acct-gemini-sub-', no-op ready).
2. Markup: #acct-gemini-flow (choice + sub step) in the Add a provider dialog, mirroring Grok's and
   the first-run Gemini step's copy.
3. acctApikeyShow: for google, after the runner read, await agyAsk(); if keyedSubReady('google') show
   the Gemini choice, remembering whether the Gemini CLI still needs installing for the key path.
   acctGeminiShow(null) on every other path (open, close, switch) and leave() the driver.
4. Use an API key: the key step, or the install step first when needed. Stop this sign-in: back to
   the choice. The install box hides the Gemini flow like it hides Grok's.
5. Tests: a node test driving the Settings path against a stand-in page (offered / not offered /
   CLI missing then key), the factory's two instances not sharing state, and the #3568 tests still pass.

## Decided
- Reuse the driver, do not copy it (rejected: a second copy of an eight-round-reviewed state machine
  is where the two would drift).
- Settings Ready only says ready (no account row appears: an Antigravity sign-in is Google's, held by
  agy, and /api/accounts does not list it). Weakest premise: a person may expect a row in the account
  list afterwards. What would change it: Josh asking for one, which is #3568 PR 2 territory (status).

## Unmeasured
- Same as #3568: a signed-out agy's behaviour under the check and on a cold Terminal start. Needs the
  second, fresh Mac Mini.
