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
1. Remember (app): when a navigation to another of the account's computers finishes, store ONLY its host
   (`<name>.kosmosplus.com`) in the app's defaults. Never a ticket, token or the full URL. Cleared by Back to This
   Computer, and by a finished load of this computer's own board that the PERSON asked for (not the launch load).
2. Reopen (app + page): launch loads the local board exactly as today. After that first load finishes, the app asks
   the page to reopen the remembered host (`computersReopen(host)`), so the local board is never held up by a slow
   remote.
3. The page checks the host against /api/remote/computers (the switcher's own list), then:
   - on the account and switchable: the same ticket path and switching screen as a click;
   - signed out of Kosmos+, offline, or unable to take the instant switch: stay home, with one line in the switcher's
     wording (#6585), naming the computer;
   - no longer on the account: stay home, say so, and tell the app to forget it.
4. Windows and iPhone: say on the card what each does today; Mac first.

## Decided
- Persist always (the card's weakest premise: someone who quits to get home has one extra click).
- The page, not the app, decides reachability: one rule shared with the switcher, no second copy in Swift.

## Weakest premise
That the launch's first finished load is always the local board. A redirect or the sign-in page first would need
the reopen to wait for the board page proper.
