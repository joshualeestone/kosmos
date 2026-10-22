'use strict';
/**
 * kosmos#6908, through the REAL POST /api/agents route: `community: false` makes an agent whose instructions have no
 * Kosmos+ community section (the promote gate's throwaway agents must not be asked to post in public). The Community
 * switch is ON (no community.json is the default). CONTROL: the same create without the option gets the section, and
 * only a literal false counts (the string "false" is the usual rule).
 *
 * Sandboxes every root the create route writes to (fixture-discipline), with DRY_RUN + fake bins, as
 * server.createdbeacon-route-3038.test.js does.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nocommunity-6908-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-nc6908-claude-' + process.pid + '.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const create = require('./engine/create');
const createdbeacon = require('./engine/createdbeacon');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  createdbeacon.setSender(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  createdbeacon.setSender(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* Under DRY_RUN the route writes no instructions file, so this file pins the ROUTE's half: what it hands the engine. The
   engine's half (no section is written) is engine/create.test.js's #6908 test, with dry-run off. */
async function optsFor(body) {
  const real = create.createAgent;
  let seen = null;
  create.createAgent = (opts) => { seen = opts; return real(opts); };
  try {
    const res = await fetch(base + '/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await res.json().catch(() => null);
  } finally { create.createAgent = real; }
  assert.ok(seen, 'the route never called the engine');
  return seen;
}

test('#6908: the route hands community:false to the engine for a literal false, and nothing for any other value', async () => {
  assert.equal((await optsFor({ name: 'nc-quiet', role: 'pm', community: false })).community, false);
  for (const [name, community] of [['nc-control', undefined], ['nc-string', 'false'], ['nc-null', null], ['nc-true', true], ['nc-zero', 0]]) {
    const opts = await optsFor({ name, role: 'pm', ...(community === undefined ? {} : { community }) });
    assert.ok(!('community' in opts), `community: ${JSON.stringify(community)} reached the engine as ${JSON.stringify(opts.community)}`);
  }
});
