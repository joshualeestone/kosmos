# orbwaits-7896: the KOSMOS orb only on the big waiting screens; small spinners back to the Sweep dots (kosmos#7896, Josh 11-06)

## Why
Josh, 11-06 11:25, with a screenshot of the Mac app's "Opening tmnt" screen: "When are we going to maybe see the new kosmos animated graphic in here?" #7896 replaced every small `.spin-sweep` with the KOSMOS orb (KORB). The big waiting screens draw a different mark, the branded K loader (`startKLoader`, the K's dots gathering and scattering), which #7896 did not touch.

## Josh's correction, 11-06 11:29 (verbatim in ~/.cache/claude-handoffs/josh-loading-and-spacing-2026-11-06.md)
"the new orb stuff should not replace the small loading spinners. Those should be the same loading spinners that we've had. It's only on these big giant ones like this where we show it when we're creating a new agent or we're doing something where a whole screen needs to load or something is waiting." So KORB draws only `.orb-wait` (the whole-screen waits); every small `.spin-sweep` keeps its Sweep dots, in plain `--gold` as before #7930 (the orb keeps the deep gold). The iPhone already has dots everywhere since #8058; no iPhone change.

## Change
A helper writes an 88 px `.spin.spin-sweep` (the orb's own markup), which KORB draws like every other spinner, and three waiting screens use it instead of a K canvas:
- the switching screen ("Opening <computer>", computersSwitchingScreen, #6585);
- the update overlay ("Updating", .upd-k);
- the Kosmos+ sign-in wait (#plus-si-k, about half a minute, #5785).

88 px matches the K's width there (88 x 103), so the screens keep their layout.

Creating an agent (`#made-mark`, Josh named it): the orb while the agent is made (startMadeMark); a clean finish puts the K loader's canvas back and finishes it, so it still ends in the dots becoming a tick. Each start puts in a fresh copy of the canvas, so a retry never runs two loader loops on one canvas.

## Kept as the K, on purpose (each a moment, not a plain wait)
- The restart screen (`.restart-k`, `{ still: true }`, #4343): a still, finished K for a screen where nothing is working. An orb would say something is working.
- The restart dialogs (`.chg-restart-k`, three places): Josh asked (#2692) to see "at least ... a single animation of the K animating into the circle"; their minimum hold is the K's cycle (K_LOADER_CYCLE_MS).

## Tests
render-model-spinners-2365.js: its orb arms build the orb through kOrbWaitHtml; a new arm checks a small spinner keeps its eight dots and gets no orb canvas. render-create-made.js reads whichever mark is showing (the orb while making, the canvas at the finish). Locally that check fails 9 of 19 on unchanged main too (a harness difference); CI is its judge.
web.plus-signin-kloader-5785.test.js and web.reply-where.test.js pin the K markup on these screens: changed to pin the orb. render-computers-4648.js checks the switching screen's mark is drawn: now the orb's canvas. mobile-shots.js and render-plus-signin-3478.js select `#plus-si-k canvas`, which the orb's own canvas still matches.
