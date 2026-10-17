# switchtip-6403: the switcher appears without a reload, with a one-time tip

Card: joshualeestone/kosmos#6403 (Josh 11:30). Stacked on onecomputer-6396 (#6396 hides the switcher until the account
has another computer); retarget to main once #6396 merges. Josh asked for the tip, so it is allowed under his
10-17 "no new lines" ruling; it is one line.

## Finished looks like
(1) Once a second computer is allowed, the switcher shows without a reload: at once on the computer that pressed Allow;
at once on the computer let in while its Kosmos+ section is open (where pairing happens); on any other open board the
next time it is looked at (window focus or the tab shown) a minute or more after its last read. (2) The first time it
appears where a person can see it, one line under it says "Switch between your computers here."; it goes on its close
button, a click anywhere on it, Escape, or opening the menu, and never comes back in that browser. Screenshot both.

## How it works (current behaviour; the review log below says how it got here)
Reads (each is a signed call to Kosmos+):
- computersFetch stamps COMPUTERS_READ_AT when any read starts (boot, timers, the menu, a stale tab).
- computersReadSoon(force): forced after this computer allows a computer (askAct) and when this computer stops waiting
  (paintPlus); a forced read opens 90 s of follow-ups every 15 s (Kosmos+ lists the new computer once it connects).
  A forced read owed while the tab is hidden happens, with its follow-ups, when the tab is shown.
- A look back (window focus, the tab shown) reads at most once a minute after any read, never while Kosmos+ is failing
  (the backoff is in charge) and never while the last answer said this computer is not signed in to Kosmos+.
The tip:
- Inside #worldsw (hidden with the switcher), one line, wraps on a phone, ink tokens for both themes.
- Takes clicks itself: a click on it puts it away (a person clicking a popover to dismiss it must never press a control
  hidden under it). Its close button returns focus to the switcher; it describes the switcher (aria-describedby).
- Seen (localStorage kosmos.switcherTipSeen, and a page flag where storage is refused) only when a person can see it:
  the tab showing and the tip laid out; checked after it shows, on the tab shown, on a resize, and when it is put away.
- Escape puts it away only while it is laid out and no menu or visible dialog owns Escape.
- Browser checks that serve two or more computers and are not about the tip (allagents, otheraccounts, mobilenav,
  federation-invite, dm-chatfirst's two-computer arm) and mobile-shots seed the seen flag, since the tip now takes clicks.

## Calls (decided, with the weakest premise)
- Re-read on a look, not a faster poll: rejected reading every minute on every one-computer board (a signed call per
  board per minute). Cost: a board left visible and focused the whole time (a second monitor) catches up on its own
  5-minute timer. Weakest premise: that such a board is rare while pairing (the person is at the two computers being
  paired, which update at once). What would change it: Kosmos+ telling boards a computer was added (a push).
- The tip takes clicks (review 7 reversed click-through, which protected browser checks at the person's expense).

## Review log
- 1 opus: look-back stamped at start and skipped during backoff; forced read follow-up; tokens; phone wrap;
  aria-describedby; hook tests. 2 sonnet: stamp in computersFetch; page flag; Escape; follow-up test.
- 3 opus: Escape's dialog test asks for a visible dialog; forced read while hidden; real-read counts.
- 4 sonnet: follow-ups for 90 s; let-in read needs the Kosmos+ section open (said). 5 opus: seen when visible;
  forced-hidden follow-ups; mobile-shots seeded. 6 sonnet: worldswTipMarkSeen (tab shown, laid out, resize, put away).
- 7 opus: tip takes clicks; the "once" arm proves the page writes the flag; Escape only while laid out.
- 8 sonnet: the five checks seeded; no look-back reads while not signed in; tab-shown arm isolated.

## Steps
1. web/index.html: COMPUTERS_* state, worldswTipOnce / worldswTipMarkSeen / worldswTipHide, computersReadSoon, the hooks
   in askAct and paintPlus, the listeners (visibilitychange, focus, resize, Escape, the tip's click), the tip markup + CSS.
2. render-onekosmos-4815.js: every behaviour above with CONTROLs; floor 144. render-connect-sheet-4637.js: the Allow and
   let-in reads (spy + real reads) with CONTROLs. The five checks + mobile-shots: seen flag seeded.
3. Mutants red: no focus read, no seen memory, no close handler, no tab-shown read, no follow-up, old Escape guard,
   seen-at-show, hidden-tab seen, no page write.
