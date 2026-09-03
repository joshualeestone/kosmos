# #2054 - Consolidate the Settings > Automation section

Design: installkosmos.com/design/automation-consolidated (Mona Lisa, 2026-09-03).
Base: origin/main at 37acb257 (my #2020 merge). Branch: automation-consolidate-2054.

## The calls (from the card + design)
1. **The move.** The "Agents talking to each other" limit block (lim-row + tier
   select + notes) folds into Automation as block 3. The top-level "Agents
   Talking" tab is DELETED (nav pill + s-sec-talking section + the 'talking'
   entry in SETTINGS_SECTIONS).
2. **All sliders.** Auto-save and Prompter change from checkbox+Save-button to
   the app's `.toggle` slider. The lim block already is that slider.
3. **Order:** Auto-save, Prompter, Agents talking. (Daily report #2037 is NOT
   built yet - it is the future block 4; I do not invent it. Room is left for it.)

## My decisions (reversible; documented so they can be overturned in a sentence)
- **Save-on-interact, no Save button.** ALL five existing `.toggle` sliders
  (lim, tell, notify, auto, eng) commit on flip with no Save button; the lim
  toggle+select combo saves on toggle-click AND on select-change. To "make the
  rest match what I built" and give the tab one visual language, Auto-save and
  Prompter drop their Save buttons and save on interact, exactly like lim.
  A slider that needs a separate Save click is the hybrid the card exists to
  remove (see the updates-row comment: "a switch is a promise something changes
  when you flip it"). Routes/methods unchanged: POST /api/settings (autohandoff),
  PUT /api/heartbeat-setting.
- **Hide the tier/threshold/interval select-row when the control is off**, mirroring
  lim exactly (lim-tier-row hides when off). A threshold for a disabled feature is
  noise. Weakest premise: the card asked for a visual swap, not a visibility rule;
  if Josh/Mona want the select always visible, it is one line each.
- **Silent success.** The flip is the feedback (same as lim/tell/notify); a message
  shows only on error or could-not-read. Drops the old "Saved. ..." lines, which
  no sibling slider shows - removing a two-copies-of-one-fact drift.

## The could-not-read third state, by control type (card's ruling, my #2020 measurement)
- **Auto-save + Prompter = STATUS controls.** could-not-read = the knob's ABSENCE
  (paintSwitch(null)) + a neutral line "We could not read this setting just now."
  Nothing here leaves the machine, so a switch you only read may honestly vanish.
  Reads are 403-safe: a non-ok GET is could-not-read, NEVER a confident Off
  (do not .json() a non-ok response into a position - the #2047 rule).
- (The lim block keeps its own existing three-state paint, unchanged.)

## THE ACCEPTANCE THAT MATTERS (Mona Lisa, unprompted): stored values survive the move
The values live SERVER-SIDE (/api/settings, /api/heartbeat-setting, /api/limits) and
are read on paint - moving HTML cannot touch them. The real hazards the move creates:
- A save firing during paint (would overwrite the stored value). paintSwitch and
  `select.value=` dispatch no events, so paint issues only GETs. Test asserts paint
  makes NO POST/PUT.
- A pre-load interaction writing a markup default over a stored value. The toggle
  ships `hidden` and is un-hidden only after its position is read (paintSwitch), so
  it cannot be clicked before load; the select-change handler guards on the toggle
  having a known position (aria-checked present) and refuses to save otherwise.
- New acceptance test: stub the server returning a NON-default stored value
  (enabled:false / threshold:95, opposite of the on/85 default), run paint, assert
  the control shows the stored value (not the default) and that paint wrote nothing.

## Files
- web/index.html: automation section (3 blocks), delete talking nav pill +
  s-sec-talking, SETTINGS_SECTIONS, paintAutomation/paintHeartbeat + interact
  handlers (ah-enabled->ah-toggle, hb-enabled->hb-toggle; ah-save/hb-save removed).
- web.settings-nav.test.js: lim-* now in 'automation'; nav order drops 'talking';
  add ah-toggle/hb-toggle in 'automation'.
- web.autohandoff-1724.test.js, web.heartbeat-1722.test.js: rewire to slider +
  interact; add the stored-value-survives acceptance test.
- web.switch-markup.test.js: add ah-toggle, hb-toggle (and tell/notify, a gap I
  am closing while here) to the #229 markup guard.
- web.file-pickers.test.js: >Save< count 6->4; drop the ah-save/hb-save aria rows.
- docs/browser-checks/render-settings-nav.js: SECTIONS drops 'talking'; lim-toggle
  WHERE -> 'automation'.
- docs/browser-checks/render-prompter-label-1843.js: headings now 3; replace the
  save-aria check with a toggle-exists check.
