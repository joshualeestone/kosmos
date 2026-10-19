# launcher-rebuild-6512: the Windows window signs itself in again; Kosmos.exe rebuilt and re-signed

Card: #6512 (from the #6409 gap list, items B1 and B2).

**Posture:** production

## Change
- tools/windows/KosmosLauncher.cs: the window hears the page's `{ kosmosSignin: true }` (web signedOutTellApp,
  #6449) from the board's own page only, and answers it with SignInAgain (the double-click path: a fresh `?boot=`
  address from open-board.js). Pure `SignInAgainDecision` mirrors the Mac's signInAgainDecision: sign in at once,
  then at most once a minute; give up after 3 sign-ins with no board read or with no board token; then stay out
  until a badge post (a board read that worked). Connect computers ignore it. No token in any address.
- tools/windows/Kosmos.exe: rebuilt with the README's csc flags and Authenticode-signed (Kosmos Agent Manager, Inc.).
  Carries #6437 and #6449 too.
- tools/build-kosmos-windows.sh: refuses a cut when the last commit touching KosmosLauncher.cs is not an ancestor of
  (or equal to) the last commit touching Kosmos.exe (issue item 3). Skips with a note when there is no git history.

## Tests
- tools.win-launcher-signin-6512.test.js: wiring; a compiled probe of IsSigninPageMessage and SignInAgainDecision
  (Windows); the git-order check (red before the rebuild commit, green after); verify-launcher.ps1 (Windows).
- tools.win-launcher-board-proof-1765.test.js: ReadBoardToken() count 5 -> 6 (the new use only checks presence).
- tools.windows-computer-mode-4381.test.js: OnWebMessage shape allows the sign-in line after the connect return.

## Verified on the Windows box
- Signature Valid; verify-launcher.ps1 OK (it reported MISMATCH on main).
- Live against a sandboxed test board (port 16299): the new exe's window signed itself in about 0.3 s after a board
  restart; the exe on main stayed signed out (403) for 90 s.

## Decisions
- A page-asked sign-in comes back on the page the person was on (SignInAgainAddress, the Mac's signInAgainPage):
  path and query of a board page only, on open-board.js's own host and port; a double-click still lands on the
  front page as before. Rejected: always the front page (a board update would throw every window back to the
  start with nobody asking).
- Giving up changes nothing on screen: the Windows signed-out panel always says to open Kosmos.exe again, and
  `?signin=failed` means nothing to the Windows panel. The launcher keeps no log, so the give-up is not recorded.
  Weakest part: a stuck window is not diagnosable from logs. Would change if the launcher gains a log.
- No `refused` input (the Mac reads it from a kept `?token=`; a `?boot=` nonce leaves nothing): the 3-try cap covers it.
- The git-order check also runs as a test on every PR, not only at the cut: a source-only edit, even a comment, goes
  red until the Windows box rebuilds and re-signs the exe on that branch (written in tools/windows/README.md). That
  is the existing "rebuild in the same commit" rule, now enforced. Rejected: cut-time only (drift then surfaces on
  release day, which is how #6437/#6449 slipped).

## Not done
- The Windows signed-out panel copy (windowsCopy signinPanel) still says to open Kosmos.exe again: still true as the
  fallback for an older window, and it shows only for a moment now. The comment above signedOutTellApp is updated.
- The give-up branch is covered by the probe only, not live.
