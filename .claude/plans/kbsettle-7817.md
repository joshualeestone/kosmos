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
