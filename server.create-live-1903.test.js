'use strict';
/**
 * #1903, driven through the real POST /api/agents route.
 *
 * 🛑 A real tester created a fresh Claude agent that reported created, ran, and
 * 401'd on its first turn, because create points the agent at the chosen
 * account's config dir and never checked the credential there was live. The
 * route now live-checks the account first (create.accountConnectable) and
 * REFUSES a positively-dead sign-in before writing anything. This proves the
 * WIRING end-to-end: a dead account is refused with the remedy AND no agent is
 * made; a live account still creates. The one faked boundary is
 * `claude auth status` via subscription.setRunner (the module's own seam).
 *
 * 🛑 Sandboxes every root the create route writes to (the fixture-discipline
 * rule), and DRY_RUN + fake bins so no launchd job or tmux write escapes.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-create-live-1903-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-cl1903-claude-' + process.pid + '.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// A known DEFAULT Claude account (record beside ~/.claude), so accountConnectable
// resolves it and the only variable is what its live check answers.
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const subscription = require('./engine/subscription');
const create = require('./engine/create');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  subscription.setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function post(body) {
  const res = await fetch(base + '/api/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

test('#1903: POST /api/agents REFUSES a create on a dead-sign-in account, names the remedy, and makes no agent', async () => {
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), err: null }));
  try {
    const r = await post({ name: 'deadborn', role: 'pm' });
    assert.equal(r.status, 400, 'a create on a dead account was not refused: ' + JSON.stringify(r.json));
    assert.match(r.json.error || '', /sign-in is not working/);
    assert.match(r.json.error || '', /Re-authenticate/);
    /* 🔑 AND createAgent WAS NEVER REACHED. `create.plistPath` existence is
       vacuous here (DRY_RUN writes no plist either way), so this keys on the
       birth log instead: createAgent records a birth for EVERY create it runs
       (success or its own refusal), even under DRY_RUN, so the absence of a
       'deadborn' birth proves the route returned before createAgent. If the gate
       were removed, the create would proceed, recordBirth would fire, and this
       assertion would fail. */
    assert.ok(!create.createdLog().some((e) => e.name === 'deadborn'),
      'the refused create still reached createAgent (a birth was recorded for it)');
  } finally { subscription.setRunner(null); }
});

test('#1903 CONTROL: a create on a CONNECTED account is not blocked by the gate', async () => {
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
  try {
    const r = await post({ name: 'liveborn', role: 'pm' });
    // The create may still succeed or fail downstream for other reasons, but it
    // must NOT be the liveness refusal -- the gate let a live account through.
    assert.doesNotMatch((r.json && r.json.error) || '', /sign-in is not working/,
      'a CONNECTED account was refused by the liveness gate: ' + JSON.stringify(r.json));
    /* And it actually reached createAgent -- a birth was recorded for 'liveborn'.
       This is the positive control for the refuse test's absence assertion: it
       proves recordBirth fires for a passed gate, so the missing 'deadborn' birth
       there means something. */
    assert.ok(create.createdLog().some((e) => e.name === 'liveborn'),
      'a connected-account create did not reach createAgent: ' + JSON.stringify(r.json));
  } finally { subscription.setRunner(null); }
});
