# looksoon-7420 (kosmos#7420): catch the blank after a read sooner

**Finished looks like:** after a read over a kept copy leaves nothing drawn at the newest, the list is back in about a third of the time on a real phone, clean opens are not rebuilt more often, and `GET /api/phone/chat-opens` on the new build shows rebuilds no higher against opens than the blanks explain. This does not stop the blank happening, and it does not reach the later-in-an-open blanks at 19:45 and 19:57.

**Evidence (simulator, video, list area, card):** 20 opens each way: empty 0.19 to 0.36 s on 9 of 20 today; 0.05 to 0.12 s on 8 of 20 with a look at 0.1 s. Phone count on build 54: 6 opens, 2 blank, 2 rebuilds, 0 closed blank. The route reproduces at 21 of 80 with a kept copy, 0 of 10 without.

**Change:** one extra look 0.1 s after the read's scroll to the newest, which acts only if nothing is drawn, through the existing settledPutBack. Two Debug-only sample switches make the route repeatable: KOSMOS_SAMPLE_KEPTFIRST and the control KOSMOS_SAMPLE_NOBLANKLOOK.

**Rejected:** rebuilding as the first read lands: 0 of 20 by the counter, but video shows 0.11 s empty on every open, which only moved it where the counter does not look. Skipping the re-anchor: 8 of 20 against 7 of 20, no effect. New-row count: no effect seen.

**Weakest premise:** that a phone's timing is like a simulator's. At 0.1 s rows may not have drawn, and a clean open would be rebuilt. The phone's own count shows that: rebuilds against opens on the new build.

**What would change my mind:** rebuilds rising against blanks on the phone count, or a person seeing it blink on open.
