# #8959 slice D2: AI Models and Connections, native on the iPhone (PLANNING, not built)

Card: https://github.com/joshualeestone/kosmos/issues/8959 (master plan 7120473038, slice D, "Native, read with a plain line"). Branch `models-8959` from origin/main 6999392572.

## Measured so far (11-28 08:5x CST, read from the code, not from a running board)
- The board's Settings has 9 sections now (web/index.html ~19320): Your Profile, AI Models (`s-sec-accounts`), Connections (`s-sec-connect`), Global Skills, AI Policies, Computer, Automation, Token Usage, Updates. D1 made Automation, AI Policies, Global Skills, Token Usage and Updates native; Profile was already. D2 is AI Models and Connections; Computer stays off the phone (master plan).
- **AI Models** calls about 20 `/api/accounts*` routes (list, per-provider sign-in and keys, subscriptions, Qwen local, share, compat). The phone already reads `GET /api/accounts` and `/api/accounts/compat` (NewAgentPicker), so the read is reachable with the phone's token. Per the master plan, signing in runs on the computer: each provider row says whether it is signed in, then "Sign in to this on your computer", no link.
- **Connections:** the page reads `GET /api/connections` (server.js ~19180), which makes a live `verify()` on EVERY door, and the search services (Brave, Exa, Tavily, Serper) meter that against the person's own paid quota (#1636). `GET /api/connections/held` (~19130) reads the disk only, never a verify, costs nothing, and is behind the same cross-site guard (the phone sends same-origin, so it passes).

- **`GET /api/accounts` is live-checked per account** (server.js ~15259, `listLive()`), and its stated invariant is: every caller is a person pressing something, never a timer. So D2a reads it on open and on a pull only, with NO repeating read (unlike D1d1's 30 s check-ins). Rejected: a timer like the check-ins (it would pay a live check per account every 30 s).
- **The phone already parses it:** `NewAgentPicker.parseAccounts` reads each row's dir, provider (acctProvider's rules), email, chosen name, key tail, label, local, isDefault, memoryShared, and `connection.badge` / `connection.state`, which is the page's one badge vocabulary across providers. D2a reuses that parser rather than writing a second one.

## Decisions so far
- The phone lists Connections from `/api/connections/held`, never from the sweep, and never on a timer. Rejected: the sweep on open (each open of a phone screen would spend the person's search quota).
- D2 splits: **D2a AI Models (read only)**, then **D2b Connections (read only, held state; pasted-key add native per the master plan, browser sign-in says "Connect this on your computer")**. Then **D2c**: with nothing left, remove `openBoardSettings`, the Settings board row and the Kosmos+ `openPage` (master plan: "When D lands"); AutomationUITests' board-row assertion flips to asserting it is gone.

## Weakest premise
That `/held` carries enough to draw each row honestly. It is the disk's record (what was saved), not a verified check, so a key that has since been revoked would read as connected. The row must say so in words (for example "saved on your computer"), or D2b reads the sweep once, on an explicit tap only.

## Still to measure before building D2a
- The page's paintAccounts: which badge values it words how (signed in, signed out, rejected, unknown), so the phone says the same words.
- Whether any AI Models row the page shows reads a route the phone token is refused.
