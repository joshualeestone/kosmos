# recheckapp-6404: the app half of one fresh code check for a pair already allowed

Card: joshualeestone/kosmos#6404 part 2 (design comment 6239794946). Tunnel half: kosmos-relay branch recheck-6404
(`join recheck`, JoinStatus `can_recheck` / `rechecking` / `recheck_with`, recheck rows in `devices pending`).
Stacked on typedcode-6404 (PR #6424: the Allow card's typed-code field, which a check reuses).

## Finished looks like
On the joining computer, once allowed with its code run out unconfirmed: the ending says "<A> allowed this computer.
Its code ran out before The codes match was pressed here." and "To finish, check the code with <A> once.", with a
Check the code button, also on a page loaded later. Pressing it asks the tunnel (`POST /api/remote/join/recheck`,
screen-only), the page polls while the check runs, and shows "Finish the code check with <A>" with three steps and the
code large. On the allowing computer the check shows as "Your computer "<B>" wants to finish its code check", one
typed-code field, a Confirm button (Confirm sends the typed code; then "The code check with <B> is done here. Now press
The codes match on <B>."), and Not me cancels only the check ("It stays connected."). Without a tunnel that offers the
check, everything reads as before.

## How it works
- engine/remote.js: `joinRecheck` (`join recheck`; refusals tagged); `joinStatus` passes `can_recheck`, `rechecking`,
  `recheck_with`; pending rows pass `recheck`.
- server.js: `POST /api/remote/join/recheck`, screen-only like Try again.
- web/index.html: `plusJoinLive` counts `rechecking` (not once confirmed); `plusJoinTick` makes the ran-out ending
  when `can_recheck` (the probe's one read on load covers a later load) and keeps whether a check can be asked for ON
  the ending (`PLUS_JOIN_NOTE.recheck`), because paintPlus forgets the last answer once the pairing is not live; `plusJoinRanOutHtml` words the ending with or without the button; the
  code branch words the check's steps; the Check the code handler. On the allowing side `askHead`, the sentence, the
  button label, the done row and the cancelled row say what a check is.

## Calls
- The joining computer polls only while a check it asked for runs (each read is a signed round).
- Not me on a check says the computer stays connected (computers are not in the Devices list, so no "remove it there").
- Weakest premise: a board on an older tunnel never sends `can_recheck`, so it keeps the old ending; the button never
  shows there.

## Steps
1. engine, server, web/index.html as above.
2. Tests: server.test.js (the route is screen-only, with a control); web.allow-card.test.js re-anchored;
   render-connect-sheet-4637.js arms for both screens (CONTROL: the existing ran-out arm without `can_recheck` keeps
   the old words and no button). README row.

## Review log
- 1 opus: the button vanished on the next repaint (BLOCKER: kept on the note now; the arm reads twice and counts
  rounds); no "you said no ... password" on a check; confirmed during a check is not live; a check's refusals say
  Confirm and never show a tag; "Checking the code with"; several checks' notice wording; each check row has its own
  time (tunnel), so a dismissed notice does not hide a later check.
- 2 sonnet: Not me on a check no longer notes the computer as refused (the page says recheck; deviceDeny skips the
  note); an answer to an earlier check is forgotten when a check with another time arrives under that id; engine tests
  for joinRecheck and the status fields; the check-ended and tries-used arms; only lapsed/key refusals get the check
  sentence; the stale branch skips while a check runs; the allow-card regex anchored to the button.
