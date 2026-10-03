# agyscreens-4960: the Gemini sign-in asks Antigravity's terms in Kosmos's own panel

Card: kosmos#4960 (Josh, Mortals 0.7.16). The hidden Gemini (Google subscription) sign-in got through Google's code, then stopped on Antigravity's Terms screen ("a step Kosmos does not recognise"). Josh finished it by hand.

## Measured (card comment 5945018152; agy 1.2.12 on Agent1s in a throwaway home with a copied sign-in, Mortals runs 1.2.14)
- Mortals' board log: `agy sign-in: ended done at step terms`.
- The data-use box starts FOCUSED and TICKED (`  > [x] Yes, I agree ...`); Enter toggles it.
- Down moves to the buttons row, Previous selected: `  >  Previous       [Done]`.
- Right selects Done: `    [Previous]    >  Done `. The selected button loses its brackets and its `>` sits mid-line, so the old driver (a `>` at the start of the line, `[Done]`) never found Done and went stuck after 20 s.
- Links on the screen: https://antigravity.google/terms and https://policies.google.com/privacy.

## Done looks like
A person signing Gemini in through Kosmos sees Antigravity's terms in Kosmos's dialog (both links, the optional data-sharing box as Antigravity has it), chooses, presses Agree and continue, and the sign-in finishes with their choice applied. Kosmos never accepts the terms or ticks the box on their behalf.

## Change
- engine/agysignin.js
  - `termsOf(text)`: { dataUse, focus box|previous|done, sameRow, termsUrl, privacyUrl } from the measured frames (and agy 1.2.11's one-item-per-line layout). Links only https on google.com or antigravity.google.
  - On the terms with no answer yet: state `terms`, `status().terms` = { dataUse, termsUrl, privacyUrl }, no key, exempt from the same-screen stuck rule (it waits for the person; the 30-minute give-up still applies).
  - `agree(id, { dataUse })`: only for this sign-in, only on the terms, not once the window is shown, dataUse must be true or false.
  - After agree: Enter on the box only if it differs from the answer, Down to the buttons, Right to Done (Down where the buttons are on their own lines), Enter on Done. One key per change of the (box, focus) reading, at most 6 keys, then stuck. Never Enter on Done while the box differs from the answer (stuck instead).
  - A screen Kosmos does not recognise: `status().seen` (its first 6 lines, long tokens and e-mail addresses masked) and a log line.
- server.js: POST /api/antigravity/signin/agree (exact address; 409 for another sign-in, 400 otherwise).
- web/index.html: a terms row in both places that sign Gemini in (Settings `acct-gemini-sub-*`, first run `fr-gemini-sub-*`): the two links, a labelled checkbox set once per sign-in from Antigravity's state (a poll never overwrites the person's choice), Agree and continue. The setup sentence no longer says Kosmos leaves data sharing off (Antigravity ticks it; the person decides).
- test-support/fake-agy-signin.sh draws the terms as measured.

## Decisions
- Ask the person, not decide: the box is an opt-in to Google collecting their data, and Antigravity defaults it on. Rejected: untick it silently (Kosmos deciding a privacy choice, and the terms themselves still need the person's acceptance); rejected: press Done as drawn (opts them in).
- The checkbox starts as Antigravity has it (ticked), as Josh's card asks ("in its real current state, which the person can untick"). Weakest premise: a person who skims may leave it ticked; but that is Antigravity's own default, shown honestly with "Optional".
- Windows (win32agysignin) signs in differently and is not changed here.

## Validation
- engine/agysignin.test.js: 67 (6 new: the measured frames, waiting with no key, the no and yes paths key by key, refusals, the masked `seen`), and the real-tmux run against the fake agy (agree, then `terms:Enter, Down, Right, Enter`, datashare 0).
- server.runners.test.js: the agree route (400 off the terms, 409 for another sign-in, 405 for GET).
- web.agy-on-3568.test.js: the panel (links, box, focus, a poll does not overwrite the choice, the answer sent), and both places carry the row.
- Broad run: every web.* test plus agy/signin/runner tests and the file-scanning guards, 2732 run, 0 failed.
- docs/browser-checks/render-settings-agy-3874.js walks the terms step and shoots it (SHOT_DIR).
