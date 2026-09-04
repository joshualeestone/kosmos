# Plan: OpenAI-only first-run model step must offer Continue (kosmos#2134)

## Bug (Josh live OpenAI-only test, 2026-09-04, via Splinter)
First-run wizard MODEL step (step 3): with OpenAI connected and Claude not, there
is NO Continue button - only "Skip connecting a model." The user cannot proceed
past the model step except by "skipping" the model they just connected.

## Cause
Step 3 Continue is set ONLY in frPaintSubscription()'s Claude-`connected` arm
(web/index.html:35266). Every other arm (incl. OpenAI-only) falls through to
`frActions(null, {label:'Skip connecting a model'})` (35314), which hides Continue.
frPaintOpenai() paints the OpenAI row but never touches the action buttons - the
Continue predicate is blind to OpenAI.

## Fix
In frPaintOpenai()'s connected block: when OpenAI is connected AND Claude is not
already offering Continue (FR.subscription.state !== 'connected'), call
`frActions({label:'Continue', go:()=>frGo(4)}, null)`. This paint runs AFTER
frPaintSubscription's, so it overrides the Skip; the null alt hides Skip. If Claude
is connected, leave its actions alone (it already offers Continue). Resolves the
"Skip connecting a model" mislabel too (a connected OpenAI user sees Continue).

Deliberately NOT keyed on frRecheck: frRecheck re-checks only Claude and repaints
only frPaintSubscription (web/index.html:34077), so using it as the alt would
revert Continue to Skip.

## Tests
web.firstrun-model.test.js: the connected-path frPaintOpenai runs (told-directly
+ asked-the-machine) now inject FR/frActions/frGo stubs and assert Continue is the
offered primary action. All 14 pass.

## Scope / boundaries
Finding #1 of Josh's OpenAI-only cluster. Global-gate sibling is #2128 (Pete).
I own PROVIDER-CONNECTED gating; a11y-permission Continue-gate is Angel's (#2125);
name step is Mona Lisa's. This change touches only frPaintOpenai (step 3 OpenAI
row + its Continue offer) - none of those regions.

## Weakest premise / verify
That "a connected OpenAI account" is sufficient to proceed past the model step.
It is: the model step's purpose is to connect a usable model provider, and OpenAI
is first-class (#2096). frGo(4) advances to step 4 (the "This computer" machine
check), exactly as the sibling Skip and the Claude Continue do. 🔴 Needs
live verify on a real OpenAI-only machine (Josh or a fresh codex account) - flagged
to Splinter to batch.

## Remaining cluster (separate, NOT in this PR)
- Finding #3/#7: agents-create default should flip to OpenAI reliably (timing:
  #2097 defaults to openai but the first paint runs while CREATE_ACCOUNTS is []),
  gray out Anthropic when no Claude account, and add a "You can add additional
  providers in settings" note. That is net-new UI on the create-agent form.
