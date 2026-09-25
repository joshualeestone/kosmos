'use strict';

/**
 * #3675: a check's fixture board must not read the host Mac's real accounts.
 *
 * The account modules (engine/accounts.js, openaiaccounts.js, geminiaccounts.js,
 * grokaccounts.js) find accounts under `AGENT_WORKFORCE_HOME || os.homedir()`. A
 * fixture that sandboxes DATA, WORKERS, PROJECTS, LAUNCH, CONFIG_ROOT and
 * CLAUDE_CONFIG but not HOME still shows the real Claude account emails and the
 * end of a real OpenAI key in Settings, and a screenshot taken on a developer's
 * Mac carries them into a PR, an issue or a chat. Measured on Agent1s: a
 * render-settings-nav-shaped fixture listed 5 real Claude accounts and 1 real
 * OpenAI account; with this set, none.
 *
 * Requiring this file points `AGENT_WORKFORCE_HOME` at a fresh temp folder,
 * unless it is already set to somewhere other than the real home (a check that
 * seeds its own accounts sets it itself, before or after, and wins). Every check
 * that boots or spawns the board requires it; tools.browser-checks-home-3675.test.js
 * fails if one does not. It only sets the Kosmos seam, never HOME, so Playwright
 * still finds its browsers.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cur = process.env.AGENT_WORKFORCE_HOME;
if (!cur || path.resolve(cur) === path.resolve(os.homedir())) {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bc-home-'));
  process.env.AGENT_WORKFORCE_HOME = made;
  // Removed when the check ends; only the folder this file made, never one a caller set.
  process.on('exit', () => { try { fs.rmSync(made, { recursive: true, force: true }); } catch { /* best effort */ } });
}

/* The fixture default Claude account, for a check whose screen assumes a connected
   subscription (without one the board shows "Kosmos cannot reach a Claude subscription"
   and takes the space). Opt-in, never automatic: first-run checks want no account.
   The address is .invalid on purpose; tools/browser-checks.sh plants the same one. */
const FIXTURE_CLAUDE = { oauthAccount: { emailAddress: 'fixture@example.invalid',
  organizationName: 'Kosmos browser checks', organizationType: 'claude_max' } };
function plantSubscribedClaude() {
  const home = process.env.AGENT_WORKFORCE_HOME;
  if (!home || path.resolve(home) === path.resolve(os.homedir())) throw new Error('plantSubscribedClaude: no sandbox home');
  /* A SECONDARY account (~/.claude-fixture), not the default: the default's subscription
     verdict is read from AGENT_WORKFORCE_CLAUDE_CONFIG, which a fixture points at its own
     (empty) sandbox file, while a secondary is judged by its own .claude.json. On a
     developer Mac the "connected" verdict came from the host's real secondary accounts. */
  const dir = path.join(home, '.claude-fixture');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, '.claude.json');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify(FIXTURE_CLAUDE) + '\n');
}

module.exports = { sandboxHome: () => process.env.AGENT_WORKFORCE_HOME, plantSubscribedClaude, FIXTURE_CLAUDE };
