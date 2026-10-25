# roomheld-7072: a held room shows the board's notice and Reopen the room (a slice 9 gap, #6838)

**Done when:** on the iPhone, while a project room is held (#5800), the board's held notice shows above the room's
composer, word for word (why, how it ends, when it lifts on its own, the one-summary exception), with Reopen the room
calling the board's POST /api/project/<id>/room/reopen; a reopen removes the notice and re-reads the room, a refusal
shows the board's sentence; the room suite covers it against the real route's answers; it is merged.

## Decisions
- The board's words and behaviour (web/index.html pjHeldNotice, pjHeldReopenClick), not new ones: the notice text,
  the button, the refusal sentence and the success announcement are the board's, and the suite checks the board
  still says each one, so the two cannot drift unseen.
- RoomPage keeps its held flag and gains heldUntil (the route's held.until); RoomStore keeps each room's hold from
  every newest-page read. On a reopen the notice goes before the re-read (the board's rule: a re-read that fails
  must not leave a dead button).
- An answer that is not the board's {ok: true} is a refusal, never a reopen (a sign-in page at 200 included).
- While the person types, the notice keeps to about four lines and scrolls (the board's kosmos-keyboard-up rule).
- The new route is guarded by the route check (#7061), which found it by itself (18 routes, 0 problems).
- Fixtures: room-held.json, reopen-ok.json and reopen-refused.json, captured from a sandboxed board held as
  server.room-held-5800.test.js holds one.
- Weakest premise: the look is unverified by a screenshot (the simulator run is not permitted here, #7055).

## Steps
1. Model, store, view, suite, builds. DONE (room 150/150, run 1085, actions 97, settings 41, tasks 90; Debug and
   KOSMOS_STORE_SHOTS Release SUCCEEDED; control: the until parse removed goes red).
2. Review loop. Round 1: 0 blockers, 6 warnings, 5 nits. Fixed: holds cleared on sign-out or another computer;
   a reopen answered after that is dropped, never announced as a success (ReopenOutcome); a read started before the
   last reopen never writes the hold back (readMayWriteHold, tested); the announcements only while the room is on
   screen; a refusal is announced (the board's role=status); a hold that appears is announced (the board's paint);
   any 2xx ok is a reopen; a DEBUG sample (KOSMOS_SAMPLE_HELD=1); a refusal note cleared when the hold changes; the
   needsLine comment moved back. Decided: the keyboard is NOT raised after a reopen (the board focuses its box; on a
   phone that pops the keyboard unasked). Reversible; one line.
   Round 2: 0 blockers, 1 warning, 4 nits. Fixed: "Reopened" is said before the re-read (a hold it finds is said
   after, never before), and VoiceOver's place moves to the message box (accessibility focus, no keyboard); a refusal
   is kept only while the room is still held; the refusal clears when the notice's words change, not on every small
   move of until; the typing cap scales with text size; the refusal sits under the button. Stated: the store's read
   numbering wiring is tested only through readMayWriteHold (a regression costs one poll, 5 s).
   Round 3: 0 blockers, 2 warnings, 3 nits. Fixed: every announcement here is queued (never cut off by the focused
   box or by each other); the button may wrap at the largest text rather than overflow; the board-phrase checks use
   the phone's own constants; returning to a held room announces it; the Debug sample hold is set once and cleared by
   a reopen.
   Round 4: 0 blockers, 1 warning (test strength), 3 nits; converged on correctness. Fixed: the board-parity checks
   are built from the phone's own output (notice pieces, lift sentence, refusal), never a second copy; a refusal
   that lands after the person left is not kept; a short notice takes only its own height while typing; the Debug
   sample remembers reopened rooms one by one.
   Round 5: 0 blockers, 0 warnings, 2 nits (converged). Fixed: the parity block's force unwraps are guarded, so a
   rewording reds a named check instead of trapping. Stated: a refusal that lands after the person left the room is
   neither kept nor said; coming back shows the notice with Reopen enabled, so they can try again.
3. Validation, PR.
