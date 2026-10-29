# sidelock-7420: the iPhone chat's side lock puts a sideways shift back before it is drawn

Card: kosmos#7420. Josh, 2026-10-29 11:40 CDT (via Splinter), iPhone build 16 or 17, a DM: "the dialogue is jumping back and forth horizontal a whole lot. Like every few seconds and sometime multiple times a second".

## Finished looks like
With nobody scrolling, a sideways offset given to the chat's scroll view is put back inside the same contentOffset change, so no frame is drawn shifted. The record (diagnostic trace) still counts each shift. A scroll in progress keeps the old 0.35 s wait. Ships in the next TestFlight build.

## Why
SideScrollLock (#7537, build 16) put a shift back 0.35 s after it appeared. A cause that keeps shifting the chat (never found) is then drawn shifted, back, shifted: the jitter. The cause is still unknown; this removes the visible effect whatever it is.

## Change
ios/Kosmos/ChatView.swift, SideScrollLock.Probe's contentOffset observer: when ChatView.idAnchor (iOS 17+) and the scroll view is neither dragging nor decelerating, set contentOffset to (rest, current y) at once and return. Otherwise the existing delayed put-back. iOS 16 keeps the delay because its move to the newest message is animated and a direct offset write could stop it partway.

## Measured (simulator, iPhone 17 Pro, iOS 27, Debug)
- Forced shift (KOSMOS_SAMPLE_SIDEWAYS=4), 30 screenshots in a burst around it, horizontal offset of a band of bubbles vs the first shot (jit/shift.py):
  - main 76ba6e6fdf: 1 of 30 shots shifted 18 px, in each of 3 runs.
  - this branch: 0 of 30, in each of 3 runs; trace on: "side offset 16, put back, shift 1" (the shift happened and was counted).
- Sample DM (growing, many reactions, 220 varied messages, working dots, keyboard up and down): 0 shifts on main: the real cause is not in the sample.
- Repo tests that read ios/: 11 files, 82/82 pass. Debug build for simulator: OK. Release build: see ledger.

## Weakest premise
That Josh's jitter is the lock's delayed put-back. If his chat's jump is not a scroll offset (rows re-laid out sideways), this changes nothing. Follow-up: the app reports shift count, content width and build by itself (Splinter's suggestion), separate card.

## Ledger
- Validation 1: above.
