# discover-adopt-3519 - adopt path classifies Gemini/Grok folders

Card: joshualeestone/kosmos #3519

## Problem
`discover.connect()` (the adopt/"connect an existing folder" path) maps a folder's
brief file to a runner with a hardcoded two-entry loop:
`[['CLAUDE.md', null], ['AGENTS.md', 'codex']]`. Two defects now that installJob
supports gemini/grok (merged #3526):
- **GEMINI.md is not recognized at all.** `foundGemini` already OFFERS GEMINI.md
  folders as agents (runner 'gemini'), but connect() reads only CLAUDE.md/AGENTS.md,
  so clicking an offered gemini row is refused "no instructions in it" (or, with a
  typed name, downgraded to a nameplate card with no gemini job). This is the #1159
  lie one provider over, and it is REACHABLE from the UI today.
- **AGENTS.md is hardcoded to codex, but grok reads AGENTS.md too**
  (`create.briefFilename` puts codex and grok on the same arm), so a grok folder is
  misclassified as codex.

## The one thing disk cannot decide
An AGENTS.md-only folder is genuinely ambiguous between codex (OpenAI) and grok
(xAI). There is no content marker, no sibling file, no provider hint written into the
folder; `foundCodex` itself just calls every AGENTS.md hit 'codex'. It is NOT
guessable from the folder. So the grok half cannot be "classified" from disk - it
needs the caller to say which.

## Decision (implemented)
1. **Gemini: full fix.** Add `['GEMINI.md', 'gemini']` to the classification loop
   (precedence CLAUDE.md > AGENTS.md > GEMINI.md, matching found()'s dedup order) and
   record `provider: 'google'`. Reachable, definite, closes the "cannot recognize a
   gemini folder at all" half.
2. **Grok: disambiguate via an explicit caller provider.** connect() honors
   `opts.provider`, but ONLY when the runner it names boots from the brief file
   actually on disk (`create.briefFilename(hinted) === instructionsFile`) - so a
   `xai` hint on an AGENTS.md folder adopts grok, while a `google` hint on the same
   folder is ignored (a hint can correct codex<->grok, never claim an absent file).
   Absent a hint the codex default stands (matches foundCodex). Threaded `body.provider`
   through the `POST /api/agents` connect route so it is reachable end to end.
3. **Provider write generalized.** The `runner === 'codex' ? {provider:'openai'} : {}`
   ternary became `runner ? {provider: create.runnerProvider(runner)} : {}`. Added and
   exported `create.runnerProvider` - the inverse of the existing `providerRunner`, the
   ONE runner->provider map (Convention #5), so a gemini/grok adoption records its
   provider instead of falling through and being mislabelled claude by the board.

## What I rejected
- **Reading the rollout `model_provider` to auto-detect grok.** It lives in
  `~/.codex` rollouts, not the adopted folder, and connect() works purely from the
  folder; wiring a rollout lookup into the adopt path is a larger, separate change and
  still would not cover a grok folder with no rollout. Rejected as out of scope.
- **Building a `foundGrok` discovery path** so grok folders are OFFERED for adoption.
  Legitimate follow-up, but it is a DISCOVERY feature, not the CLASSIFICATION bug this
  card names; noted on the card as a separate follow-up.
- **Guessing grok from AGENTS.md.** Impossible from disk; guessing would start the
  wrong provider's account. The explicit-hint path is the honest alternative.

## Weakest premise
No current UI screen sends `body.provider` for adoption (there is no grok picker),
so the grok half is a correct-when-called capability rather than an active UI flow
today. It is wired end to end and unit-tested; a foundGrok/provider-picker follow-up
makes it user-reachable. The gemini half, which IS reachable now, is fully fixed. If
that premise is wrong (a caller does pass provider), the code already honors it.

## Files
- engine/create.js - add + export `runnerProvider`
- engine/discover.js - GEMINI.md in the loop, provider-hint disambiguation, provider write
- server.js - thread `body.provider` into `discover.connect`
- engine/discover.adopt.test.js - gemini adopt, grok-by-hint, two controls, gemini/grok bin seams
- engine/create.setprovider-google-xai-3296.test.js - runnerProvider inverse + round-trip
