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
  the gate's code (when it differs) goes on the screen, with its Mac's name; live moves the screen on
  (continueToApp); a run that gave up knocks again after a growing wait (15, 30, 60, then 120 s); the gate's no
  knocks again until it has lasted 60 s without a break, then "Your Mac said no" (macSaidNo). One no alone can be
  old (a no turned into a fresh Allow reaches the Mac at its next poll, 25 s at most), and a v2 Mac's "Not me" is
  never told to Kosmos+, so time is what tells them apart (iterations 3 to 5).
- The gate's code wins over Kosmos+'s: a gate with the board-v2 marker answers a keyed code, not match_code(device)
  (kosmos-relay crates/tunnel/src/proxy.rs, the test near line 7568), and that is the code the Mac's card shows.
  The Mac shows nothing before the knock, and the knock's answer brings the gate's code, so the phone shows the
  right code by the time the Mac can show one.
- SignInModel.showGateCode (only on .allow with a computer) / macSaidNo (on .allow with a computer or
  .denied(asking: true)). The app also knocks again on a return to the front.
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

#### Iteration 4 (blind review of the whole branch, sonnet)

- [SHOULD-FIX] taken: the same stale no can reach the first Allow step too (deny on the Mac, sign in again so
  Kosmos+ files a fresh Allow, sign in once more before the Mac's poll: Kosmos+ says pending, the gate says the old
  denied). So the gate's no is never final on this screen, on either step: it knocks again (with the growing wait),
  and a real no comes from Kosmos+'s own poll (watchAllow's .denied -> "Your Mac said no"), exactly as on main.
  AllowScreen.denied and SignInModel.macSaidNo are gone.
- [NIT] not taken: the Mac's name shows only when the gate's code differs from Kosmos+'s (with the same code there is
  nothing to tell apart); .signInHere/.signInAgain keep the screen waiting with Continue as the way on (only the
  person can cure those, in the app, where the tab says so).
Main logic suite PASS 2789/2789; settings, automation, actions, taskpage, room pass.

#### Iteration 5 (blind review of the whole branch, opus)

- [SHOULD-FIX] taken: round 4 made the gate's no never final, but a board-v2 Mac's "Not me" is local only
  (kosmos-relay devices.rs drop_waiting: "Kosmos+ is never told"; engine/remote.js) and turns the key away for 24 h
  (gatev2.rs DENIED_KEY_SECS), so the screen would knock for a day and never say no. The old no and the real no
  answer the same bytes ({"pending":false,"denied":true}, proxy.rs 1491 and 1576), so time tells them apart: an old
  no lasts one Mac poll (PENDING_POLL_SECS 5, a poll ends at 20 s); a no without a break for 60 s
  (Phase.realNoSeconds) is real and the screen says "Your Mac said no". ContentView keeps gateNoSince (cleared when
  the gate answers anything else, or a knock starts). Tests: first no and 59 s knock again; 60 s says no, on both
  steps; other answers ignore it.
- [NIT] taken: the plan's "The change" described removed code; rewritten.
- [NIT] not taken: .signInAgain/.signInHere/.kosmosPlusRefused keep the screen waiting with Continue (as on main;
  only the person cures them, in the app).
Main logic suite PASS 2793/2793; settings, automation, actions, taskpage, room pass.
