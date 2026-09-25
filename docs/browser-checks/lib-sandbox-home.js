'use strict';

/**
 * #3675: a check's fixture board must not read the host Mac's real accounts.
 *
 * The account modules (engine/accounts.js, openaiaccounts.js, geminiaccounts.js,
 * grokaccounts.js) find accounts under `AGENT_WORKFORCE_HOME || os.homedir()`, the
 * subscription check reads `AGENT_WORKFORCE_CLAUDE_CONFIG || ~/.claude.json`, and the
 * OpenAI default reads `AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME` first. A fixture that
 * sandboxed DATA, WORKERS, PROJECTS, LAUNCH and CONFIG_ROOT but not these still showed
 * the real Claude account emails and the end of a real OpenAI key in Settings, and a
 * screenshot taken on a developer's Mac carries them into a PR, an issue or a chat.
 * Measured on Agent1s: a render-settings-nav-shaped fixture listed 5 real Claude
 * accounts and 1 real OpenAI account; with this required, none.
 *
 * Requiring this file points each of those at a sandbox, unless the caller already
 * set it (to somewhere other than the real home, for AGENT_WORKFORCE_HOME). A check
 * that sets its own after requiring this wins. Every check that boots or spawns the
 * board requires it; tools.browser-checks-home-3675.test.js fails if one does not. It
 * never touches HOME itself, so Playwright still finds its browsers.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Folders this file made, removed when the check ends; never one a caller set. */
const made = [];
process.on('exit', () => {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});
function freshHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bc-home-'));
  made.push(d);
  return d;
}

const cur = process.env.AGENT_WORKFORCE_HOME;
if (!cur || path.resolve(cur) === path.resolve(os.homedir())) process.env.AGENT_WORKFORCE_HOME = freshHome();
const home = process.env.AGENT_WORKFORCE_HOME;
if (!process.env.AGENT_WORKFORCE_CLAUDE_CONFIG) process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(home, '.claude.json');
if (!process.env.AGENT_WORKFORCE_CODEX_HOME) process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(home, '.codex');

/* The fixture Claude account, for a check whose screen assumes a connected
   subscription (without one the board shows "Kosmos cannot reach a Claude subscription"
   and takes the space). Opt-in, never automatic: first-run checks want no account.
   The address is .invalid on purpose: nothing real can answer to it. */
const FIXTURE_CLAUDE = { oauthAccount: { emailAddress: 'fixture@example.invalid',
  organizationName: 'Kosmos browser checks', organizationType: 'claude_max' } };
function plantSubscribedClaude() {
  /* Its OWN home, never the one it was given: under tools/browser-checks.sh that home is
     shared by every later check and board in the run, and a planted account there would
     change what they see depending on run order. A SECONDARY account (~/.claude-fixture),
     not the default: the default's subscription verdict is read from
     AGENT_WORKFORCE_CLAUDE_CONFIG, which a fixture points at its own empty file, while a
     secondary is judged by its own .claude.json. */
  const own = freshHome();
  process.env.AGENT_WORKFORCE_HOME = own;
  process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(own, '.codex');
  const dir = path.join(own, '.claude-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(FIXTURE_CLAUDE) + '\n');
  return own;
}

module.exports = { sandboxHome: () => process.env.AGENT_WORKFORCE_HOME, plantSubscribedClaude, FIXTURE_CLAUDE };
