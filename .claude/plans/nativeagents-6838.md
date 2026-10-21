# #6838 slice 1: the iPhone app connects to the Mac by itself and shows a native Agents tab

Josh, #admin 2026-10-21 09:03: he wants the app actually native, not web views. Plan for the whole move:
`/Users/agent1/work/workers/angel/Files/kosmos-iphone-native-plan.pdf` (on the card too).

## Finished looks like

On an iPhone signed in to Kosmos+, a native **Agents** tab lists the agents on the chosen Mac with the status the
computer shows (needs you, working, idle, and the rest), refreshes every 5 seconds while open, and tapping an agent
opens that agent's chat in the existing web view. The web board stays as the other tab. Built and run in the
simulator; logic covered by `ios/LogicTests`.

## What exists (read from source, 2026-10-21)

- The app keeps the Kosmos+ session (KST) in the Keychain (`SessionKeychain`), captured by the sign-in page bridge.
- Kosmos+ (kosmos-relay coordinator): `GET /v1/account/macs` with `Authorization: Bearer <KST>` answers
  `{macs:[{name,address,last_seen,retired_at,remote_off,not_connected,held,refused,...}]}`;
  `POST /v1/account/handoff` `{address}` answers `{token}` (the sign-in page uses it to open a Mac).
- The Mac's tunnel gate: `POST https://<address>/_kosmos/session` `{token}` (JSON). 200 sets the session cookie
  `__Host-kosmos_tunnel_session` (HttpOnly, Secure, SameSite=Lax, a year). 403 `{pending, code?}`: the Mac is showing
  Allow, ask again every 3 s. 403 `{denied}`: refused. 400 while waiting: a slow network, keep waiting. Other: error,
  `because` says why. Its cross-site guard allows a request with no Origin and no Sec-Fetch-Site (a native client).
- The board: `GET /api/status` (through the tunnel, which presents the board token) answers `agents[]` with `name`,
  `sessionName`, `role`, `state`, `task`, `because`, `awaitingApproval`, `hasAvatar`.

## Design

1. `ios/Kosmos/BoardLogic.swift` (pure, no UIKit, tested in LogicTests): request builders for macs, handoff, session
   and status; the session answer classified (admitted, pending with code, denied, retry, refused with reason); the
   status JSON decoded into agent rows; one status word per state, written once here.
2. `ios/Kosmos/BoardClient.swift`: one `URLSession` with its own cookie store for the Mac session, never the web
   view's; the KST from `SessionKeychain`; picks the Mac (the one remembered, else the first live one).
3. `ios/Kosmos/AgentsView.swift`: the native list (Mona's Agents design: name, role, one-word status, "Asked you"),
   the waiting-for-Allow state with the match code, and plain sentences for signed out, no Mac, Mac not answering.
4. `ContentView`: a `TabView` with Agents (native) and Board (today's web view). A tap on an agent opens the web view
   at `?tab=detail&agent=<sessionName>`, as a notification tap already does.

## Weakest premise

That a native `URLSession` POST to `/_kosmos/session` is admitted like the page's fetch. Read from gate.rs, not yet
measured; this slice measures it. If it is refused, Kosmos+ needs a small route (2 to 3 days, the plan's risk line).

## Decided

- Status words are decided on the phone in this slice (one table, tested). The plan's Mac-side change (item 2) will
  send them ready-made; until then the table mirrors the board's states.
- The native client never shares the web view's cookies; a separate session per app install, like a second browser.
