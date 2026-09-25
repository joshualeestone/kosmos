# Plan: #3675, browser-check fixture boards read the host Mac's real accounts

## Finished looks like
No browser-check fixture board can list the real Claude, OpenAI, Gemini or Grok accounts of the Mac
it runs on, whether the check runs through tools/browser-checks.sh, boots its own board, or is run
by hand from the README recipes, and a test fails
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
- All 57 checks that boot or spawn the board (56, plus render-assistant-bubble-3034 from main after the rebase) (in-process `require('../../server[.js]')`, a spawned
  `server.js`, and thread-server.js) require it at top level, before the board.
- `tools/browser-checks.sh` exports an empty AGENT_WORKFORCE_HOME inside RUN_DIR (removed by
  cleanup) and unsets the ambient homes, for every board it starts and every check it runs.
- The README's hand-run recipes (the main "Running them" one and render-create-made's) sandbox the
  home and the Claude config too.
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
  not the home seam, and 20 wired checks never set it. The lib defaults it into the sandbox too.
- **Ambient homes read before the seam** (`CODEX_HOME`, `AGENT_WORKFORCE_CODEX_HOME`,
  `GEMINI_CLI_HOME`, `GROK_HOME`, `CLAUDE_CONFIG_DIR`) are REMOVED by the lib and the runner, as
  tools/run-tests.sh does (#2858). Not set to a sandbox: naming a codex home puts the board into the
  #1488 "operator named a codex home" mode, which is not the ordinary product.
- The runner's shared home stays EMPTY, so no check's premise depends on which check ran first.

Full browser-check runs: on f138ef26 all page checks passed (one retry, render-type-to-focus-3283,
the focus area tracked as #3557); and after the codex home moved to removal, on 3ab9d1f3, all page
checks passed with no retries; and after the rebase onto main and round 5 (the Claude config moved
into a lib-made folder, render-assistant-bubble-3034 wired), on 15e1d124, all page checks passed
with no retries. The only commit after 15e1d124 touches this plan.

Rejected: changing the account modules to refuse the real home under a fixture. The seam already
exists and every module honours it; the defect was fixtures not using it.

Not built here: the global skills list (engine/skills.js reads the real ~/.claude/skills unless
AGENT_WORKFORCE_SKILLS_DIR is set; skill names, not accounts); signal-time cleanup of the lib's temp folders (only on normal exit; a killed check
leaves one behind), and the card's screenshot tripwire (page text with a real email or key fragment exits
before any screenshot). With the source closed it is defence in depth; the mobile harness has one.

## Weakest premise
That the scan's definition of "boots a board" (requires server, spawns server.js) catches every way
a check can reach the account routes. A check that talks to a board started some third way would
be missed; the runner's export covers the boards it starts itself. A check that loads engine
modules directly without booting a board (live-connect.js loads engine/connect.js) is outside the
scan; it sets its own home. Run recipes in the checks' header comments that boot a board by
hand still omit the home (the runner covers them); the one for render-create-made, which presses
Create, is fixed in the README.
