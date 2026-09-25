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

## Review pass 1 (opus): 0 blockers, 3 warnings, 6 nits
- W1 the panel was cut off in a short window (it rose past the top of #d-talk-box, an overflow:auto
  box) -> #d-emoji is position:fixed, placed by emojiPlace from the composer box (the #2834 reaction
  picker's approach): above, or below when there is more room, height capped to the room, inside the
  window and below the sticky .apphead (which covered its top rows once it escaped the clip). Repositions
  on resize and on the talk box's scroll. Arm at 1200x420 (the composer within a panel's height of the
  box's top): red with the old absolute panel. This also scopes away NIT 5 (the rule matched the
  Terminal composer).
- W2 at phone width the smiley took 40px and cut the placeholder to "Write" -> hidden under 480px: a
  phone's own keyboard has emoji. Arm red without the rule.
- W3 untested paths -> arms for the draft after a pick (red without the input event), the cannot-read
  arm (red without its two lines), and a pick into a disabled box (red without the refusal).
- NIT 2 the panel stayed open across an agent switch -> closed in openDetail's switch block; arm red
  without it.
- Not taken: NIT 1 (focus to body when the box closes under a keyboard user; the control case in #d-say
  does the same today), NIT 3 and NIT 4 (the room has the same Escape behaviour), NIT 6 (Tab order is
  DOM order, same as the room).
- Weakest premise now: hiding the DM smiley on a phone. Josh asked for emoji in the DM; a phone gets
  them from its keyboard. One media rule to undo.

## Review pass 2 (sonnet): 1 blocker, 1 warning, 1 nit
- BLOCKER emojiPlace's fixed 96px minimum pushed the panel off the window at 260px and under the
  sticky header at 160px -> the height is capped to the space between the header and the window's
  edge and the top is clamped into it; with under 56px of room the panel closes. Arms at 260 (open and
  whole), 200 (whole or closed), 160 (closed); red with the old floor.
- WARNING the panel stayed open with its box out of sight -> emojiPlace closes it when the box is
  outside [header, window]. Measured: in the real layout #d-talk-box is a flex column and the thread
  (#d-dmthread) scrolls inside it, so the composer never scrolls away and the page did not scroll at
  360px either; the guard is defence. The listener moved from #d-talk-box to a capture-phase document
  scroll listener (any scroller). The arm moves the box off screen and fires a scroll event; red without
  the guard and red without the listener.
- NIT resize is not throttled: returns at once while closed, same as the #2834 reaction picker. Not taken.
