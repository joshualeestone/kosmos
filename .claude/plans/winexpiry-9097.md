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

- engine/status.js (review 1 BLOCKER): the login WARNING learns each agent's folder from tmux plus `ps eww`, neither
  of which exists on Windows, and an agent whose folder is unknown is skipped on purpose. So on Windows it now takes
  the folder from the agent's launch job instead (win32JobCcd): `configDir`, or null for a default-account agent. An
  agent with no readable Claude job is still skipped. On macOS the job cannot be used (the #2129 class: the Keychain
  entry's name depends on whether CLAUDE_CONFIG_DIR is set at all), but off macOS the credential is a file in the folder
  itself, so the job's folder is the one read.
- Review 1: with CLAUDE_CONFIG_DIR unset, the folder is `<os.homedir()>/.claude`, the folder Claude Code itself reads.
  A sandboxed board sets its own HOME, so its default folder falls outside the real home and is refused, rather than
  reading the operator's own file (as usagepoll's review 7).
- A visible effect beyond the warning (review 1): once a Windows or Linux Claude row has a login date, ruling A's
  green-from-login applies to it, as it already does on the Mac. The row can then read green from its login date.

- Review 2: off macOS, an agent whose folder is <HOME>/.claude spelled out and one with the variable unset read the same
  file, so the warning buckets them as one login (the default). Otherwise the same login warned twice, and the explicit
  one named no row. On macOS they stay two (the Keychain entry names differ).
- Review 2: claudeloginlive has a test seam for the credential read (setCredReaderForTests), so a test shows that the
  row's read runs off macOS and passes the folder. Its NODE_TEST_CONTEXT guard still keeps every other test off real
  credentials.
- Which platform gets what: the file read is for Windows AND Linux. The job-folder source for the warning is Windows
  only; on Linux the warning still reads each agent's folder from tmux and `ps eww`, which Linux has.

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
- Review 1: the Windows warning, through computeLoginAdvisories with platform win32, names the default-account agent
  and the agent on its own folder, and never the non-Claude one. Control: the pane reader Windows used before (which
  finds no folder) gives no warning.
- Review 1: a sandbox HOME is never read as the real default; control: HOME at the real home reads it.
- Review 2: one bucket on Windows for the explicit default and the unset folder (control: two on macOS); the row's read
  reaches the file reader with its folder (control: with no seam set, a test reads nothing).
- Mutants, each run on a committed tree and restored: the Windows branch in status.js removed turns the warning test
  red; the bucket merge removed, and the folder dropped from the row's read, each turn their own test red.
- No test calls the macOS reader for a real entry: on a Mac that would read the real Keychain.
- Not covered by a test: the real `create.readJob` on Windows (the tests inject it). Review 2 read its win32 arm: it
  returns `{ configDir, runner }` from the Scheduled Task, a failed read gives null, and the agent is then skipped.

## Weakest premise
That a Windows agent's launch job names the folder its claude process really uses. Kosmos writes the job when it
creates or moves the agent, and the job is what Windows starts the agent from, but nobody has compared it with a
running process on Windows. An agent started by hand outside Kosmos has no job, and is skipped, not guessed.
