# #6838 slice 1: the iPhone app connects to the Mac by itself and shows a native Agents tab

Josh, #admin 2026-10-21 09:03: he wants the app actually native, not web views. The plan for the whole move is on
the card (and as a PDF handed to Josh).

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
   view's; the KST from `SessionKeychain`; picks the Mac (the one remembered while connected, else a connected one seen most recently).
3. `ios/Kosmos/AgentsView.swift`: the native list (Mona's Agents design: name, role, the computer's status word),
   the waiting-for-Allow state with the match code, and plain sentences for signed out, no Mac, Mac not answering.
4. `ContentView`: a `TabView` with Agents (native) and Board (today's web view). A tap on an agent opens the web view
   at `?tab=detail&agent=<sessionName>`, as a notification tap already does.

## Weakest premise

That a native `URLSession` POST to `/_kosmos/session` is admitted like the page's fetch. Half measured: the gate's own
test pins `origin_ok_for_state_change(None, None, OWN)` as allowed (gate.rs, "a legacy client with neither header").
Not yet measured end to end: that needs a phone signed in to Kosmos+, so the first TestFlight run is the measurement.
If it is refused, Kosmos+ needs a small route (2 to 3 days, the plan's risk line).

## Decided

- Status words are decided on the phone in this slice (one table, tested). The plan's Mac-side change (item 2) will
  send them ready-made; until then the table mirrors the board's states.
- The native client never shares the web view's cookies. Its Mac session is kept in the Keychain (only the cookie,
  tied to a fingerprint of the Kosmos+ session) and reused across launches: the gate keeps at most 16 sessions per
  device and drops the least recently used, and this app shares its device with the Board tab, so a new session every launch would
  in time sign the Board tab out.
- Status words follow engine/cardlabel.js labelOf (the computer's words), not Mona's "Asked you": the card's done
  line is "the status the computer shows". Built to Mona Lisa's slice 1 spec (#6838): Question in gold, needs you in red,
  Working green, the rest quiet; the app opens on Agents.
- The connect, poll and reconnect loop is tested: BoardClient takes its network, clock, waits and defaults as an
  Environment (the app's real one is in BoardClient+App.swift), and ios/LogicTests drives it against a fake Kosmos+
  and Mac with a clock that advances on every wait. Covered: a fresh connect, a kept session reused, a kept session
  the Mac has ended (signs in fresh; this was a real bug review found), the 15 s 401 grace and the reconnect after
  it, an account switch and a sign-out, Try again after not answering, and waiting for Allow. Each was measured red
  with its rule removed. Not covered: the real URLSession, cookies set by a real Set-Cookie, and real timing.
- Known cost: a kept record is deleted when its session ends or never answers; after a relaunch the app then holds
  no copy of that cookie, so the gate cannot be told to drop the old session (it ages out, least recently used
  first). Bounded by the 16-per-device cap; keeping a dead cookie only to name it as replaced is a later nicety.
- Deferred: the App Store screenshots (ios/store/shoot-app.sh) now show the tab bar. That is the real app.
- Deferred: a tap on an agent opens its chat in the web view, whose Mac session is its own. If the web view has never
  opened that Mac, the tap lands on the gate's sign-in (and possibly Allow) first, exactly as a notification tap does
  today. Native Chat (the plan's next screen) removes it; handing the web view a fresh handoff is the stopgap if the
  first phone runs show it is common.
- Unmeasured: the kept Mac session is tied to a fingerprint of the exact Kosmos+ session, so if the sign-in page
  re-issues the session for the same account (it can, for example after enrolment), the kept cookie is dropped and one
  new gate session opened. Safe, but it weakens the reuse; keying on the account instead needs the account id, which
  the app does not hold today. Watch for it on the first phone runs.
- An agent tap (like a notification tap) is opened by the Board tab's web view: an existing one loads it on update,
  and one made later loads it when it is made (WebView.makeUIView reads boardToOpen). Not run in the simulator with
  a tap (it cannot tap here); the first TestFlight run checks it with the sign-in path.
- Not covered by the loop tests: how Foundation keys a cookie from the gate's real Set-Cookie (host-only __Host-)
  against one the app restored. keepMacSession keeps one, the value that is not the restored one, and removes any
  other of that name, so a mismatch cannot leave the ended cookie in use.
- The Agent.needsYou field mirrors the board's engine/status.js needsPerson exactly, case by case in the tests (a
  plain sign-in failure is not one, as on the board). The red, listed-first set on screen is wider: needsPerson plus
  the words the spec marks red (Board.needsYouWords: Needs permission, Issue, Rate Limit, Sign-in isn't
  working, Connection lost, Waiting, Not running, Can't tell), as agreed with
  Mona Lisa on the card.
