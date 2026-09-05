# #2254: emoji picker in the project composer (input side)

## Ask (Josh, 2026-09-05)
"Add a card so that the user could add emojis to their input." A Discord-style composer emoji picker.
Pairs with #2067 (which RENDERS emoji in dialogue); this is the INPUT side.

## Change (web/index.html + a browser-check)
- A button `#pj-emoji-btn` beside Post opens a panel `#pj-emoji` (curated ~80-emoji grid,
  `role="group"`). A pick inserts the glyph at the cursor in `#pj-post` and dispatches the `input`
  event, so the draft save and auto-grow (both bound to `input`) fire exactly as for a typed char.
- Insertion is on `click` (keyboard AND mouse; a single path, no double-insert). Panel stays open on
  pick; closes on Escape or an outside mousedown; Escape from inside restores focus to the trigger.
- Modeled on the @ picker (#312): button ~ `.attachbtn`, panel ~ `.mention` absolute positioning off
  the `.composer` ancestor.
- `docs/browser-checks/emoji-picker-2254.js` (10 arms) + README index entry (the pre-commit index gate
  requires it).

## Scope (v1, decided)
Project composer only (the agent-detail composer is a documented follow-up). Curated set, no
search/categories/skin-tones/recently-used. Deferred v1-acceptable a11y polish: emoji buttons sit
after Post in tab order; per-button aria-label duplicates the glyph.

## Verification
Browser-verified 10/10 via pw-runtime. Perturbation-verified: a no-op insert reds the insertion arm;
reverting click->mousedown reds the keyboard arm (mouse arm still passes = no double-insert). Two-round
challenge-loop.
