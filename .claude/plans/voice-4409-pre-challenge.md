---
pre_challenge: true
method: challenge-loop
branch: voice-4409
diff_hash: 4147e7e900ecb805f2b64b439695217255c36b097f0e221017ec8686133315bc
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T11:43:24Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 9: nothing new at BLOCKER or WARNING. Iteration 4 had also converged; the loop was run on, and iterations 5 to 8 each found a real WARNING, so iteration 4's convergence was not the end. Iteration 10 reviewed the reaction-bar width fix made after the surface gate found a real red, and was taken in full.)
**Total findings:** 34 (1 BLOCKER, 8 WARNINGs incl. the surface-gate defect, 0 CONVENTIONs, 18 NITs, plus 6 behaviours ACCEPTED as stated and 1 deferred)
**Fixed:** 24 | **Deferred:** 1 | **Asked (awaiting user):** 0 | **Accepted as stated:** 9

**Final gate:** validation PASSED on 2e178ef6b (validation log 2026-09-29T11:43:24Z, status clean, hash 4147e7e900ec). v2 (44ee3f1f9) was red on the surface gate only (render-phone-offline-718, trailer added); earlier: The v0 run after convergence was RED on one test, mine:
fixture-discipline forbids a hand-built agent card and the voice harness set CURRENT to { sessionName }. Fixed in
cc52c7bdf with real cards from test-support/fleet; the view-check mutation still reds 3 tests with real cards.

**What the branch does:** slice 1 of #4409 on the Mac. A mic button in every composer (DM, room, Guide) dictates
through on-device speech recognition in the app, and replies can be read aloud. Dictation is bound to the view it
started in and cancels on any move; it never overwrites the person's own edits, selection, or text past the cap.

### Per-Iteration Breakdown

The plan's "Review iteration N" lines and the iteration commits carry each finding in full.

#### Iteration 1
- [BLOCKER] a word heard after switching agents or rooms landed in the next agent's box (shared boxes, no hashchange) --> FIXED (dictation bound to its view; a late word cancels; removing the view check reds the tests)

#### Iteration 2
- [WARNING] mic to mic: the cancel's "stopped" arrived after the new start and ended it (mic on, button off) --> FIXED (session ids echoed by the app)
- [NIT] a window hidden during the permission prompt --> FIXED
- [NIT] two messages with the same words and read-aloud --> FIXED
- [NIT] the tests did not drive voiceToggle and the watch --> FIXED

#### Iteration 3
- [WARNING] a crashed page process or a reload left the Mac listening while the page drew every mic off --> FIXED (cancel on process termination and on each main-frame commit)
- [NIT] the idle stop did not clear the pending flag --> FIXED
- [NIT] the harness ran on copies, not the page's own VOICE, SPEAK and VOICE_WATCH --> FIXED
- ACCEPTED: a start dropped by the bridge with no word leaves the button "asking" until a reload (the safe direction; clearing it page-side could say off while the mic is on)

#### Iteration 4 (converged)
- [NIT] Escape did not work after clicking the mic (focus) --> FIXED
- ACCEPTED: no audio-configuration observer; an unplugged mic leaves the button on until an error or the 300 s cap (safe direction)

#### Iteration 5
- [WARNING] the mic wrote into the Guide's read-only box: words the person could not delete --> FIXED (read-only refused; a box that closes mid-dictation stops it)
- [NIT] a screen reader heard nothing about listening --> FIXED ("Listening. Press Escape to stop."; a live region)

#### Iteration 6
- [WARNING] any other write while listening (emoji, @mention, undo, autocorrect) was wiped by the next word --> FIXED (dictation stops and keeps the person's text)
- [NIT] starting the mic cleared another message's line --> FIXED
- ACCEPTED: #d-say-msg is role=alert, so "Listening" interrupts; #pj-room-msg shown with its text in one step (existing elements' semantics)

#### Iteration 7
- [WARNING] at the 10,000 cap the person's text after the caret was cut --> FIXED (the heard words give way)
- ACCEPTED: an arrow, Home or End key stops dictation (loses nothing, says so)

#### Iteration 8
- [WARNING] a selection was deleted when the first result was empty or there was no room --> FIXED (kept and given back)
- [NIT] the cut at the cap could split an emoji surrogate pair --> FIXED
- [NIT] a trailing space left at the cut --> FIXED

#### After convergence: the #2518 surface gate
- v1 was RED on the browser-check SURFACE gate only (masked in v0 by the fixture red). Running its checks ALONE found one real defect, mine: render-room-msgbox-2806. Read aloud made an agent's reaction bar six buttons, and at 375px it ran 49..336px in a 297px thread, so Reply was off the edge and took no tap (main fit by about a pixel) --> FIXED (e19a4193a: pjRxnFitWidth caps the bar at the thread and slides it inside, tap and focus paths; the check counts SHOWN buttons). The other checks the gate names ran alone on the fix, all clean, and carry per-check Browser-check-surface trailers (16 in c52c5d4f6, render-phone-offline-718 in 2e178ef6b, found by the v2 validation's gate). render-no-conflict-3729 red here is not this branch (one tree hash passed and failed; filed #4520).

#### Iteration 10 (the width fix, blind)
- [WARNING] every phone arm counts SHOWN buttons, so without read aloud they would pass on the narrow bar --> FIXED (a precondition pins want === 6)
- [NIT] the focus arm's full count; no inline style left after focusout; the thread's inner box; the fit after the early close; a refit of a focus-opened bar on resize --> FIXED (b92cb2e99)
- ACCEPTED: no arm pins that the shifted bar stays near its post (the fit moves only by the overflow)
Each new guard reds under its mutation; the six bar checks ran clean on b92cb2e99.

#### Iteration 9 (converged)
**New findings:** 0 BLOCKERs, 0 WARNINGs
- [NIT] a selection given back collapses to a caret --> ACCEPTED
- [NIT] at the cap, heard words are cut or dropped with no line saying why --> ACCEPTED (safe direction)
- [NIT] a multi-part emoji can be cut between its parts at the cap, leaving valid text --> ACCEPTED
**Converged.**

### Deferred
- The browser check covers the DM composer only; the room and Guide mics share the same functions.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Weakest premise (from the plan)
The mic path has not been seen working end to end: that needs a person at a Mac to allow both prompts and speak. The
mechanism, entitlement and plist keys are checked in the build and by --kosmos-app-voice-selftest (14/14); the page
side by web.voice-4409.test.js and the render-voice-4409 browser check.

### Strengths
- Every failure direction was chosen toward "on while off" or "stop and keep the person's text", never the reverse.
