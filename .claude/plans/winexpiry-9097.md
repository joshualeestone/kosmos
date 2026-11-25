# winexpiry-9097: a Claude login's expiry, read off macOS too

Card: kosmos#9097 (Josh, 11-25 17:16: renew a Claude sign-in through Kosmos, not PowerShell). Sized by Splinter's
correction (17:21) and Homer's measurements (17:3x).

## The real gap
- Renewing already works on every platform: Settings > AI Models > Sign in again, and the login-expiry warning's
  Refresh login button, both drive Claude's own sign-in out of sight (connect.js on the Mac, win32signin.js on Windows).
- But the board never LEARNED a Claude login's expiry off macOS. engine/loginexpiry.js read it only from the macOS
  Keychain, and claudeloginlive.js (the account row's "Expires in N days") read only on darwin.
- Homer measured it on the Windows box (0.8.24, 11-25). (a) `C:\Users\<user>\.claude\.credentials.json` carries
  `claudeAiOauth.refreshTokenExpiresAt` (2026-11-29T02:37:55Z, the instant `claude auth status` reports), and it is the
  only such file. (b) /api/status has `"loginAdvisories":[]`, although the login ends in about 3 days. So Windows never
  warned, and Josh met the expiry somewhere else, then was sent to a terminal.

## The change
- engine/loginexpiry.js: off macOS, both readers (readCredDefault and readCredAsync) read
  `<CLAUDE_CONFIG_DIR, or <home>/.claude when unset>/.credentials.json`.
  - This is the same rule usagepoll.readCredFor already uses for the same credential.
  - A folder outside the real home (os.userInfo().homedir) is never read, as in usagepoll's review 14: a sandboxed
    board's folders are not the operator's.
  - Fail soft: a missing, unreadable or bad file gives no advisory.
  - Only the two dates leave the parse, as before; the tokens never do.
  - The sandbox override (KOSMOS_BC_LOGIN_UNTIL_MS) still answers first. The Mac path is unchanged.
- loginTimesFor passes the folder to the reader beside the service name, so the injected readers that tests use keep
  working (they ignore the second argument).
- engine/claudeloginlive.js: the account row's live read runs on every platform. It passes the folder through, and
  readCredAsync picks the Keychain or the file by platform.

## Not changed
- engine/connect.js readRefreshExpiry, the proof that a Mac sign-in finished. It stays macOS-only: Windows sign-in
  completes through win32signin.js's own path, and changing that proof is outside this card.
- No UI. The existing warning, its Refresh login button and the row's lead Sign in again show on Windows once an
  expiry is known.

## Tests (engine/loginexpiry-file-9097.test.js)
- On Windows the default account reads <home>/.claude/.credentials.json, and a named CLAUDE_CONFIG_DIR reads its own
  folder.
- Only the two dates leave the reader.
- A folder outside the home, a missing file, a bad file, and no home all read as nothing.
- The async reader reads the same file off macOS.
- An advisory is built on Windows three days out. Control: the old behaviour (a reader that finds nothing) gives none,
  which is the 11-25 Windows board's empty list.
- No test calls the macOS reader for a real entry: on a Mac that would read the real Keychain.

## Weakest premise
The warning (status.js computeLoginAdvisories) learns each agent's CLAUDE_CONFIG_DIR from its live process. Where
Windows cannot read that, an agent counts as on the default account. On Homer's box every agent is on the default
account, so the warning is right there. On a Windows PC with several Claude accounts, an agent's warning could name
the default account's date. The account row (claudeloginlive) reads each account's own folder, so it is right either
way.
