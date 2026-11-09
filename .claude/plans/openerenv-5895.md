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
  started the handler, and a variable outside the list did not reach it. Windows itself adds LOGONSERVER and two
  FPS_BROWSER_* variables to the started process, none of them the board's.

## Change
- engine/childenv.js: `WIN_OPENER_KEYS` and `winOpenerEnv(env)`: keeps the listed variables that are set and
  non-empty, matched case-insensitively (Windows names are, engine/win32env.js), each under the name it came with.
- engine/remote.js runCompanyOpener: win32 uses `winOpenerEnv` (it passed `undefined`, the whole environment).
- engine/remote.test.js: the #5889 win32 arm, which asserted the environment WAS inherited, is flipped and split into
  its own test (a board token and a board variable stay out, a listed variable in another case is kept under its own
  name, the proxy is kept, the opener still runs); plus a `winOpenerEnv` unit test.

Kept on purpose, as on the other platforms: the proxy variables (the person's network settings; a proxy URL can
carry a user and password, which is the person's, and the page needs it).
Weakest part: the browser itself was not started cold with the list; the measured stand-in uses the same launch path.

## Verification limits
The company-flow tests (two #5889 tests and the new #5895 arm) fail on this Windows box at `companyStart`, on
origin/main as well: they need a tunnel stub only the Mac/Linux CI runners have. They are verified by CI (the
platform is a seam, so the win32 arm runs there). The `winOpenerEnv` unit test runs here and passes.
