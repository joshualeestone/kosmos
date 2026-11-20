# dlkey-8790: downloads work over Kosmos+ on a browser with no Sec-Fetch-Site (kosmos#8790, step 2)

Finished means: over Kosmos+, on Safari before 16.4, a file download, a folder zip, an agent's export, an attachment
download and the diagnostics file each save the file instead of being refused; at the computer itself nothing changes;
on a current browser the download still works (one extra small request first).

## Design (Baron Draxum, owner of the relay rule #3838, accepted it with six conditions, Fleet Builders m5149)
- engine/boardauth.js: mintDownloadKey(target) / redeemDownloadKey(key, target). 64-hex random, in memory, 60 s,
  single use, at most 200 live. A key presented for another address is NOT burned.
- server.js: POST /api/download-key {path} mints one, only with the board token itself (boardTokenOkWithoutCookie:
  never a session cookie alone, never a key), only for one of five download routes (DL_KEY_ROUTES), never for a
  ?check=1 look. The central gate accepts ?bdl=<key> LAST, only when nothing else is presented, on a GET (not HEAD) of
  exactly the address it was minted for (path, and the query without bdl, written the URLSearchParams way). The
  request it opens is the only one boardTokenOk then says yes to (a WeakSet). No cookie, no session. safeLogUrl
  redacts bdl like token and boot.
- web/index.html: one click listener (on window, bubble phase, see round 1) on <a download> links to those routes, on
  a Kosmos+ address only: mint with the page's marked fetch, then open the same address plus bdl. No key: the link
  opens as before. At load the page asks once ({ask: true}, no key made) whether this browser needs keys at all.

## Round 1 review changes
- The page listener is on window in the bubble phase and leaves any click another handler took (an attachment card
  opening its preview; the Mac app viewer's own kdl link) and modifier clicks. Round 1's capture-phase listener made
  an attachment card download instead of opening its preview (BLOCKER, measured).
- A browser that sends Sec-Fetch-Site is answered {key: null, needed: false}, and the page leaves its links alone
  after that: no key is left live on a current browser, and no extra wait after the first download.
- A key counts only as a literal bdl= (an encoded name, which safeLogUrl would not redact, opens nothing), and only on
  a request that presents no other credential (a wrong token header or a live session beside it).
- (Round 4 removed what round 1 added here: boardTokenOk no longer answers yes for a key-opened request. A key opens
  the gate and nothing after it; a handler that later asks boardTokenOk refuses, failing closed.)

## Round 2 review changes
- refuseDownload answers a key-opened request 204 with nothing to save, as it does a navigation (old Safari sends no
  Sec-Fetch-Mode, so a refused keyed download was JSON that WebKit can save as the file).
- The page asks once at load whether keys are needed, so a current browser's downloads start in the click itself.
- A key is refused on a request that says Sec-Fetch-Site cross-site or same-site, and is read from the query only.
- Not done here, on purpose: a walk through the real relay on old Safari. That needs a release with the connector
  rebuilt; it is the card's last check before closing (#8790).

## Round 3 review changes
- A refused load-time look (403, or 404 on a board without the route) counts as "no key needed", so a board that
  cannot give keys leaves current browsers' downloads in the click.
- A key is refused on any request carrying Sec-Fetch-Site (only old Safari is ever given one), so a copied key opens
  nothing in a current browser.
- Only Cmd and Ctrl clicks are left to the browser; Option-click (Safari: download linked file) takes a key.
- Known and accepted: the attachment route and the gate's own 403 still answer JSON rather than 204; a refused keyed
  attachment on old Safari can still be saved as a small JSON file (the same as before this branch, where every such
  click was refused). Untested premise: WebKit asking for a keyed file twice (an iOS confirm sheet, a Range resume)
  would find the key spent; to measure in the real old-Safari walk.

## Round 4 review changes
- boardTokenOk no longer answers yes for a key-opened request (that line did nothing today and would silently grant
  the person's standing to any later check); a key opens the gate only.
- A keyed GET on a download route that the gate refuses (a spent, expired or unknown key) answers 204 with nothing to
  save, and so does a keyed request for an attachment that is gone; without a key, and for a ?check=1 look, the
  refusal is the JSON it was. WebKit saved the JSON as the file (measured by the reviewer).
- Shift-click is left to the browser (Safari: Reading List); Option-click takes a key.
- Measured, the reviewer's open premise: the relay copies Sec-Fetch-Site to the board (proxy.rs, the header copy loop
  drops only hop-by-hop, Host, the board token and session headers, and the board page header).
- Open, reasoned: the relay's own request logs; the key is single use and a minute long, and the relay logs a
  refused path, not its query, as far as read. To confirm with the relay owner.

## Baron's conditions, where each is held
1. first use, a real GET only; a probe or HEAD neither burns nor reads: redeemDownloadKey, downloadKeyOk (GET only),
   downloadKeyTarget (?check=1 is no target). Tests: server HEAD and ?check=1 cases.
2. exact match, no prefix, no other route: engine and server "another path or query" tests.
3. never logged: safeLogUrl; gate-log test reads the real log.
4. no session: "sets no cookie" assertion.
5. mint behind the full token, no-store: mint tests.
6. no tunnel change.

## Weakest premise
That old Safari starts an <a download> clicked from script after an awaited fetch (outside the click's activation).
Measured in Playwright WebKit and Chromium; old Safari itself is not available to run. If it does not, the fix is a
pre-minted key per link, not a change to the board.
