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

#### Iteration 1 (blind review, opus)

- [SHOULD-FIX] taken: a run that gave up (the Mac not answering, a refusal, held, Kosmos+ down, no computer yet) left
  the screen waiting on Kosmos+ alone, the original bug again. Phase.endedRun -> AllowScreen.knockAgain: ContentView
  starts the run again after 15 s while the screen still waits and nothing else started one; and on a return to the
  front (a locked phone's run stops at not answering). Not for signed out, Kosmos+'s refusal, the Mac's no, sign in
  again or sign in here (only the person cures those).
- [SHOULD-FIX] taken: with two Macs the run knocks at one (pickMac), so the gate's code is now shown with that Mac's
  name ("On Studio"), kept in SignInModel.gateMac (cleared on each new sign-in).
- [NIT] taken: "once" was not literal (the account change from signedInNatively restarts the run through
  BoardClient.accountChanged; one run at a time all the same). Comment corrected.
- [NIT] taken: the guard read pushManager.currentSession (registrar memory first); it now reads SessionKeychain.live,
  the store the run reads.
- Not taken: tests of knockIfWaiting's ordering and the phase handler (SwiftUI view code; no logic suite compiles
  ContentView). The reviewer traced both orders as safe; the signed simulator walk will show it.
Main logic suite PASS 2789/2789; settings, automation, actions, taskpage, room suites pass.

#### Iteration 2 (blind review of the whole branch, sonnet)

- [SHOULD-FIX] taken: on "Your Mac said no" asked again (.denied(asking: true)), a second no from the Mac's gate
  mapped to keep, and Kosmos+ need not learn of the gate's no, so that screen could wait for ever. Now .denied ->
  macSaidNo, which accepts that step too (-> .denied(asking: false), and the knock stops). Test changed to say so.
- [NIT] taken: retries could stack, and a screen left up retried every 15 s all night. Only the latest retry fires
  (knockRetries), and the wait doubles 15, 30, 60, then 120 s.
- [NIT] not taken: a fresh handoff on every return to the front (the same code, harmless; the tabs do the same);
  a stale "On <Mac>" line during a later connecting (still the right Mac for the code shown); a .live phase already
  showing when the knock starts (forget() clears it on a changed session); .denied(asking: false) has no Continue
  and a fixed-email person has no way back after the Mac's no (as before this change; a separate card if wanted).
Main logic suite PASS 2789/2789; settings, automation, actions, taskpage, room pass.

#### Iteration 3 (blind review of the whole branch, opus)

- [SHOULD-FIX] taken: round 2's change made a second-chance sign-in (.denied(asking: true)) end on the gate's first
  no, but that no is often stale: Kosmos+ has turned the no into a fresh Allow, and the Mac's denied list catches up
  only at its next poll (kosmos-relay crates/tunnel/src/proxy.rs ~1481, kosmos#6407, read on origin/main). Now the
  gate's no on that step knocks again (with the growing wait), and Kosmos+'s own poll (watchAllow) still says a real
  second no, as on main. macSaidNo is back to the first Allow only, where the device was not denied before (a device
  the Mac denied earlier arrives at .denied(asking: true), not .allow). Test changed to say so.
- [NIT] taken: an old retry timer could match a reset counter: a never-reset knockTimers now picks the latest timer;
  knockRetries (reset per knock) only sets the wait.
- [NIT] taken: the "backed out" test's words now claim only what it covers (BoardClient.stop ends the knocking).
Main logic suite PASS 2789/2789; settings, automation, actions, taskpage, room pass.
