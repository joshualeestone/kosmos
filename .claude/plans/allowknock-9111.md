# allowknock-9111: the Allow screen knocks at the Mac, so "Waiting for your Mac" is true

Card: kosmos#9111 (Splinter, 11-25; found in the #7357 reviewer walk, Kitty's evidence; related #9106, Angel's, no code).
Not in build 73; for the next build.

## Done when

After a fresh native sign-in, while the iPhone shows "Allow this iPhone on your Mac", the phone has knocked at the
Mac's gate, so the Mac shows its Allow card; the screen shows the code the Mac shows; when the Mac allows, the screen
moves on to the app by itself; when it says no, the screen says so. "Continue to the app" still works at any time.
Shown with a recording on a signed simulator build.

## Why it waited for ever

The Mac's Allow card appears when the phone knocks at its gate (the tunnel lists the device under `devices` only
then). Only the Agents tab's run knocks: BoardClient.run(): the Macs list (chooseMac), a handoff, then openSession at
the gate, which answers pending with a code and admits on Allow. That run starts when a tab shows (BoardClient.show,
first viewer), which is after "Continue to the app". The sign-in screen meanwhile only polls Kosmos+ (watchAllow),
which waits for an Allow the Mac was never asked for.

## The change

- ContentView.knockIfWaiting(): while the sign-in screen's step waits for the Mac (.allow with a computer, or
  .denied(asking: true)) and the session just issued is the one the app holds (stored first: the run reads it), start
  the board's run once. Backed out (any other step but .done): stop it. Moved on (.done): leave it; the tab's show()
  calls start(), which cancels it and bumps the generation, so the tab's run replaces it, never runs beside it.
- ContentView .onChange(of: board.phase), only while knocking: BoardClient.Phase.allowScreen(step:) decides:
  the gate's code (when it differs) goes on the screen; live moves the screen on (continueToApp); the gate's no shows
  "Your Mac said no" (macSaidNo).
- The gate's code wins over Kosmos+'s: a gate with the board-v2 marker answers a keyed code, not match_code(device)
  (kosmos-relay crates/tunnel/src/proxy.rs, the test near line 7568), and that is the code the Mac's card shows.
  The Mac shows nothing before the knock, and the knock's answer brings the gate's code, so the phone shows the
  right code by the time the Mac can show one.
- SignInModel.showGateCode / macSaidNo: only act while the step is .allow with a computer.
- Kosmos+'s own poll (watchAllow) keeps running beside it; whichever answers first moves the screen.

## Decided

- Knock from the screen (Splinter's "best"), not only a primary Continue button. Continue stays as the way out.
- No copy change: "Your Mac is asking whether to let this iPhone in. Allow it there if it shows this code." is true now.
- The decision is a pure function on BoardClient.Phase (in BoardClient.swift, not SignInLogic.swift: six logic suites
  compile SignInLogic without BoardClient).
- Not done here: the iOS "Save Password?" sheet covering the screen (the system's; it no longer matters much, since
  the screen moves on by itself).

## Weakest premise

That knocking before the tabs show is safe. Checked: one run at a time (start() cancels and bumps the generation;
test: let in exactly once across the screen's start and the tab's start, and a control without the bump is let in
twice); a run with no viewers is stopped only by ContentView (backing out), tested to stop knocking.
Not measured yet: a real Mac on a signed build (the walk). An unsigned simulator build cannot keep the session in
the keychain (#9106), so the run reads no session and the screen behaves as before.

## Verified

- Main logic suite (run.sh): PASS 2774/2774, with 9111's checks. Control: start() without the generation bump:
  "let in once" FAILS (admitted 2).
