# otheraccounts-6178: accounts at a glance on the person's other computers (kosmos#6178, a #6176 slice)

## Done when
On a computer signed in to Kosmos+, with Kosmos open from this computer's own Kosmos+ address, Settings > AI Models also
shows each of the person's other computers: its Claude accounts by email, each account's weekly usage in the words its
own row uses, and that account's agents there by display name. A computer that cannot be read says why in one line
(not let in from this browser, not connected, an older Kosmos). Nothing about another computer goes through our server.
Tested: a server test (red on main), a page test, and a browser check in Chromium and WebKit.

## Engine
- `engine/accountsweekly.js`: `weeklyOf`, `weeklyBlockedOf` (moved out of /api/accounts, unchanged), `summary(list)`
  for /api/status, cached 60 s and keyed on the account list.
- `GET /api/status` gains `accountsWeekly: [{ dir, email, label, organization, isDefault, weekly, blocked }]`. It reuses
  the poll's one Claude list read (`claudeKnown`). Each agent already carries `account.dir`, which is the join.

## Page
- `#set-other-wrap` under the account list. `aoPaint` draws it from `AO_SEEN`, which `oaReadOne` (#4812) fills through
  one guarded call (`aoKeep`): a fresh answer replaces, not-let-in forgets, no answer keeps the last (said with its age).
- `oaRound` also reads while AI Models is on screen (`aoShown`), even with the Agents view's "This computer only" ticked.
  `paintAccounts` calls `aoKick` (paint, then a round).

## Decisions
- Read by this browser from each computer (the #4812 sibling path), not through the coordinator. Rejected: Macs report
  usage to the coordinator for siblings (agent names and account emails at rest on our server; whoever holds the
  coordinator reads them). Rejected: board-to-board (a board holds no device session by design). Rejected: a new
  sibling-read route in the tunnel (/api/status is already the one route, and a new one needs a tunnel release first).
- No new tunnel or coordinator code. Older computers: no accountsWeekly, so "an older Kosmos", never a guess from agents.
- Usage is not summed across computers: each computer reads its own statusline; the same account on two computers is
  shown on each with its own age. The note says so.
- No warning and no Move for another computer's accounts: both act on this board's engine.
- The usage sentences are this page's own, pinned to acctUsageHtml's by a test that reads the row's source (lifting
  acctUsageHtml to run it needs most of Settings).
- `#4812`'s functions keep their exact shapes (its tests pin oaRemember and oaAgentsOf); my data has its own store.

## Weakest premise
The page must be served from this computer's Kosmos+ address. From the app's own 127.0.0.1 board the other computers'
cookies are never sent, so there the section says, only when the account has another computer, where to see them.
If most people only ever open the local board, the coordinator path rejected above needs a privacy ruling.

## Not in this slice
- Summing one account's usage across computers.
- A link to this computer's Kosmos+ address from the local board's line (worldswComputersSeen is lifted alone by tests).
