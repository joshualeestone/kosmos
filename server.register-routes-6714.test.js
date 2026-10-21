'use strict';
/**
 * #6714 review 3: the restart notice's routes over HTTP, not only the engine under them. A route that ignored `name`,
 * read `{}` as a refusal, or mapped a failure to the "already done" 400 would pass every engine test.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-register-routes-6714-'));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server } = require('./server');
const store = require('./engine/store');
const create = require('./engine/create');
const liveness = require('./engine/liveness');
const register = require('./engine/register');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function ranAgent(name) {
  store.writeProfile(name, { role: 'helper' });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  liveness.seen(name);
}
async function post(route, raw) {
  const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('#6714: hide and show over HTTP; a name with no notice is 400, a bad name or body is 400', async () => {
  ranAgent('rt-brigitte');
  assert.equal((await post('/api/register/hide', JSON.stringify({ name: 'rt-brigitte' }))).status, 200);
  assert.ok(register.survey().hidden.includes('rt-brigitte'), 'the hide did not reach the survey');
  const none = await post('/api/register/hide', JSON.stringify({ name: 'rt-nobody' }));
  assert.equal(none.status, 400);
  assert.equal(none.body.notOffered, true, 'a no-notice refusal must say so, so the page can read it as done');
  for (const bad of ['{not json', JSON.stringify({ name: '../x' }), JSON.stringify({ name: 7 }), '']) {
    assert.equal((await post('/api/register/hide', bad)).status, 400, 'accepted ' + bad);
  }
  assert.equal((await post('/api/register/show', JSON.stringify({ name: 'rt-brigitte' }))).status, 200);
  assert.ok(!register.survey().hidden.includes('rt-brigitte'));
});

test('#6714: POST /api/register: {} and no body mean all, a name means that one, a refused name is 400', async () => {
  ranAgent('rt-a');
  ranAgent('rt-b');
  const one = await post('/api/register', JSON.stringify({ name: 'rt-a' }));
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.deepEqual(one.body.results.map((r) => r.name), ['rt-a'], 'a named start started something else');
  const refused = await post('/api/register', JSON.stringify({ name: 'rt-nobody' }));
  assert.equal(refused.status, 400);
  assert.equal((await post('/api/register', JSON.stringify({ name: 5 }))).status, 400);
  assert.equal((await post('/api/register', '{not json')).status, 400);
  assert.equal((await post('/api/register', '[]')).status, 400, 'an array body was read as all of them');
  const all = await post('/api/register', JSON.stringify({}));
  assert.equal(all.status, 200, '{} was not read as all: ' + JSON.stringify(all.body));
  assert.ok(all.body.results.some((r) => r.name === 'rt-b'), '{} did not start the remaining agent: ' + JSON.stringify(all.body));
  ranAgent('rt-c');
  const bare = await post('/api/register', '');
  assert.equal(bare.status, 200, 'no body was not read as all');
  assert.ok(bare.body.results.some((r) => r.name === 'rt-c'), 'no body did not start the remaining agent');
});

test('#6714 review 11: a hide the board cannot record is a 500, never the "already done" 400', async () => {
  ranAgent('rt-writefail');
  const file = require('node:path').join(store.ROOT, 'restart-notices-hidden.json');
  fs.rmSync(file, { force: true });
  fs.mkdirSync(file, { recursive: true });   // a folder where the list goes: the write fails
  try {
    const r = await post('/api/register/hide', JSON.stringify({ name: 'rt-writefail' }));
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.notEqual(r.body.notOffered, true, 'a failed write read as already done');
  } finally { fs.rmSync(file, { recursive: true, force: true }); }
});
