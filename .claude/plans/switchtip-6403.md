# switchtip-6403: the switcher appears without a reload, with a one-time tip

Card: joshualeestone/kosmos#6403 (Josh 11:30). Stacked on onecomputer-6396 (#6396 hides the switcher until the account
has another computer); retarget to main once #6396 merges. Josh asked for the tip, so it is allowed under his
10-17 "no new lines" ruling; it is one line.

## Finished looks like
(1) Once a second computer is allowed, the switcher shows on the boards without a reload: on the computer that pressed
Allow at once, on the computer let in at once, and on any other open board the next time it is looked at (window focus
or the tab shown) a minute or more after its last read. (2) The first time it appears in a browser, one line under it
says "Switch between your computers here." with a close button; it goes on close or when the menu opens, and never
comes back in that browser. Screenshot both.

## Call
Re-read on look-back, not a faster poll: every read is a signed call to Kosmos+, and every one-computer board would
poll; reading when someone looks is enough to show it "at once" to a person. Rejected: polling each minute. Weakest
premise: a board left open and never looked at catches up only on its 5-minute timer, which nobody sees anyway.

## Steps
1. worldswComputersSeen: COMPUTERS_READ_AT; first false->true shows the tip once (localStorage kosmos.switcherTipSeen).
2. computersReadSoon(force): after this computer allows a computer (paintAsk Allow), when this computer stops waiting
   to be allowed (paintPlus), and on window focus / visibilitychange when the last read is over a minute old.
3. Tip markup and CSS inside #worldsw (hidden with it); worldswOpen hides it; its close button focuses the switcher.
4. render-onekosmos-4815.js: tip, menu puts it away, focus re-read with its within-a-minute CONTROL, once only after a
   reload. Mutants: no focus read (12 red), no "seen" memory (4 red).
