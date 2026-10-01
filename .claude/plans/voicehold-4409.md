# voicehold-4409: voice slice 2, hold to talk, and a mic in the dialogs' text boxes

Card: joshualeestone/kosmos#4409, scope in comment 5941552208. Josh, #admin 2026-10-01 17:02 CDT: "How difficult
would it be to allow people to press and hold a microphone and dictate into the input boxes for project and agent
dialogues". Splinter handed it to me at 17:03.

## Change
1. Press and hold any mic to talk; let go to stop (it keeps what it heard). A press shorter than 300 ms is a tap and
   toggles as in slice 1, so a long dictation needs no held finger. The pointer does the work on press and release
   (pointerdown starts, or stops a mic that is listening; pointerup after 300 ms or more stops); the pointer's own click
   is then ignored. Any click with no press before it (the keyboard, VoiceOver, Switch Control, a script) toggles.
2. A mic inside the dialogs' text boxes: New project (name, description, what done looks like), New task
   (`nt-detail`), New agent (`create-instr`), the agent's instructions editor (`d-instr`), and the project settings
   (`pjs-name`, `pjs-desc`). Each is a `.micbtn.fieldmic` with `data-voice-for` in a `.micwrap`, inside the box
   (top right of a textarea, clear of its resize grip; centred in a one-line input); each says its lines in that dialog's own message line.
3. While listening in a dialog, focus moving to another field, or any button (Save, Create), stops it, keeping the
   words. A composer keeps slice 1's rules: Send stops it; its other buttons and other fields do not.
4. Mac app only, as slice 1 (drawn only with the on-device bridge, `html.has-voice`). Same bridge, no native change:
   `stop` already ends the audio and lets the recognizer deliver its final result.

## Decided, not missed
- Hold and tap both: Josh asked for hold; slice 1's tap stays so nothing that works now breaks (Splinter's scope).
- The listening line in a dialog goes to the dialog's message line (pj-add-msg, nt-msg, create-instr-note,
  d-instr-msg, pjs-msg), not a new line per field: a refusal (no microphone permission) must be seen, and those lines
  are where each dialog already speaks. In the New project dialog that line is at the bottom, by Create project.
