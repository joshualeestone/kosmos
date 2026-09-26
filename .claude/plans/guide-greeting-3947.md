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

## Rejected
- Serving the greeting to the page from the engine (a new API field): more surface than a pinned literal for one line.
- Leaving existing guides alone: the reported behaviour is from an existing guide, so the fix would not reach Josh.

## Weakest premise
- That the first-answer disclaimer came only from the instructions paragraph. The model may still add one on its own;
  only a served build with a real model can show it (the card's done-condition).

## Verification
- node --test engine/roles.test.js engine/setup-assistant.role-3734.test.js engine.setup-assistant-3034.test.js engine/create.test.js
- Browser checks render-assistant-bubble-3034 (B3) and render-assistant-hosted-3660 (H2), headless.
