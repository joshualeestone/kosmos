# reopen-8118: the Mac app reopens on the computer you were looking at (kosmos#8118)

## Problem (Josh, 11-06 12:21)
Looking at the mini's agents from the laptop's Kosmos app, then quitting or restarting, lands back on the laptop's
own agents, so he switches again every time.

## How it works today (read 11-06)
- The Mac window always starts on its own board (`loadBoard`, native-app/main.swift).
- A switch is page-side: the switcher click (`computersOpenClick`, web/index.html) asks this board for a two-minute,
  single-use ticket (POST /api/remote/open-ticket, #6406, only from this computer's own screen) and navigates the
  window to `https://<name>.kosmosplus.com/#kpt=<ticket>`. The app only sees the URL (`showsAnotherComputer`).
- View > Back to This Computer (#6411) is the way home.

## Plan
1. Remember (app): the kept value means "the computer the window was last on". When another of the account's
   computers finishes loading, store ONLY its host (`<name>.kosmosplus.com`) in the app's defaults: never a ticket,
   token or full URL. Forgotten by Back to This Computer (and the #6585 navigation home), by any later load of this
   computer's own board in the same launch (the window is home), by a reopen that does not happen, and when the Mac
   is in connect mode (review 1).
2. Reopen (app + page): launch loads the local board exactly as today. After that first load finishes, the app asks
   the page to reopen the remembered host (`computersReopen(host)`), so the local board is never held up by a slow
   remote.
3. The page checks the host against /api/remote/computers (the switcher's own list), then:
   - on the account and switchable: the same ticket path and switching screen as a click;
   - signed out of Kosmos+, offline, or unable to take the instant switch: stay home, with one line in the switcher's
     wording (#6585), naming the computer;
   - no longer on the account (or a host under another domain): stay home, say so, and tell the app to forget it.
   - the list does not answer in 6 s, or the person clicks or types meanwhile: stay home (review 1: a late switch
     would take unsent text with it).
   The page's answer reaches the app through `reopenAnswerKeeps`: 'opening'/'busy' keep the host, a page with no
   reopen (a sign-in page) asks again at the next board load, everything else forgets it.
4. Windows and iPhone: say on the card what each does today; Mac first.

## Decided
- Persist always (the card's weakest premise: someone who quits to get home has one extra click).
- The page, not the app, decides reachability: one rule shared with the switcher, no second copy in Swift.

## Weakest premise
That the launch's first finished load is always the local board. A redirect or the sign-in page first would need
the reopen to wait for the board page proper (handled since review 1: a page with no reopen asks again at the next
board load).

## Review round 1 (opus; no BLOCKER)
- WARNING: the host outlived a session spent at home --> FIXED (the kept value is the window's last computer; see 1).
- WARNING: a slow list could pull the window away after the person started working --> FIXED (6 s limit, stops on
  pointerdown or keydown).
- CONVENTION: plan and code disagreed on forgetting --> FIXED (this file).
- NITs fixed: signed-out wording also covers remote access off, with no "switch from the menu"; "is not on your
  account"; a host under another domain is gone; connect forgets; a sign-in page does not spend the launch's reopen;
  a test runs the shared switch with no link.
- NIT kept: a host kept in run mode survives a reset to an unchosen mode, so after the first-screen answer the window
  goes back to that computer. It is still the computer the window was last on.

## Review round 2 (sonnet; no BLOCKER) and Angel's switcher review (read at 27fd49b898)
- WARNING (r2): a reload while the reopen waits could make the torn-down page's failure ask again --> FIXED: every
  finished load is counted (`pageLoadSerial`) and an answer from a page since replaced is ignored.
- WARNING (r2): an automatic own-board reload after the ask counts as going home --> KNOWN LIMIT, kept: no in-app
  trigger found (the #1042 notice does not reload); the cost is one launch opening home.
- WARNING (r2): typing during the ticket wait --> FIXED: the reopen blurs the focused field before switching, and the
  guard also watches wheel and touchstart.
- CONVENTION (r2): source-text tests for a state machine --> FIXED: `reopenStep` is a pure decision with 14 rows in
  the selftest; the wiring test checks each arm does what the step says.
- WARNING (Angel): 6 s was below the route's own worst case (20 s Mac request plus 4 s per off probe) --> FIXED: 30 s,
  OA_COMPUTERS_LIMIT_MS's value and reason; the touch guard protects unsent text meanwhile.
- WARNING (Angel): a passing failure forgot the computer, which brings back the card's complaint --> CHANGED from
  round 1's call: only FINAL answers forget (gone, home, touched, signed-out, bad); slow, unknown, updating, offline
  and not-instant keep it. A later own-board load in the same launch still forgets. Signed-out forgets on purpose,
  against Angel's suggestion: remote access off is usually deliberate, and keeping it repeats the toast every launch.
  Weakest premise (Angel's): a session at home after a failed reopen with no board reload keeps the host, so the next
  launch goes back, one click from home.
- NIT (Angel): the rule was a second copy --> FIXED: `computersOpens(c)` and `computersOlderSaid` shared by the menu
  and the reopen, and the reopen ends on the shared rule.
- NIT (Angel): the menu hides itself under two rows, the reopen does not --> NO CHANGE: the reopen only needs the
  remembered computer's own row.
