'use strict';

/**
 * #3734 (Josh, 2026-09-25 08:23): the setup guide makes agents for the person. POST /api/agents from an
 * AGENT (it presents its launch token) is accepted only from the setup guide, is bounded per hour, and
 * without a provider named runs the new agent on the guide's own provider. The screen and a tokenless
 * caller are unchanged.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-create-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
// A signed-in DEFAULT Claude account beside the sandbox HOME, as server.projects.test.js does: the create
// route refuses a Claude create on a machine with none (#2145); the fake bin answers the live check.
fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'guide-test@example.com' } }));
fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, resetGuideCreatesForTests, GUIDE_CREATES_PER_HOUR } = require('./server');
const fleet = require('./test-support/fleet');
const setupAssistant = require('./engine/setup-assistant');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');

const GUIDE = 'guidebot';
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

let base;
let board;
test.before(async () => {
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  board = fleet.install([fleet.agent(GUIDE, { state: 'idle' }), fleet.agent('otherbot', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { board.restore(); } catch { /* best effort */ }
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const tokenFor = (name) => { const m = sendertoken.mint(name); assert.equal(m.ok, true, 'could not mint a token for ' + name); return m.token; };
const create = (body, token) => fetch(base + '/api/agents', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-kosmos-agent-token': token } : { 'sec-fetch-site': 'same-origin' }) },
  body: JSON.stringify(body),
});
let n = 0;
const fresh = () => 'made' + (++n);

test('#3734 the setup guide, by its launch token, makes an agent, and the answer names it as the maker', async () => {
  resetGuideCreatesForTests();
  const r = await create({ name: fresh(), role: 'pm' }, tokenFor(GUIDE));
  const b = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b));
  assert.equal(b.outcome, 'created', JSON.stringify(b));
  assert.equal(b.madeBy, GUIDE);
});

test('#3734 any other agent presenting its token is refused before anything is made; a junk token too', async () => {
  resetGuideCreatesForTests();
  const name = fresh();
  const r = await create({ name, role: 'pm' }, tokenFor('otherbot'));
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /only the setup guide/);
  const junk = await create({ name, role: 'pm' }, 'deadbeef'.repeat(8));
  assert.equal(junk.status, 403, 'a token that names no agent was allowed to create');
  const again = await create({ name, role: 'pm' }, tokenFor(GUIDE));
  assert.equal((await again.json()).outcome, 'created', 'CONTROL: the same name is free, so nothing was made by the refused asks');
});

test('#3734 the screen, with no token, still makes agents as before (unchanged)', async () => {
  const r = await create({ name: fresh(), role: 'pm' });
  const b = await r.json();
  assert.equal(b.outcome, 'created', JSON.stringify(b));
  assert.equal(b.madeBy, undefined, 'a screen-made agent was credited to the guide');
});

test('#3734 the guide is bounded per hour; the screen is not', async () => {
  resetGuideCreatesForTests();
  const tok = tokenFor(GUIDE);
  for (let i = 0; i < GUIDE_CREATES_PER_HOUR; i += 1) {
    const b = await (await create({ name: fresh(), role: 'pm' }, tok)).json();
    assert.equal(b.outcome, 'created', 'create ' + (i + 1) + ': ' + JSON.stringify(b));
  }
  const over = await create({ name: fresh(), role: 'pm' }, tok);
  assert.equal(over.status, 429, 'the guide made more than its hourly bound');
  assert.match((await over.json()).error, /New agent/);
  const screen = await (await create({ name: fresh(), role: 'pm' })).json();
  assert.equal(screen.outcome, 'created', 'CONTROL: the screen is not bounded by the guide');
  resetGuideCreatesForTests();
});

test('#3734 with no provider named, the new agent runs on the guide\'s own provider', async () => {
  resetGuideCreatesForTests();
  store.writeProfile(GUIDE, { provider: 'openai' });
  try {
    // Nobody is signed in to OpenAI in this sandbox, so the create is refused, naming OpenAI: the
    // provider the request never named came from the guide.
    const r = await create({ name: fresh(), role: 'pm' }, tokenFor(GUIDE));
    const b = await r.json();
    assert.match(JSON.stringify(b), /OpenAI/, 'the guide\'s provider was not used: ' + JSON.stringify(b));
  } finally { store.writeProfile(GUIDE, { provider: 'anthropic' }); }
  const control = await (await create({ name: fresh(), role: 'pm' }, tokenFor(GUIDE))).json();
  assert.equal(control.outcome, 'created', 'CONTROL: on a Claude guide the same create is made: ' + JSON.stringify(control));
});
