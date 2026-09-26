# guide-greeting-3947: the guide opens with Josh's words, and answers without an AI note

Card: joshualeestone/kosmos#3947 (Josh, #admin, 2026-09-26 07:41 CDT).

## What Josh asked for
1. Opening message, verbatim: "Hi I'm Josh, an AI Assistant to help you get your Kosmos setup. What can I help you with?"
2. The first real answer must not begin "quick note first: I'm the AI guide inside Kosmos, not a person typing live".
3. Title stays "Josh, Kosmos Guide".
4. Tests and browser checks that assert the old greeting or the disclaimer rule are updated; the Windows build uses the same strings.

## Decisions
- ONE copy of the greeting: `roles.GUIDE_GREETING`. The role's `firstAction` (served, no UI reader) is it. The bubble
  (`web/index.html`, `asbOpening`) cannot require engine code, so it holds a literal copy; `engine/roles.test.js`
  extracts that literal and asserts it equals `GUIDE_GREETING` (perturbed: red).
- Josh's text kept verbatim ("Hi I'm" with no comma, "setup" as one word), as the card asks. Question noted on the card.
- The guide's "Who you are" paragraph drops "you say so the first time you talk to someone and whenever they seem to
  think otherwise". It keeps honesty when asked directly and never claiming to be the real person (card: being
  honest when asked is not the same as volunteering a disclaimer).
- Existing guides: their instructions file was written at creation with the old paragraph, and Josh's screenshot is
  one of those. `refreshGuideRole` (already run once at board start for #3734) gains a second swap that replaces the
  old paragraph, only where it is still word for word, in the marked guide folder only. One write for both swaps.
- `GUIDE_TAG` ("Josh's AI") kept: it still names the guide's purpose line in setup-assistant.js; its comment no longer
  claims the opening line is built from it.
- Windows: builds from this same repo and serves the same `web/index.html` and `engine/roles.js`; no second copy.

- "whenever they seem to think otherwise" dropped deliberately: Josh, same message, "I dont really care if people
  think its a live person or not". Honest-when-asked-directly kept (the card's own line).
- The HOSTED guide (before a model is connected) runs on kosmos-relay `coordinator/prompts/setup-assistant.md`, a second
  copy of the rule; it gets the same change on relay branch guide-greeting-3947 (separate PR, relay deploy).

## Item 5 (Josh, 2026-09-26 08:13, added to the card)
"If I click on the assistant and hit the X on him and haven't typed a message, and I do that twice, then it should
prompt me to close the agent forever."
- The setup-assistant setting gains `idleCloses` (a whole number, 0..100) and `kept` (boolean), validated by the type
  of each default; the server settings test and the SETTING unit tests pin the new shape.
- Page: an opening that ends in X with nothing sent (the existing asbDidNothing rule) is counted in the board's
  settings, so it survives a restart. The second offers "Hide the guide for good?" (Hide it / Keep it, "You can bring
  it back in Settings > Computer"). Hide it = the existing forever-off switch (on:false). Keep it = kept:true, never
  offered again. A sent message sets the count to 0. The very first X keeps its one-time Close for now / Close forever
  question; answering "Close for now" on an idle opening counts as the first.
- This REPLACES the 09-25 rule that asked on every idle close (Josh's 08:13 ruling is newer).
- Browser check B7c rewritten: first idle close counts and just closes; second offers; Keep it; Hide it; a send
  resets. Threshold and send-reset each perturbed: red.
- Settings saves from the page go one at a time, in order, so what the board keeps matches the page (review:
  absolute patches racing on the wire). After Keep it nothing is counted. X on the offer is "not now": it closes,
  the board keeps the count before it, so the next idle close offers again (deliberate: they answered neither).
  Escape folds without counting (Josh's words are about the X; reversible if keyboard users should count too).
- Decided: "Keep it" never asks again (the card allowed "or at most much later"); simplest, and the Settings switch
  still turns it off. Weakest premise: that Josh did not see the old every-idle-close ask; if he did and still wants
  this, the count is what he asked for either way.

## Rejected
- Serving the greeting to the page from the engine (a new API field): more surface than a pinned literal for one line.
- Leaving existing guides alone: the reported behaviour is from an existing guide, so the fix would not reach Josh.

## Weakest premise
- That the first-answer disclaimer came only from the instructions paragraph. The model may still add one on its own;
  only a served build with a real model can show it (the card's done-condition).

## Verification
- node --test engine/roles.test.js engine/setup-assistant.role-3734.test.js engine.setup-assistant-3034.test.js engine/create.test.js
- Browser checks render-assistant-bubble-3034 (B3) and render-assistant-hosted-3660 (H2), headless.
