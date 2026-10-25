# fetchsite-7075: native requests to a Mac say they are the board's own

Card: kosmos#7075 (priority). Found by a blind review of #7074 and traced through the code on both sides.

## The defect
- A real Mac enforces its board token (server.js: `boardAuthState.on = boardauth.enforced(...)`; "A prod board (nothing
  sandboxed) enforces"), and refuses any `/api/` request without it (403).
- Through Kosmos+, the tunnel adds the token only to an admitted request whose `Sec-Fetch-Site` is `same-origin` or
  `none` (kosmos-relay crates/tunnel/src/proxy.rs `board_token_allowed`, since 2026-09-25; none is refused).
- URLSession sends no `Sec-Fetch-Site`, so every native screen's request reached the Mac without the token. The app's
  web view was unaffected (WebKit sends the header). Sample-data screenshots never touch a Mac, which is why nothing
  showed it.

## Finished looks like
On main, every request the app sends to a Mac carries `Sec-Fetch-Site: same-origin`, and requests to Kosmos+ itself do
not: BoardClient (all tab reads, sends, the gate sign-in, uploads), Settings' phone-notify, the notification's Reply,
Allow/Deny and their reads, and the notice extension. Tests in run.sh, run-actions.sh and run-settings.sh fail if any
sender drops it. The device check (a real iPhone through Kosmos+ loads the Agents list) joins #6838's list.

## Change
- BoardLogic.swift: `Board.forMac` (marks a request whose host is not the coordinator's) and `fetchSiteHeader`.
- BoardClient.swift: the init wraps env.send and env.upload with Board.forMac, once, so no call site can forget it.
- NotificationActionLogic.swift (`signed`), SettingsLogic.swift (`request`), KosmosNotice/NoticeLogic.swift (`request`):
  set the header on their Mac requests (each builds only a Mac URL).

## Decided
- In the app, not the relay or the Mac. Rejected: the tunnel giving the token to header-less requests from a gate
  session, which reopens the cross-site case #3838 closed for old browsers; and the Mac trusting its gate session,
  a wider security change.
- Safe because the header is a classification, not a credential: the gate admits only a request with a live tunnel
  session cookie, the app's jar is its own, and no website can make the app send a request. A blind security review
  (card comment 6391705062) derived the threat model independently and found it SAFE; its note (keep request hosts
  and paths the app's own) is in the code comment.

## Weakest premise
That the defect is real on devices today. It is proven from code on both sides (relay main, Mac main), not seen on a
device. If it is wrong, the change is harmless: the header is what the web view already sends.
