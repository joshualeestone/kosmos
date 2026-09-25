# #3391 part 2: Grok subscription sign-in UI, and signing a lapsed one in again

Routed by Splinter 2026-09-24 18:37 after Renet's engine (#3661) merged: Settings UI that
starts a Grok subscription sign-in, the same chooser on first run's Grok row (#3658), and
signing a lapsed subscription back in from the app.

## Engine (engine/grokaccounts.js, server.js)
- startGrokLogin({ reauthDir }): the openaiaccounts #2584 shape. reauthTarget accepts only
  ~/.grok or ~/.grok-* holding a subscription sign-in with an email (a key row, a dir
  elsewhere, or no email is refused). The sign-in runs in a fresh staging slot; on exit 0
  the new auth.json is renamed over the live one ONLY if its email equals the live one's.
  The live dir is held (activeGrokDirs) for the life of the sign-in and is never in a
  cleanup path; the staging slot is always cleaned.
- The start route passes body.reauthDir (a non-string is a 400).
- create.js's expired message now names Sign in again instead of "cannot sign in yet".

## UI (web/index.html)
- grokSubDriver: one driver for both places (start / poll status / cancel), gen-guarded so
  a late answer after a close, switch or Stop changes nothing; leaving cancels on the engine.
- Settings: picking Grok shows a subscription-or-key choice (#acct-grok-flow); a Grok
  subscription row gets Sign in again (data-grok-reauth -> openAcctReauthGrok), which lands
  straight on the sign-in. openAcctAdd clears ACCT_GROK_REAUTH_DIR.
- First run: #fr-grok-sub inside the shared key box, Grok only.

## Decisions
- Sign in again is offered on every Grok subscription row, not only lapsed ones: the same
  rule OpenAI ChatGPT rows follow, and "lapsed" is judged offline and can be wrong.
- Leaving a sign-in cancels it on the engine (OpenAI's Settings flow only drops it locally):
  grok holds its slot for a five-minute watchdog otherwise.
- The expired-pill text stays short ("Grok sign-in expired"); the remedy is the button.
- Rejected: a Gemini subscription option (no engine; #3568 is the open card).

## Tests
- engine/grokaccounts.reauth-3391.test.js (5): same email replaces, different email leaves
  the live file byte for byte, fail/noauth/cancel never touch it, default ~/.grok works,
  reauthTarget refusals. Perturbed: no email check, staging kept, live not held, target
  check removed, each red.
- server.grok-subscription-3391.test.js: reauthDir through the route; bad reauthDir 400.
- docs/browser-checks/render-grok-subscription-3391.js (21 checks), 9 web perturbations red.
- render-account-badge-1921: every row asserts the Grok Sign in again is present exactly on
  Grok subscription rows; a Grok KEY row fixture added so that arm can fail.

## Review pass 1 (opus): no blockers, 3 warnings, fixed
- First run's sign-in outlived leaving the step (OpenAI's aborts on FR_STEP !== 5): the
  driver takes `alive()`, first run passes FR_STEP === 5, a poll that finds it false ends
  the sign-in on the engine.
- The poll wrote into the shared key-box line and wiped the key's answer: #fr-grok-sub-msg.
- Focus fell to the body when Sign in went disabled: Stop takes it; when the sign-in ends
  with Stop or the link focused, it goes back to Sign in with Grok.
- NIT fixed: no Sign in again on a subscription row without an email (the engine refuses it).
- CONVENTION fixed: reauthTarget refuses a symlinked account dir.
- NIT fixed: the email match ignores capitals.
- NIT, comment only: the rename replaces the whole auth.json, as a fresh `grok login` would
  and as openaiaccounts #2584 does.
- Recorded, not changed: a retry within the 3s force-kill window after a timeout is refused
  as "already in progress"; a status poll answering a non-404 error keeps polling (both the
  same as the OpenAI flow).
- Arms added: switch provider mid-sign-in, a start answered after close, leaving first
  run's step, the two lines, focus both ways, emailless row, watchdog and failed-rename on
  the engine, symlink, capitals. Each new fix perturbed red.

## Review pass 2 (sonnet): no blockers, 1 warning, fixed
- [WARNING] engine/create.js still said Kosmos cannot sign in to Grok again and that a default
  ~/.grok has no way back, three lines above the sentence this branch changed: rewritten. A
  sweep of engine/, web/, server.js and the browser checks found no other copy.
- [NIT] the expired sentence would be wrong for a Gemini sign-in if one ever existed: noted in
  the same comment (only authMode 'subscription' reaches it, which only Grok has).

## Review pass 3 (opus): no blockers, 1 warning, fixed
- [WARNING] a NEW sign-in as someone who already has an account here made a second account
  with the same email; first run leads there (a lapsed ~/.grok shows Connect). Now the engine
  moves the new sign-in into that account (sameAccountFor + promoteReauth) when exactly one
  subscription account has the email and nothing else is signing it in; two matches or a held
  match leave the new slot, rather than guessing. Arms: merge, two matches, held; each perturbed red.
  OpenAI's new sign-in has the same gap; not changed here (its own flow and tests).
- [NIT] fixed: the expired sentence names Sign in again only when the account has an email;
  otherwise it says Disconnect and sign in with Add a provider.
- [NIT] fixed: onConnected is guarded; a repaint that throws says so instead of "Checking".
- [NIT] fixed: first run's Grok box focuses its sign-in, the first thing in it.
- Recorded, not changed: the choice is one-way per visit (after picking the sign-in, the key is
  reached by picking another provider and Grok again, or reopening), the same as OpenAI's
  chooser; a Stop followed at once by a new sign-in again can be refused for a moment while
  grok exits ("already in progress", honest and transient); status 404 and a cancelled state
  in Settings are handled by the same finish() path the Stop and error arms cover.

## Review pass 4 (sonnet): 1 blocker, 2 warnings, fixed
- [BLOCKER] a lapsed DEFAULT ~/.grok without an email was told to Disconnect it, but a
  default keyed row has no Disconnect (and without an email no Sign in again): the sentence
  for that case now says to sign in with Add a provider and choose that account.
- [WARNING] a same-email merge whose rename failed threw away the sign-in just finished: it
  now stays as its own account (the behaviour before the merge existed). The explicit Sign in
  again keeps its error, since there the person asked to update that account.
- [WARNING] a typed name was dropped on merge: a named sign-in is never merged (the person
  asked for a separate account). No UI sends a name today; the engine contract stays honest.
- Arms for all three, each perturbed red.
