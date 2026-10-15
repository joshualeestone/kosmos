# otheraccounts-6178: accounts at a glance on the person's other computers (kosmos#6178, a #6176 slice)

## Done when
On a computer signed in to Kosmos+, with Kosmos open from this computer's own Kosmos+ address, Settings > AI Models also
shows each of the person's other computers: its Claude accounts by email, each account's weekly usage in the words its
own row uses, and that account's agents there by display name. A computer that cannot be read says why in one line
(not let in from this browser, not connected, an older Kosmos). Nothing about another computer goes through our server.
Tested: a server test (red on main), a page test, and a browser check in Chromium and WebKit.

## Engine
- `engine/accountsweekly.js`: `weeklyOf`, `weeklyBlockedOf` (moved out of /api/accounts, unchanged), `summary(list)`
  for /api/status, cached 15 s (the other computers' read interval) and keyed on the account list. A reading can be
  that old there while /api/accounts reads it live. On a read error it sends null, which the page words as "could not
  read its accounts", never as "no account".
- `GET /api/status` gains `accountsWeekly: [{ dir, email, label, organization, isDefault, weekly, blocked }]` (the full answer; the sibling answer keys it instead, below). It reuses
  the poll's one Claude list read (`claudeKnown`).

- Who can read it. Another computer's browser reads /api/status as a sibling read (Sec-Fetch-Site same-site), and
  #4973 cuts that answer down (server.js statusForSibling) so this computer's paths and user name stay here. #6178
  widens the SAME-SITE cut on purpose and no further (any other sibling read keeps #4973's agents-only answer, so
  this does not rest on the relay alone): `accountsWeekly` keyed by an opaque per-answer id ("a0", ...) with email,
  label, organization, isDefault, apiKey, weekly and blocked; each agent's `acct` (that id, null when it is on no listed
  account) and `runner`; `checkedAt`. API-key accounts are listed (apiKey true, no reading) so their agents join to
  them, and a Claude agent on no listed account is "could not be checked". #4973's own guard (server.sibling-status-4973.test.js)
  pins these exact fields for both kinds of read, so a later widening is a decision made there too. No folder
  path goes out. The reader is a browser that computer already admitted (kosmos-relay siblingcors-4812).
- The server test makes a real sibling read and feeds the answer to the page's own parsers, so the producer's cut and
  the consumer are tested against each other.

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
