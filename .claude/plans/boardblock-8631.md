# #8631: Report, Block and a Blocked list on the desktop board (the board's half of #8625)

Card: joshualeestone/kosmos#8631. Built on Angel's reportblock-8625 (the routes); this branch waits for #8625 to reach main
and is rebased onto it before its PR.

## What finished looks like

On the desktop board, a message from outside this Kosmos offers Report (the phone's mail, to hello@installkosmos.com,
subject "Kosmos report: ...", with the sender's account from the sender route) and Block (asks first, then POST .../block);
Settings, Your Profile lists blocked people with Unblock; a room where a block hides messages says so in one line.

## Decided

- **Report and Block are quiet text buttons on the outside message's time line**, always shown. Rejected: hover-only (a
  person at the computer may never find the only way to act on an outside sender); the room's "..." message menu (outside
  rows have no reaction bar to hang it on, and adding one brings reactions to rows that never had them). The first build
  gave them a row of their own above the time; they now share the time's line. That line is 44px tall for the
  press target, so an outside bubble is still about 24px taller than before; accepted for a control a person must be able to hit.
- **Never on the person's own post from another computer** (`sameAccount`) and only for an `x-` id, the routes' own rule.
- **Report opens a mailto AND copies the report**, and the line under the composer says both. A computer with no mail app
  opens nothing and reports nothing, so the copy is the fallback the phone's reportCopiedNote gives.
- **Block uses the delete dialog's shape** (#7614): both buttons name the act, "Don't block" takes focus. The words are the
  phone's blockAskBody with this computer's place for Unblock (Settings, Your Profile).
- **The Blocked list lives in Settings, Your Profile**, as its own box. Rejected: a new Settings tab (a nav pill for one
  list); Kosmos+ (that section is about the subscription). Hidden when GET /api/blocked fails, "No one is blocked." when
  empty (the phone's rule).
- **The room note needs the server to say so**: the room route's JSON answers carry `hiddenBlocked` (how many of this
  room's rows a block hides), never sent as 0; the text view an agent reads is unchanged. Words: "N messages are hidden
  here because you blocked who sent them." (not "from people you blocked": one person can send them all).
- After Block, the window's held rows of that person are dropped (the window merge only adds), then the room is read.

## Weakest premise

That a mailto from the board's page reaches a mail app on the person's computer. In the Kosmos Mac app's web view it may
not; the copied report and the line under the composer are the fallback, not a guarantee. Not tested inside the Mac app.

## Tests

- server.room-block-8631.test.js (3): no hiddenBlocked before a block (both arms), the count after (whole room and a
  page, CONTROL: the rows really left; the text view unchanged), gone after Unblock. CONTROL run: with the field removed
  from the route, 1 of 3 fails.
- docs/browser-checks/render-room-block-8631.js (70, light and dark): the buttons, 44px and drawn; never on sameAccount
  or a non-x id; the report body line for line; Block asks, posts, drops the held rows, closes; a refusal keeps the dialog
  with the reason; the note's two wordings and its CONTROL; the Blocked list's failed, empty and one-person states and
  Unblock. CONTROL run: with the Report markup renamed, 6 fail.
- Live on a throwaway board (scratch script, not committed): Block through the real buttons hides both of one person's
  messages and not another's, the note shows, its link opens Settings, Your Profile, Blocked with the person and Unblock.
  No page errors, light and dark.
- server.room-block-8625.test.js still passes (9).
