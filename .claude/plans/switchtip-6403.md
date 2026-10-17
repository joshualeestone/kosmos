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

## Review 3 (opus) changes and calls
- Escape's "a dialog is open" test now asks whether a dialog box is visible (the page's dialog boxes keep aria-modal
  while their wrapper is hidden, so the old test never let Escape through); an Escape arm with a dialog CONTROL.
- A forced read in a hidden tab marks the tab stale, so it reads when looked at.
- The hook tests also count real reads of /api/remote/computers, not only calls.
- DECIDED, not built: a board that stays visible and focused the whole time (a second monitor) catches up on its own
  5-minute timer, not at once. Reading every minute from every one-computer board to cover it costs Kosmos+ a signed
  call per board per minute. Rejected for that cost. Weakest premise: that such a board is rare while pairing (the
  person is at the two computers being paired, which both update at once). What would change it: Kosmos+ telling
  boards a computer was added (a push), which would make it free.
- The tip counts as seen once shown, even in a tab nobody looked at; browsers that already had two computers see it
  once on their first load after this change.

## Review 4 (sonnet) changes
- After a forced read that still finds one computer, follow-ups every 15 s for 90 s (Kosmos+ lists the new computer
  only once it has connected), not one.
- The let-in read runs from paintPlus, which runs while the Kosmos+ section is on screen (where pairing happens);
  elsewhere the look-back read covers it. Said in the comment; "(1) at once on the computer let in" means with the
  Kosmos+ section open, as it is while pairing.
- Escape checks the key and the tip before looking for a visible dialog.

## Steps
1. computersFetch stamps COMPUTERS_READ_AT; worldswComputersSeen's first false->true shows the tip once
   (localStorage kosmos.switcherTipSeen, and a page flag where storage is refused).
2. computersReadSoon(force): after this computer allows a computer (askAct, Allow), when this computer stops waiting
   to be allowed (paintPlus), and on window focus / visibilitychange when the last read is over a minute old.
3. Tip markup and CSS inside #worldsw (hidden with it); worldswOpen hides it; its close button focuses the switcher.
4. render-onekosmos-4815.js: tip, menu puts it away, focus and tab-shown re-reads with a within-a-minute CONTROL, the
   close button, once only after a reload. render-connect-sheet-4637.js: the Allow and let-in reads. Mutants: no focus
   read, no "seen" memory, no close handler, no tab-shown read: each red.
