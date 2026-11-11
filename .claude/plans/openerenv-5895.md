# openerenv-5895: the Windows company sign-in opener gets a measured environment list (kosmos#5895)

**Posture:** production

Follow-up to #5889, which gave the opener a desktop allowlist on macOS and Linux and left Windows passing the board's
whole environment, because no Windows list had been checked on a Windows machine.

## Measured on the Windows box (2026-11-09)
- The premise: a program started by `rundll32 url.dll,FileProtocolHandler <url>` (the opener, through ShellExecute)
  inherits rundll32's environment, not Explorer's. A per-user throwaway URL scheme whose handler recorded its
  environment received a marker variable the caller set, and the caller's PATH. Edge, the default browser here, is
  registered as a plain command line (`msedge.exe --single-argument %1`, no DelegateExecute), the same path, so a
  browser started cold got the board's environment, tokens included. Edge was not closed for a cold-start test (the
  person's running browser); the stand-in handler measured the same mechanism.
- The list: with ONLY the card's 24 candidates present (plus ALL_PROXY), matched case-blind, rundll32 exited 0 and
  started the handler, and a variable outside the list did not reach it. Two things add to the list, neither a secret: node's
  process layer (libuv) copies a fixed set into any Windows child that lacks them (HOMEDRIVE, HOMEPATH, LOGONSERVER,
  PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR), and the browser adds two
  FPS_BROWSER_* profile ones.

- Edge itself started cold (2026-11-11): headless, with its own throwaway profile so the person's running Edge was
  not used, msedge.exe rendered a page with ONLY this list, and also with an EMPTY environment and with SystemRoot
  alone. So a variable missing from the list cannot stop Edge from starting; the list decides only what it inherits.

## Change
- engine/childenv.js: `WIN_OPENER_KEYS` and `winOpenerEnv(env)`: keeps the listed variables that are set and
  non-empty, matched case-insensitively (Windows names are, engine/win32env.js), each under the name it came with.
- The CommonProgramFiles family and ALLUSERSPROFILE are added to the list (no secrets; an installed browser may look it up). One entry
  per name, case-blind, first spelling wins, so a child never gets PATH and Path both.
- engine/win32signin.js: the Claude and OpenAI sign-in opener (openInDefaultBrowser) launched the same
  `rundll32 url.dll,FileProtocolHandler` with the board's whole environment, the same leak. Its callers: the Claude
  and OpenAI sign-ins, and the Antigravity (Google) sign-in in win32agysignin.js. It now passes the same
  list (browserOpenCommand).
- engine/remote.js runCompanyOpener: win32 uses `winOpenerEnv` (it passed `undefined`, the whole environment).
- engine/remote.test.js: the #5889 win32 arm, which asserted the environment WAS inherited, is flipped and split into
  its own test (a board token and a board variable stay out, a listed variable in another case is kept under its own
  name, the proxy is kept, the opener still runs); plus engine/childenv.win32-5895.test.js ("win32" in its name, so the Windows CI job runs it): the list's unit
  test, the sign-in opener's command, and a real Windows child started with the list.

Kept on purpose, as on the other platforms: the proxy variables (the person's network settings; a proxy URL can
carry a user and password, which is the person's, and the page needs it).
Decided: an allowlist of the board's environment, not the person's own. A browser started cold keeps this list for
its life and passes it to what it launches (a vscode:// handler, a downloaded installer), so a person's own variables
(JAVA_HOME, OneDrive) are missing there; before this PR it got the board's whole environment, tokens included.
Rejected, measured 2026-11-11: handing the URL to explorer.exe, which does give the handler Explorer's environment
(the caller's marker did not reach it), but exits 1 even on success, and a URL with a query string never reached the
handler (sign-in links always carry one). The durable route, the person's environment rebuilt from the registry, is
kosmos#8369, with the Chrome and Firefox cold-start measurement. What would change my mind: a report of a tool
launched from the browser failing for a missing variable, which would move #8369 up.
Weakest part: only Edge was started cold. Another default browser (Chrome, Firefox) was not measured, and rundll32
exits 0 once it hands the URL off, so a browser that failed for want of a variable would read as opened.

## Verification limits
The company-flow tests (two #5889 tests and the new #5895 arm) fail on this Windows box at `companyStart`, on
origin/main as well: they need a tunnel stub only the Mac/Linux CI runners have. They are verified by CI (the
platform is a seam, so the win32 arm runs there). engine/childenv.win32-5895.test.js runs here and passes (3/3).
