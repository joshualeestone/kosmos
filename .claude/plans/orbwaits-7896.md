# orbwaits-7896: the KOSMOS orb on every whole-screen wait, the Sweep dots on every small one, and the orb's dots become the check when an agent is made (kosmos#7896, Josh 11-06)

## Why, in Josh's words (11-06, verbatim)
- 11:25, on the Mac app's "Opening" screen: "When are we going to maybe see the new kosmos animated graphic in here?"
- 11:29: "the new orb stuff should not replace the small loading spinners. Those should be the same loading spinners that we've had. It's only on these big giant ones like this where we show it when we're creating a new agent or we're doing something where a whole screen needs to load or something is waiting."
- 12:17: "basically anywhere we had the K Loader I want it to be the Orb. And the one that might require some animation help is the creating an agent one because it animates to a greencheck onece complete"
- 12:18: "everything else that is small like breathing K at 16px should just be the sweep dots"
- 12:18: "First frame before the board shows lets do the sweep dots.. or if we have room do the 88 Orb"
- 12:29, on a clip of the orb turning into the check: "That works great for building an agent."

## Change
KORB draws only `.orb-wait`, written by `kOrbWaitHtml(cls, label, size, still)`. Every small `.spin-sweep` keeps its Sweep dots.

The orb (88 px unless noted), in place of the K loader or a ring:
- the switching screen ("Opening <computer>", #6585), the update overlay (.upd-k, bright gold on its dark scrim), the Kosmos+ sign-in wait (#plus-si-k);
- the full-restart screen (.restart-k): a STILL orb (.orb-still), as the K was held still there (#4343);
- the change-model, provider and agent restart interstitial (.chg-restart-k, chgBusyHtml); its hold is still K_LOADER_CYCLE_MS (4.4 s);
- the first frame (#boot-cover): its markup paints as CSS Sweep dots at first paint (unchanged, 28 ms), and KORB swaps in the orb when the script runs;
- making an agent (66 px, startMadeMark): the orb while it is made; on the clean finish KORB.finish eases the turn to a stop and moves every dot showing to the nearest of the check's 155 dots, drawn short stroke to long, gold to --ok green. Every other exit calls stop(), so an error or a walk-away never draws a check. A finish while hidden draws the check when it next shows.

The Sweep dots, in place of a K or a ring: the restarting mark on agent cards (kGlyph, 16 px; .spin-still when a restart overran), Meta Muse "Connecting" (14 px).

The K loader (startKLoader, K_LOAD) is removed. Gold: deep #9c741b on light grounds, bright --gold on dark ones.

## Not in this branch
- The Mac installer page (install/pkg-scripts/installing.html) is a standalone page with its own copy of the K; it becomes the orb on its own branch (instorb-7896), merged after this one.
- iPhone: Josh still has its whole-screen waits and Making open.

## Tests
Unit: web.reply-where (the orb on the overlay, no K loader in the page, no progress reading in KORB), web.plus-signin-kloader-5785, web.firstrun-choice-4356. Browser checks (Chromium here; WebKit hangs on this Mac, #8114): render-model-spinners-2365 (small keeps dots, theme golds, the overlay's gold), render-restart-screen-4343, render-model-restart-interstitial, render-restart-kloader-2831, render-handoff-restart-3492, render-restarting-2019 and render-restart-timedout-2019 (the dots, moving or still), render-reassign-update-3050, render-plus-signin-3478, render-create-made (the orb's canvas turns green on the clean finish and not on the never-seen one; it fails locally on unchanged main too, so CI judges it).
Under reduced motion the restarting dots take the app-wide calm pulse, where the K held still; an overrun restart is still fully still.
