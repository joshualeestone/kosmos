# First run: Gemini and Grok connect on the model step (kosmos#3658)

Josh, 2026-09-24 17:46 (#admin, with a screenshot of 0.6.92 staging): Gemini and Grok
should connect right on "Choose a model" with a gold button, like GPT's
subscription-or-API-key chooser; kill the "connect in Settings once setup is done" line;
kill "Runs on this computer" and show one uninterrupted list.

## Change (web/index.html only)
- Gemini and Grok rows are connectable (`.llm on`, Gemini's mark live) with a gold
  Connect (#fr-gemini-connect, #fr-grok-connect). The "After setup" pills, the
  #fr-later-models line, the #3566 scope comment and the "Runs on this computer"
  heading are gone: one list in PROVIDER_ORDER (#3651).
- One shared first-run key box (#fr-apikey-flow, #fr-apikey-msg), a mirror of
  Settings' #acct-apikey-flow: same ACCT_APIKEY_PROVIDERS (route, vendor, hint), same
  POST /api/accounts/{gemini|grok}/apikey. frApikeyOpen switches provider (clearing
  the other's key); a generation counter drops an answer that returns after a switch.
  Success closes the box, says so, and frPaintKeyed turns the row into a disabled
  Connected, read from /api/accounts (also on entering the step).

## Calls
- API KEY ONLY for now. The card: Grok's subscription follows Renet's #3391, Gemini's
  follows Angel's #3568, and "Don't show a subscription button that dead-ends." So
  Connect opens the key box directly, with no chooser, until a second path exists.
- NO RUNNER INSTALL. GPT's Connect installs its runner first; Gemini's and Grok's
  runners have no managed installer (engine/runners.js: "a later hardening"), and
  /api/runners does not report them. So a missing runner is said plainly from the
  key route's own needsRunner answer, with the way on ("connect later in Settings").
  Weakest premise: on a fresh computer that is the likely outcome for both, which
  makes Connect honest but not yet useful there. What would change it: a managed
  gemini/grok install, which is its own card.
- STEP ACTIONS UNCHANGED. Step 5's primary is "Next" only when Claude is connected,
  else "Skip connecting a model". Connecting GPT today leaves the same label, so
  Gemini/Grok match GPT. Noted on the card as a separate fix.
- "an xAI API key": the article follows the vendor (Settings still says "a xAI").

## Tests
- web.firstrun-model.test.js: 7 not-yet-available rows at .llm off, 4 connectable,
  Gemini's mark live, and the ABSENCE of "After setup" and the tier heading (so a
  stale branch cannot bring them back silently).
- web.gemini-grok-ui-3566.test.js: each row ends in a Connect wired to the key box;
  #fr-later-models is absent. Control kept: Llama still says Coming soon.
- render-firstrun-grok-3386.js: Grok is a connectable row right under Gemini, no
  divider, seven not-yet-available tiles.
- NEW render-firstrun-keyed-connect-3658.js (11 checks). Perturbations: no needsRunner
  branch reds the missing-runner arm; no repaint after Add reds the Connected arm.
