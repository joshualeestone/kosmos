'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5080: GET/PUT /api/agent-language against the real server. Sandboxed as server.undo-5153.test.js is.
 *   node --test server.agent-language-5080.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentlang-route-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('./test-support/fleet');
const pl = require('./engine/personlanguage');
const { start, server } = require('./server');

// The runners force English for every test (AGENT_WORKFORCE_PERSON_LOCALE=en), which would beat any choice. This file
// tests the choice, so the override is taken away for the requests below and put back after.
const forced = process.env.AGENT_WORKFORCE_PERSON_LOCALE;
let base;
test.before(async () => {
  delete process.env.AGENT_WORKFORCE_PERSON_LOCALE;
  pl._resetForTests({ env: {}, platform: 'linux', intl: 'en-US' });
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (forced !== undefined) process.env.AGENT_WORKFORCE_PERSON_LOCALE = forced;
  pl._resetForTests();
  fleet.restore();
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const put = async (body, headers = {}) => {
  const res = await fetch(base + '/api/agent-language', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('#5080: GET says Automatic with no file, and lists the three languages', async () => {
  fs.rmSync(pl.CHOICE_FILE, { force: true });
  const r = await (await fetch(base + '/api/agent-language')).json();
  assert.equal(r.choice, 'auto');
  assert.equal(r.ok, true);
  assert.deepEqual(r.options, [{ tag: 'en', name: 'English' }, { tag: 'es-419', name: 'Spanish (Latin America)' }, { tag: 'pt-BR', name: 'Portuguese (Brazil)' }]);
  assert.deepEqual(r.automatic, { tag: 'en-US', name: 'English', sure: false }, 'Automatic is what this computer reads, said as not sure off a Mac');
});

test('#5080: PUT saves and changes running agents at once; English takes the block back out', async () => {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'cleo');
  fs.mkdirSync(dir, { recursive: true });
  const original = '# Cleo\n\nYou are Cleo, who keeps the books for the person.\n';
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), original);
  const board = fleet.install([fleet.agent('cleo')]);
  try {
    let r = await put({ choice: 'pt-BR' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.choice, 'pt-BR');
    assert.equal(r.body.changed, 1, 'the running agent was not changed by the save');
    assert.equal(r.body.removed, 0, 'CONTROL: writing a block is not a removal');
    assert.equal(r.body.couldNot, 0);
    assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /reads Portuguese \(pt-BR, chosen in Kosmos Settings\)/);
    r = await put({ choice: 'en' });
    assert.equal(r.body.changed, 1);
    assert.equal(r.body.removed, 1, 'a removal was not reported apart, so the page would promise a switch that never comes');
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), original, 'English did not take the block out');
    assert.equal((await (await fetch(base + '/api/agent-language')).json()).choice, 'en');
    // Review 1: back to Automatic on a computer the board cannot read (this one, Linux in the seam) also takes out the
    // block an earlier choice wrote, since the page then says English.
    await put({ choice: 'es-419' });
    assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /chosen in Kosmos Settings/, 'CONTROL: the choice wrote it');
    r = await put({ choice: 'auto' });
    assert.equal(r.body.changed, 1);
    assert.equal(r.body.automatic.sure, false);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), original, 'Automatic left the old choice in place');
  } finally { board.restore(); fs.rmSync(pl.CHOICE_FILE, { force: true }); }
});

test('#5080: an agent cannot change it, and a language off the list or a bad body is refused without saving', async () => {
  fs.rmSync(pl.CHOICE_FILE, { force: true });
  assert.equal((await put({ choice: 'es-419' }, { 'x-kosmos-agent-token': 'any' })).status, 403);
  assert.equal((await put({ choice: 'es-419', token: 'any' })).status, 403, 'an agent token in the body was not refused');
  for (const body of [{ choice: 'fr' }, {}, { choice: null }, '{nope']) {
    const r = await put(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(fs.existsSync(pl.CHOICE_FILE), false, 'a refused PUT wrote the file');
  assert.equal((await put({ choice: 'es-419' })).status, 200, 'CONTROL: the same PUT from the person is accepted');
  fs.rmSync(pl.CHOICE_FILE, { force: true });
});

test('#5080: an unreadable choice says so (choice null, ok false), never shows a position it does not know', async () => {
  fs.mkdirSync(path.dirname(pl.CHOICE_FILE), { recursive: true });
  fs.writeFileSync(pl.CHOICE_FILE, '{broken');
  try {
    const r = await (await fetch(base + '/api/agent-language')).json();
    assert.equal(r.ok, false);
    assert.equal(r.choice, null);
  } finally { fs.rmSync(pl.CHOICE_FILE, { force: true }); }
});

test('#5080 review 1: an unreadable roster reports no agent count (the page then says "next time Kosmos starts")', () => {
  // syncEveryone answers an unreadable roster with ONE entry whose agent is null; counting it would read "1 agent".
  // A source check: the roster cannot be made unreadable through the route without breaking the board itself.
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /couldNot = told\.some\(\(t\) => t && t\.agent === null\) \? -1 : told\.filter\(\(t\) => t && t\.state !== projects\.TOLD\.TOLD\)\.length;/);
  assert.deepEqual(pl.syncEveryone(null).map((t) => t.agent), [null], 'CONTROL: the shape the route keys on');
});
