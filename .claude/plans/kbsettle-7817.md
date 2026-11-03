# kbsettle-7817: the keyboard-shown scroll waits for the keyboard to settle

## Finished looks like
On build 31, a keyboard that passes through another height on the way up (380, 608, 380 on Josh's phone) does not
leave a long chat past its end and blank: the chat scrolls to the newest message once, after the keyboard is quiet,
and a scroll that still lands past the end is put back.

## Why
Build 30, 11-03 09:27 (Josh's DM, keyboard up): "keyboard shown, to the newest" fired three times in 0.3 s as the
keyboard went 380, 608, 380 (viewport 377, 149, 377). Each `proxy.scrollTo("end")` aimed at the view the passing height
left; once the keyboard settled the list sat past its end (y 34719, content 35204), 0 rows. The empty-list recovery did
not act: "end disappear (personScrolling true)", and it stands down while personScrolling. Only a new message's
re-layout brought rows back.

## Change
- did-show bumps kbSettleTick; the scroll runs keyboardSettle (0.3 s) later, only for the latest did-show.
- keyboardSettle later again, if the list is past its end and no finger is on it: backInside, then goNewest (what the
  empty-list recovery's backInsideThenNewest does). Not gated on personScrolling, which the app's own scroll set.
- LogicTests room: two source checks, each red on its mutant.

## Rejected
- Dropping the keyboard-shown scroll: the newest message goes behind the keyboard (#7344), on every keyboard show.
- Gating the recovery on personScrolling: in the 09:27 record that is exactly what held it off.

## Weakest premise
That the passing 608 is the cause (it fits the numbers: three scrolls, the middle one at the small view). Not
reproduced on the simulator. The 6x height estimate (#7420) is still there; this keeps the keyboard from exposing it.

## Verify
Release and Debug typecheck; room 774/774; mutants red; CI ui tests (KeyboardSlideUITests keep the newest above the box).

## Review round 1 (build 31 shipped before it; these go in build 32)
- A will-show while the keyboard is already up keeps the first will-show's keep-the-newest: during the wait the shrunk
  list can hide the end, which made a second will-show drop it and leave the newest behind the keyboard (#7344).
- The settled scroll also stands down under a finger, so a drag started in the 0.3 s is not pulled back.
- The source checks also pin keyboardSettle (0.3) and the goNewest after the put-back.
- The place: the 09:27 diagnostic itself printed "past the end" after its one try, so the put-back's condition is the
  recorded one. personScrolling true there is not explained by the app's own scroll (PersonScroll does not count
  .animating); if a deceleration set it, underFinger reads the same, and the put-back acts only once it has ended (0.6 s).
- Review round 2: the carry-over is kept only while a settled scroll is still waiting (kbSettlePending), not for as
  long as the keyboard is up, so a reader who scrolls up with the keyboard open is not pulled down by a later
  will-show; and any will-hide (on screen or not) cancels a waiting scroll and its put-back. diagKeyboard is no longer
  read for it.

## Review round 3: the design changes (build 32)
The wait-then-scroll design (build 31) kept meeting the hold for a reader higher up: during the wait both could be on,
a drag released in the wait was pulled down, and a will-hide/will-show pair in a height change dropped the keep. Each
fix added state. Build 32 keeps the keyboard-shown scroll exactly as on main (at did-show, as the hold expects) and adds
only the put-back: keyboardSettle after the latest did-show, a reader still kept at the newest (keepNewestInView), not
searching, no finger, in the same chat (epoch), whose list reads past its end, is put back (backInside, then goNewest,
which bumps appMoves so the hold stands down). Any will-hide cancels a waiting put-back. The carry-over and
kbSettlePending are gone.
Weakest premise now: that "past the end" is the state to catch. The 09:27 diagnostic printed it after its own try;
a blank "within" the content (#7420's estimate) is not covered by this.
