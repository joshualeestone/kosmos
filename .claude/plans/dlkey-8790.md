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
- web/index.html: one capture-phase click listener on <a download> links to those routes, on a Kosmos+ address only:
  mint with the page's marked fetch, then open the same address plus bdl. No key: the link opens as before.

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
