# Plan: #3675, browser-check fixture boards read the host Mac's real accounts

## Finished looks like
No browser-check fixture board can list the real Claude, OpenAI, Gemini or Grok accounts of the Mac
it runs on, whether the check runs through tools/browser-checks.sh or on its own, and a test fails
if a check that boots a board is added without the protection.

## Cause (measured)
The account modules (engine/accounts.js, openaiaccounts.js, geminiaccounts.js, grokaccounts.js, and
the create/connect paths) resolve `AGENT_WORKFORCE_HOME || os.homedir()`. The fixtures sandbox
DATA, WORKERS, PROJECTS, LAUNCH, CONFIG_ROOT and CLAUDE_CONFIG, but not HOME. Measured on Agent1s
with a render-settings-nav-shaped fixture: 5 real Claude accounts and 1 real OpenAI account listed
(11 email-shaped strings); with AGENT_WORKFORCE_HOME set to a temp folder, none. (Counts only;
nothing identifying was printed.)

## Change
- `docs/browser-checks/lib-sandbox-home.js` (new, a library: it exports, so the wiring test treats
  it as one): requiring it points AGENT_WORKFORCE_HOME at a fresh temp folder unless it is already
  set to somewhere other than the real home; the folder it made is removed on exit. It sets only
  the Kosmos seam, never HOME, so Playwright still finds its browsers.
- All 56 checks that boot or spawn the board (in-process `require('../../server[.js]')`, a spawned
  `server.js`, and thread-server.js) require it at top level, before the board.
- `tools/browser-checks.sh` exports AGENT_WORKFORCE_HOME inside RUN_DIR (removed by cleanup) for
  every board it starts and every check it runs, unless the caller set a sandbox.
- `tools.browser-checks-home-3675.test.js`: every board-booting check requires the lib before the
  board (red control: removing it from render-settings-nav.js, and from thread-server.js, fails);
  a fixture with the lib lists none of a planted "real" home's accounts, and without it lists the
  planted one (the control, so the test works on CI's account-free runner); the lib keeps a
  caller's sandbox, replaces the real home and removes only its own folder; the runner exports it.

## Found while verifying: two checks were quietly using the host's real account
The first full browser-check run with the sandbox home failed two checks that pass on main
(re-run on a quiet box, main vs branch):
- **render-create-made** makes an agent on a runner-started board. It needed a Claude account and a
  Claude Code binary, both of which it had been taking from the host (`<home>/.local/bin/claude` and the
  real `~/.claude`). The runner now plants a fixture default account (`fixture@example.invalid`,
  claude_max) in its sandbox home and points `AGENT_WORKFORCE_CLAUDE_BIN` at a stand-in that answers
  `--version` and otherwise exits non-zero, so the create liveness probe fails open instead of running
  the host's real Claude Code against a real account. A caller's override is kept.
- **render-talk-fill-2622** measures the Talk box with a connected subscription. In a sandbox home the
  board's "Kosmos cannot reach a Claude subscription" bar took 45px under the box. On a developer Mac
  the "connected" verdict came from the host's real secondary accounts. The lib gains an opt-in
  `plantSubscribedClaude()` (a secondary `~/.claude-fixture`, claude_max, since the default account's
  verdict is read from the fixture's own CLAUDE_CONFIG file) and this check calls it. Opt-in, because
  first-run checks want no account.

Full browser-check run on the branch after both: all page checks passed (one retry,
render-update-win32-manual, which then passed twice alone).

Rejected: changing the account modules to refuse the real home under a fixture. The seam already
exists and every module honours it; the defect was fixtures not using it.

Not built here: the card's screenshot tripwire (page text with a real email or key fragment exits
before any screenshot). With the source closed it is defence in depth; the mobile harness has one.

## Weakest premise
That the scan's definition of "boots a board" (requires server, spawns server.js) catches every way
a check can reach the account routes. A check that talks to a board started some third way would
be missed; the runner's export covers the boards it starts itself.
