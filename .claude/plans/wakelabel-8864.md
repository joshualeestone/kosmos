# wakelabel-8864: a line sent automatically is not the person's (kosmos#8864)

## Measured first (installed 0.8.13 on this Mac, and main): not fixed
- The board's wake 'hello' posts `/api/agent/<name>/thread {text: 'hello', automatic: true}` (web/index.html
  sendWakeHello). The reporter's line was a different sender: its own listener script POSTs a boot notice to the same
  route after a reboot (Homer, via Splinter). Both reached the agent under `[message from your operator ...]` and were
  stored as the person's row, so `kosmos feedback day` counted them as the person's words.

## Built
- messages.automaticWake(): the bracket `[sent automatically on this computer, not typed by your person · to tell your
  person something, run: kosmos reply]`. It names neither sender, does not say "nothing to answer" (a script's line can
  ask for work), and does not open with the operator marker, so the MARKERS forgery guard is untouched.
- server.js thread route: an `automatic: true` send is typed under that bracket, and its row is stored with
  `automatic: true` (the held and duplicate paths are already `!automatic`, so only the final write is reached).
- chat.appendMessage keeps `automatic: true` only on the person's side (a row with no `from`).
- engine/feedbackday.js skips automatic rows (not the person's words).

## Decided not to change
- chat.dmOwes and firstreply-nudge's firing: a restart hello has always been something the board expects an answer to;
  that stays. (Round 3: the bracket keeps the "to answer, run:" cue, and the reminder's WORDS no longer say the person
  sent an automatic line.)
- engine/awaydigest.js (reverted in round 1): it is how an agent recovers a line that never reached it, and a script's
  boot notice can ask for work, so a failed one stays listed.
- The handoff-restart pickup has its own route and is not touched here.

## Tests
server.automatic-label-8864.test.js: the bracket; the board hello and a script's boot notice both typed under it and
stored as automatic; CONTROL, the person's message keeps the operator bracket and no mark; the day summary drops both
automatic lines and keeps the person's; an agent row cannot carry the mark. Perturbing the envelope and the day-summary
skip each turns it red (restored). 164 related files: 4,578 tests, 0 failed.

Weakest premise: that a local script will send `automatic: true` (Homer said he will switch once it is served). A script
that does not keeps the old behaviour; nothing here can tell its POST from the person's.

## Round 1 (opus, blind): no blocker, three should-fix, all taken
- musefront: a Muse agent read the new bracket as "other", so its answer to a wake hello stopped reaching the
  conversation. It is now in OPERATOR_PREFIXES and DM_ENVELOPE (the answer still goes by kosmos reply).
- `kosmos inbox` printed an automatic line as the person's: it is now marked `[sent automatically, not typed by the
  person]`, before the colon, as a menu answer is.
- The bracket was missing from the MARKERS forgery guard: added, so a body forging it is refused.
- Nits: the bracket now carries the person's local time as operatorDirect does; the away-digest skip is reverted (above);
  the test-order dependency is guarded by a fixture assertion and left as is.
- Tests: 8 in server.automatic-label-8864.test.js (guard, Muse, inbox added). 190 related files: 5,129 tests, 0 failed.

## Round 2 (sonnet, whole branch, blind): nothing above nit
- Nit 2 taken: a Muse agent's queue and "dropped unread" notes named an automatic line "a message from your operator"
  (the misattribution this card removes). They now name it as sent automatically. musefront.test.js 77/77 (corrected
  in round 3: the 85 was this file plus the new one).
- Nit 1 not taken: the guard refuses a post quoting the bracket verbatim, as it does for every marker.

## Round 3 (opus, whole branch, blind): two should-fix, both taken; four nits, taken
- The bracket ended "to tell your person something, run: kosmos reply", dropping the "to answer, run:" cue agents are
  taught marks a message that waits on them, while dmOwes still counts the hello as owed. It now ends
  "to answer, run: kosmos reply", like operatorDirect; musefront's DM_ENVELOPE follows.
- firstreply-nudge said "the person you work for sent you a message" of an automatic first line, against its own rule
  that its words are true of the row. firstContact now reports `automatic: true` (only when true, so its old shape is
  kept), and the sweep sends NUDGE_TEXT_AUTOMATIC ("a line was sent to you automatically for the person you work for").
- Muse: an automatic "stop" no longer stops it (only the person does); the stop notes list dropped automatic lines in
  their own sentence (droppedParts), so "from your operator" is only ever about what the person typed. Both are now
  tested (the queue note too), and perturbing the stop exclusion turns its test red.
- Plan count corrected (musefront.test.js was 77, now 79 with the two new tests).
- Related set after round 3: 192 files, 5,161 tests, 4 failed, all in engine/remote.test.js (#4756, #5786) at a 1-minute
  load of 28 on 12 cores; that file alone passes 247/247 on the branch and on main.