- `nt-what` (the task's one-line title) is not in the card's list and is left out.
- Measured in passing: the listening line pushes a composer's mic up 23 px (slice 1, unchanged). A hold is not
  affected (release is heard on the whole document); a tap lands where the mic now is.

## Weakest premise
That the dictation bridge, stopped on release mid-word, keeps the last words. The code says yes (`stop` calls
`endAudio` and waits up to 5 s for the final result), but it is NOT MEASURED in the real app: it needs a microphone
and a person speaking. Done means (the card) a sentence held into the New project dialog lands in the box in the
served Mac app; that is for a person to check on 0.7.17 or later.

## Tests
docs/browser-checks/render-voice-4409.js (real page, the bridge a recorder): V10 a real held press starts, words land
while held, release sends stop, the caret stays in the box; V11 a short tap keeps listening and the next tap stops;
V12 every dialog box in scope has its mic, its padding and placement, and holding the New project description's mic
puts the sentence in the box; V13 keyboard and assistive clicks; V14 focus moving in a dialog; V15 a dialog button;
V16 drag-off and the composers' slice-1 rules; V17 an open emoji panel closes; V18 Escape in a dialog; V1b no bridge. V1 to V9 unchanged and passing. Mutations: no stop on release reds V10 and V12; toggling on
the pointer's click as well reds V2, V10, V11, V12. web.voice-4409.test.js 20/20.

## Review rounds
- Round 1 (opus): FIXED BLOCKER: wrapping pj-name in .micwrap took it out of its .frow flex row, so the Name field
  shrank for everyone; the wrapper now takes the field's place (flex: 1) and the input fills it; V1b (no bridge) and
  V12 check it fills its row. FIXED W: #d-instr and #create-instr have ID padding rules that beat the room for the
  mic; explicit rules now (V12 checks all eight boxes' padding). FIXED W: the mic sat on the textareas' resize grip;
  it is at the top right now (V12 checks). FIXED W: on first use the person lets go to answer macOS's microphone
  prompt, and that release dropped the pending start; a release before the bridge says listening is a tap (V12).
  FIXED W: a release the page never hears (Ctrl+click menu, a system sheet) left the press armed; cleared on
  contextmenu and window blur, Ctrl+click ignored, and the release must be the same pointer. FIXED NITs: a disabled
  box (instructions still loading) shows no mic (V12); each mic is named for its box ("Talk instead of typing:
  Name"), kept when it changes to "Stop listening"; textareas in the wrapper are block. NOT MEASURED: WKWebView's
  click detail (the keyboard test) and VoiceOver; Chromium only here. Mutations: the flex rule, the ID padding and
  the listening gate each red their check.
- Round 2 (sonnet): FIXED W: the keyboard path keyed on click detail 0, untested and fragile (an assistive press can
  arrive with detail 1 and no pointer, which would have broken the composers' mics too); a click is now ignored only
  when the pointer just handled that same mic; V13 drives Enter, a script click() and a detail-1 click (the old
  detail test reds it). FIXED W: in a dialog with several boxes, moving to another field kept dictating into the
  first; focus landing on any other field now cancels (V14). FIXED W: Save, Create and other dialog buttons did not
  stop listening, so late words could land after a save; any button now cancels (V15, isolated with a button that
  moves no focus; the old Send-only list reds it). FIXED W: the textarea mic sat over a classic scrollbar; it is
  offset by the page's measured --scrollbar-width (0 with overlay scrollbars, so NOT exercised by the headless check).
  DEFERRED W: a long press let go before the bridge says listening is taken as a tap (round 1's first-use fix); the
  mic shows its asking state meanwhile, and the next tap stops. FIXED NITs: a hold ends on window blur (Cmd-Tab);
  `.one` renamed `.line`; the .frow min-width rule says why. Left NIT: only the New project description's mic gets a
  held dictation in the check; the other seven are checked for presence, padding and placement.
- Josh, 17:16 ("Can we do it in mobile too?"): phones are SLICE 3, a separate branch: it changes slice 1's privacy
  rule (the browser's recognizer, Josh: "I don't care about privacy") and needs its own iPhone measurement.
- Round 3 (opus): FIXED W: a press dragged off the mic left the "pointer handled this mic" mark set, so the next
  keyboard or assistive press was swallowed; the mark clears once the release's own click has had its chance (V16,
  removing the clear reds it). FIXED W: with classic scrollbars the mic moved left by --scrollbar-width but the text
  room did not; the textareas' padding takes the same offset. NOT exercised headless (overlay, width 0); the
  consolidated layout leaves the variable unset, so the offset is 0 there. FIXED W (mine, round 2): "any button
  stops listening" had widened slice 1's composers too (attach and read aloud ended dictation); it is now dialog mics
  only, and composers keep Send-only (V16, the round-2 rule reds it; the unit test pins both arms). DEFERRED W
  (duplicate of round 2's): a hold let go before the bridge says listening is a tap. FIXED NIT: the textareas are not
  made block (it moved the spacing below them for everyone; the mic at the top no longer needs it).
- Round 4 (sonnet): FIXED W (mine, round 2): the focus-moved rule was not limited to dialogs, so it stopped a
  composer when focus reached any other field, which slice 1 never did; it is dialog mics only now (V16's composer
  arm; the ungated rule reds it). DUPLICATE W: the scrollbar offset uses the page's measured gutter, unexercised
  headless (round 3). DUPLICATE W: a hold let go before listening is a tap (deferred, round 2). FIXED NIT: a disabled
  box takes no mic padding. FIXED NIT: the plan's Change section describes the code, not its history.
- Round 5 (opus): FIXED W: preventDefault on the mic's pointerdown suppressed the follow-on mousedown, so popups
  that close on a mousedown outside them (the emoji panel, a custom select) stayed open, unlike slice 1; the focus
  move is now prevented on the mic's own mousedown, which lets the event reach those listeners (V17, the old
  pointerdown preventDefault reds it). FIXED W: Escape in a dialog's box stopping dictation without closing the
  dialog was unpinned (V18). FIXED NITs: the focus-moved comment says words still coming are dropped; the plan's
  placement and Tests lines. DUPLICATE NITs: hold before listening is a tap; the scrollbar offset.

