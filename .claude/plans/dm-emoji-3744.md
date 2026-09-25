# #3744: emoji picker in the agent Direct Message composer

Josh, 2026-09-25 09:29 in #admin: "We need emoji support in the agent DM." Filed by Splinter.

## What
- The DM composer (`.dmbar.composerbox`, agent page) gets the room's grey smiley (`#d-emoji-btn`,
  `.emojibtn`, the #2357 muted glyph) and panel (`#d-emoji`, `.emojipanel`), inside its own box, which
  is made `position: relative` so the panel opens just above it, as the room's opens above `.composer`.
- ONE picker for both composers: `EMOJI_AT` maps each place (room, agent) to its button, panel and
  input; pjEmojiBuild / Open / Close / Toggle / Insert take `where`, defaulting to the room, so every
  existing caller is unchanged. One list (PJ_EMOJI), built lazily per panel. Opening one closes the
  other. Escape and the outside-mousedown close cover both. The screen tip's Escape guard (pickerOpen)
  names `#d-emoji` too.
- The smiley greys and the panel closes with the box: both places paintTalk disables `#d-say` (the
  cannot-resolve arm and `body.presence === 'off'`) set `#d-emoji-btn.disabled` the same way, and
  pjEmojiInsert refuses a disabled input.

## Decisions
- Position: beside Post, as in the room (the card says "beside +"; the card also says reuse the room's
  component, and the room's smiley sits beside Post). Reversible in one move of the element.
- No second copy of the list and no new picker component (the #2834 shared-picker precedent).

## Weakest premise
- The DM's box is the panel's anchor; a very short window could put the panel's top off screen. The
  check asserts it is inside a 1200x900 window only.

## Tests
- docs/browser-checks/render-dm-emoji-3744.js, 36 arms (18 on a Mac, 18 on Windows), real mouse and
  keyboard. Fails 6 arms on main (no #d-emoji-btn). Registered in tools/browser-checks.sh after
  render-agentdm-3414; README row; reason-grep counts 148 -> 150 and 103 -> 104, measured.
- emoji-picker-2254.js and render-emoji-mute-2357.js (the room's) still pass.
- Screenshots: ~/.cache/claude-handoffs/shots-3744/{before,after}.
