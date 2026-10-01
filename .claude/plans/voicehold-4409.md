# voicehold-4409: voice slice 2, hold to talk, and a mic in the dialogs' text boxes

Card: joshualeestone/kosmos#4409, scope in comment 5941552208. Josh, #admin 2026-10-01 17:02 CDT: "How difficult
would it be to allow people to press and hold a microphone and dictate into the input boxes for project and agent
dialogues". Splinter handed it to me at 17:03.

## Change
1. Press and hold any mic to talk; let go to stop (it keeps what it heard). A press shorter than 300 ms is a tap and
   toggles as in slice 1, so a long dictation needs no held finger. The pointer does the work on press and release
   (pointerdown starts, or stops a mic that is listening; pointerup after 300 ms or more stops); the pointer's own click
   is then ignored. A keyboard press (Enter or Space, click with detail 0) still toggles.
2. A mic inside the dialogs' text boxes: New project (name, description, what done looks like), New task
   (`nt-detail`), New agent (`create-instr`), the agent's instructions editor (`d-instr`), and the project settings
   (`pjs-name`, `pjs-desc`). Each is a `.micbtn.fieldmic` with `data-voice-for` in a `.micwrap`, at the box's bottom
   right (centred in a one-line input); each says its lines in that dialog's own message line.
3. Mac app only, as slice 1 (drawn only with the on-device bridge, `html.has-voice`). Same bridge, no native change:
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
V12 every dialog box in scope has its mic, the New project description's mic sits inside its box, and holding it puts
the sentence in the box. V1 to V9 unchanged and passing. Mutations: no stop on release reds V10 and V12; toggling on
the pointer's click as well reds V2, V10, V11, V12. web.voice-4409.test.js 20/20.
