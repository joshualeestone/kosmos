# notice-7345: iPhone notifications play the Mac's bubble pop, and "work ready" notices show the agent's picture

Card: kosmos#7345 (Josh's iPhone feedback, 10-27 08:39, IMG_2712).

## Finished looks like

On a phone, a Kosmos notification that comes with a sound plays the Mac's bubble pop, and a "has work ready for you"
notice shows the agent's picture as message notices already do. Nothing changes on the Mac or Kosmos+.

## Decided

- The bubble pop is not a file anywhere: the board synthesises it (web/index.html playBubblePop). It is rendered to
  ios/Kosmos/bubble-pop.caf by a committed generator (ios/tools/make-bubble-pop.js), and a test pins the file to the
  generator and the generator to the board's numbers, so neither drifts.
- Level: peak 0.5, the level the page auditioned the voice at. The board plays it at 0.08 inside the page; as a
  notification the phone's volume governs it, and 0.08 would be close to silent. Mona Lisa may want another level.
- The sound is swapped in the notification extension, on every path out (the time limit's too), only when the notice
  came with a sound: a silent notice stays silent. Weakest premise: a push whose extension does not run (one without
  mutable-content) keeps the system sound; changing the push itself is Kosmos+'s, not this card's.
- A "ready" push has no words the computer can answer (its id is built:..., not askable), so the extension asks the
  board's own avatar route for the session the push names and keeps the notice's own words. Message style puts the
  agent's name as the title, so the notice's line ("Irma has work ready for you, in Spring catalogue") becomes the body.
- The extension carries its own copy of the app's session rule (it does not compile the app's code); a test checks
  the two agree.

## Verify

LogicTests (run.sh), typecheck of the app and the extension for the iOS 16 simulator, ios.bubble-pop-7345.test.js,
server.ios-routes-6838.test.js, the privacy manifest test. A real phone hears it in the next TestFlight build.

## Review bound

Challenge loop to convergence. Merge on green (beta rule).

## Review 1
- The push names the session but not the agent's shown name (kosmos-relay apns.rs: kind, id, address, session), so
  a ready notice's picture rides as an attachment and the notice keeps its own words, which name the agent. Message
  style there would have titled it with the session. Test fixtures are shaped as the relay sends.
- The sound test pins every value the generator copies from the board (waveform, decay, stop) and the file's format.
