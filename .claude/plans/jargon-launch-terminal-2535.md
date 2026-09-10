# Plan - #2535: agent-page jargon ("launch file" + "the Terminal question")

**Card:** joshualeestone/kosmos#2535 (claimed:monalisa, my self-directed copy finding). Copy-only.

## The finding
Kosmos targets a non-technical person, but two agent-page strings use undefined technical jargon:
1. **"launch file"** appears in the Model-tab refusal, the Claude picker admission, and the
   run-state ("drun") explainer. A non-technical reader has no idea what a launch file is or why
   its absence blocks changing the model.
2. **"the Terminal question"** in the Terminal-tab `#d-trust-restart-hint` assumes the reader has
   seen a macOS folder/Terminal permission prompt.

## The fix (web/index.html, copy only)
- Replace "launch file" with plain cause-language ("how this agent starts" / "how it runs") in the
  four user-facing strings:
  - the OpenAI Model-tab refusal ("...no launch file... no model to change here" -> "...did not
    record how this agent starts, so there is no model to change here");
  - the Claude picker admission ("Made before Kosmos recorded how it starts, so there is no launch
    file to change" -> "...so its model cannot change here");
  - the drun recorded-folder line ("...but has no launch file for it" -> "...but did not record how
    it starts"; "will not write one" -> "will not record that"; "re-records one yet" -> "re-record
    that yet");
  - the drun running-migration line ("will not write a launch file while it runs some other way" ->
    "will not record how it starts while it runs some other way").
- Gloss the Terminal hint: "...without the Terminal question." -> "...without the macOS permission
  prompt each time."
- Re-anchor the five copy pins in `web.made-before.test.js` to the new phrasing (update the literal
  text; the count-of-two and the two region-scoped checks are preserved, not weakened).
- Update the ONE browser-check that pins this copy: `docs/browser-checks/render-made-before.js:112`
  (`/no launch file to change/` -> `/its model cannot change here/`). This check is not in the PR's
  CI allowlist but runs in the full 63-check suite at release-cut step 3b, so leaving it stale would
  red the 0.6.56 cut (the stale-render-check failure mode). It is the reason the plan should say the
  Terminal-hint string has no pin but the picker admission DOES.

## Decisions (made, per the never-idle ruling) + weakest premise
- **Keep the "Trust & Restart" button label.** The card flagged both the button and the hint, but
  "Trust & Restart" is used across the app (e.g. the needs-you recovery box), so renaming the button
  ripples widely and risks other pins; glossing the hint resolves the "what question?" confusion at
  the point of the hint. **Weakest premise:** Josh may want the button itself renamed too - if so, it
  is a separate, app-wide label decision, not a one-line hint fix.
- **Leave code comments that mention "launch file".** They describe the internal launch-config
  concept for a code reader; the card is about USER-FACING clarity only.
- **Excluded per the card (do NOT change):** Remove vs Delete (deliberately two verbs, clear labels)
  and "Instructions" (an explicit code rule avoids naming the underlying file). The
  session/context/Compact jargon family is noted on #2526, not re-carded here.

## Verification
- Full node suite green (5739 pass / 0 fail) on the clean committed tree.
- Both browser-check gates green (Browser-check trailer; copy-only, no rendered-surface change).
- web.made-before.test.js re-anchored and passing (its pins are the regression guard for this copy).
