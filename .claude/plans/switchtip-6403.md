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

## Review 1 (opus) changes
- A look-back read is stamped when it STARTS and skipped while Kosmos+ is failing (the backoff stays in charge), so a
  tab return (visibilitychange and focus together) makes one call, and a down Kosmos+ is not read on every look.
- A forced read (after an Allow, when let in) that still finds one computer looks once more in 15 s, since Kosmos+ may
  not list the new computer yet; before, the next read was the 5-minute timer.
- The tip uses the page's ink tokens, wraps on a narrow screen (max-width), and describes the switcher button
  (aria-describedby) instead of a status region that starts hidden.
- Tests: the Allow and let-in reads (connect-sheet, spying the forced reads, with a phone Allow and the wait as
  CONTROLs), the tab-shown read, the close button (focus stays on the switcher).

## Review 2 (sonnet) changes
- The read time is stamped in computersFetch itself, so every read (boot, timers, the menu, a stale tab) counts for the
  minute a look back waits; a tab return no longer reads twice.
- A page-level flag keeps the tip to once per page where localStorage is refused (a private window).
- Escape puts the tip away (unless the menu or a dialog owns Escape). A row that was a computer cannot be allowed, so it
  does not force a read (comment).
- The 15 s follow-up after a forced read is tested, with an ordinary read as the CONTROL.

## Steps
1. worldswComputersSeen: COMPUTERS_READ_AT; first false->true shows the tip once (localStorage kosmos.switcherTipSeen).
2. computersReadSoon(force): after this computer allows a computer (paintAsk Allow), when this computer stops waiting
   to be allowed (paintPlus), and on window focus / visibilitychange when the last read is over a minute old.
3. Tip markup and CSS inside #worldsw (hidden with it); worldswOpen hides it; its close button focuses the switcher.
4. render-onekosmos-4815.js: tip, menu puts it away, focus and tab-shown re-reads with a within-a-minute CONTROL, the
   close button, once only after a reload. render-connect-sheet-4637.js: the Allow and let-in reads. Mutants: no focus
   read, no "seen" memory, no close handler, no tab-shown read: each red.
