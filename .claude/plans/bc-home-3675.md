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
- `tools/browser-checks.sh` exports an empty AGENT_WORKFORCE_HOME inside RUN_DIR (removed by
  cleanup) and AGENT_WORKFORCE_CODEX_HOME under it, for every board it starts and every check it
  runs, unless the caller set a sandbox.
- `tools.browser-checks-home-3675.test.js`: every board-booting check requires the lib before the
  board (red control: removing it from render-settings-nav.js, and from thread-server.js, fails);
  a fixture with the lib lists none of a planted "real" home's accounts, and without it lists the
  planted one (the control, so the test works on CI's account-free runner); the lib keeps a
  caller's sandbox, replaces the real home and removes only its own folder; the runner exports it.

## Found while verifying: checks that quietly used the host's real account
- **render-create-made** makes an agent on a runner-started board (sb8). It needed a Claude account
  and a Claude Code binary, both taken from the host (`<home>/.local/bin/claude`, the real
  `~/.claude`). sb8 now has its own home with a fixture default account (`fixture@example.invalid`)
  and its own stand-in Claude Code (answers `--version`, exits non-zero otherwise), inline, the way
  sb4 already does it, so the create liveness probe fails open instead of running the host's real
  Claude Code against a real account.
- **render-talk-fill-2622** measures the Talk box with a connected subscription, which it borrowed
  from the host's secondary accounts; in a sandbox the "cannot reach a Claude subscription" bar took
  45px. It calls the lib's opt-in `plantSubscribedClaude()`, which gives it its OWN home (never the
  shared one) holding a secondary `~/.claude-fixture` account (claude_max). Secondary, because the
  default account's verdict is read from AGENT_WORKFORCE_CLAUDE_CONFIG.
- **The subscription check** (`subscription.js`) reads `AGENT_WORKFORCE_CLAUDE_CONFIG || ~/.claude.json`,
  not the home seam, and 20 wired checks never set it. The lib defaults it into the sandbox too, and
  `AGENT_WORKFORCE_CODEX_HOME`, which the OpenAI default reads before the home seam.
- The runner's shared home stays EMPTY, so no check's premise depends on which check ran first.

Full browser-check run on f138ef26: all page checks passed (one retry, render-type-to-focus-3283,
the focus area tracked as #3557).

Rejected: changing the account modules to refuse the real home under a fixture. The seam already
exists and every module honours it; the defect was fixtures not using it.

Not built here: signal-time cleanup of the lib's temp folders (only on normal exit; a killed check
leaves one behind), and the card's screenshot tripwire (page text with a real email or key fragment exits
before any screenshot). With the source closed it is defence in depth; the mobile harness has one.

## Weakest premise
That the scan's definition of "boots a board" (requires server, spawns server.js) catches every way
a check can reach the account routes. A check that talks to a board started some third way would
be missed; the runner's export covers the boards it starts itself. A check that loads engine
modules directly without booting a board (live-connect.js loads engine/connect.js) is outside the
scan; it sets its own home.
