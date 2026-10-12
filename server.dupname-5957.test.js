'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#5957 slice 1, through the REAL routes: no two agents share a display name. Josh's Windows QA found two agents
 * both shown as "Gemini". Board: "gemini" (shown Gemini) and "other" (shown Other). Each path that sets a display name
 * refuses one another agent already answers to, compared the way an @-word is, and leaves everything as it was:
 *   - PUT /api/agent/:name/profile        400, field displayName, nothing written
 *   - PUT /api/agent/:name/instructions   the text saves; the rename does not, and the reply says why (nameKept)
 *   - create.createAgent (POST /api/agents, POST /api/team, the setup guide)   refused at the name field, nothing made
 * Each with a control that a free name (or the agent's own) still works, so a refusal of everything cannot pass.
 * Plus the fleet's second source (created agents that are not running) and both connect paths.
 * ⚠️ The tests run IN ORDER and build on each other: the renames in one are the names the next one expects.
 *
 *   node --test server.dupname-5957.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dupname-5957-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.HOME = mk('home');
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';   // nothing here may start a real claude

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const create = require('./engine/create');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const AGENTS = [{ session: 'gemini', shown: 'Gemini' }, { session: 'other', shown: 'Other' }];
const briefOf = (s) => path.join(create.workerDir(s), 'CLAUDE.md');

let base;
let board = null;
test.before(async () => {
  for (const a of AGENTS) {
    fs.mkdirSync(create.workerDir(a.session), { recursive: true });
    store.writeProfile(a.session, { provider: 'anthropic', displayName: a.shown });
    fs.writeFileSync(briefOf(a.session), `# ${a.shown}\n\nYou are **${a.shown}**, a project manager.\n`);
  }
  board = fleet.install(AGENTS.map((a) => fleet.agent(a.session, { state: 'idle' })));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } if (board) board.restore(); });

const send = (method, p, body) => fetch(base + p, {
  method, headers: { 'content-type': 'application/json', origin: base }, body: body === undefined ? undefined : JSON.stringify(body),
});
const shownOf = (s) => store.readProfile(s).displayName;
const removedFile = () => path.join(store.ROOT, 'removed.json');

test('fixture: both agents are on the board under their display names', async () => {
  const res = await fetch(base + '/api/status');
  const cards = (await res.json()).agents || [];
  for (const a of AGENTS) assert.equal((cards.find((c) => c.sessionName === a.session) || {}).name, a.shown, a.session);
});

test('#5957: renaming an agent to a name another agent has is refused, and nothing is written', async () => {
  for (const typed of ['Gemini', 'gemini', ' GE-MINI ']) {
    const res = await send('PUT', '/api/agent/other/profile', { displayName: typed });
    assert.equal(res.status, 400, JSON.stringify(typed) + ' was accepted');
    const body = await res.json();
    assert.equal(body.field, 'displayName');
    assert.equal(body.error, 'there is already an agent called Gemini (@gemini). Pick another name, or rename that one first.');
    assert.equal(shownOf('other'), 'Other', 'the refused name was recorded anyway');
    assert.match(fs.readFileSync(briefOf('other'), 'utf8'), /You are \*\*Other\*\*/, 'the refused name reached the file');
  }
});

test('#5957 controls: a free name renames, and an agent may re-case its own name', async () => {
  let res = await send('PUT', '/api/agent/other/profile', { displayName: 'Other Two' });
  assert.equal(res.status, 200, 'a free name was refused: ' + JSON.stringify(await res.json()));
  assert.equal(shownOf('other'), 'Other Two');
  res = await send('PUT', '/api/agent/gemini/profile', { displayName: 'GEMINI' });
  assert.equal(res.status, 200, 'an agent could not re-case its own name: ' + JSON.stringify(await res.json()));
  assert.equal(shownOf('gemini'), 'GEMINI');
});

test('#5957: an instructions line naming a taken name saves the text but not the rename, and says why', async () => {
  const got = await (await fetch(base + '/api/agent/other/instructions')).json();
  const text = String(got.text).replace(/You are \*\*[^*]+\*\*/, 'You are **Ge Mini**');
  const res = await send('PUT', '/api/agent/other/instructions', { text, version: got.version });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.match(String(body.nameKept), /^The name was not changed: there is already an agent called GEMINI \(@gemini\)\./);
  assert.match(fs.readFileSync(briefOf('other'), 'utf8'), /You are \*\*Ge Mini\*\*/, 'the text itself did not save');
  assert.equal(shownOf('other'), 'Other Two', 'the record followed the line into a clash');

  // Control: a free name on the line still renames, and says nothing extra.
  const again = await (await fetch(base + '/api/agent/other/instructions')).json();
  const free = String(again.text).replace(/You are \*\*[^*]+\*\*/, 'You are **Other Three**');
  const ok = await (await send('PUT', '/api/agent/other/instructions', { text: free, version: again.version })).json();
  assert.equal(ok.nameKept, undefined);
  assert.equal(shownOf('other'), 'Other Three');
});

test('#5957: creating an agent under a name another agent has is refused at the name field', async () => {
  /* Through create.createAgent, the function POST /api/agents, POST /api/team and the setup guide all reach, with the
     board's own wiring (start() above set the source). The route itself refuses first on this sandbox for having no
     Claude account signed in, which says nothing about names. */
  const out = await create.createAgent({ name: 'Ge Mini', role: 'ea' });
  assert.equal(out.outcome, create.OUTCOME.REFUSED);
  assert.equal(out.field, 'name');
  assert.equal(out.because, 'there is already an agent called GEMINI (@gemini). Pick another name, or rename that one first.');
  assert.equal(fs.existsSync(create.workerDir('ge-mini')), false, 'a folder was made for a refused name');

  // Control: a free name is not refused for its name.
  const free = await create.createAgent({ name: 'Brand New', role: 'ea' });
  assert.doesNotMatch(String(free.because || ''), /already an agent called/);
});

test('#5957: a created agent that is not running still holds its name; a REMOVED one does not', async (t) => {
  /* createdKeys() is the board's list of agents Kosmos created, running or not, and it includes removed ones (for
     Restore). Stub it with one stopped agent and one removed agent, as the plist source would report them. */
  const status = require('./engine/status');
  for (const [key, shown] of [['sleepy', 'Sleepy'], ['gone', 'Gone Girl']]) {
    fs.mkdirSync(create.workerDir(key), { recursive: true });
    store.writeProfile(key, { provider: 'anthropic', displayName: shown });
  }
  fs.writeFileSync(removedFile(), JSON.stringify([{ name: 'gone', removedAt: '2026-10-12T00:00:00.000Z' }]));
  status.setCreatedSource(() => ['sleepy', 'gone']);
  t.after(() => { status.setCreatedSource(null); fs.rmSync(removedFile(), { force: true }); });

  const res = await send('PUT', '/api/agent/other/profile', { displayName: 'SLEEPY' });
  assert.equal(res.status, 400, 'a stopped agent\'s name was free');
  assert.equal((await res.json()).error, 'there is already an agent called Sleepy (@sleepy). Pick another name, or rename that one first.');

  const ok = await send('PUT', '/api/agent/other/profile', { displayName: 'Gone Girl' });
  assert.equal(ok.status, 200, 'a removed agent still held its name: ' + JSON.stringify(await ok.clone().json()));
  assert.equal(shownOf('other'), 'Gone Girl');
});

test('#5957: connecting a folder under a name another agent has is refused, on both connect paths', () => {
  const discover = require('./engine/discover');
  /* registerOnly: a folder with no instructions, named by the person. */
  const bare = mk('bare-folder');
  const r1 = discover.connect(bare, { name: 'Ge Mini' });
  assert.equal(r1.ok, false);
  assert.equal(r1.because, 'there is already an agent called GEMINI (@gemini). Pick another name, or rename that one first.');
  assert.equal(store.readProfile('Ge Mini').dir, undefined, 'a refused connect recorded the folder');

  /* connect: a folder whose own instructions name the agent. */
  const named = mk('newbie');
  fs.writeFileSync(path.join(named, 'CLAUDE.md'), '# x\n\nYou are **Gemini**, an assistant.\n');
  const r2 = discover.connect(named, {});
  assert.equal(r2.ok, false);
  assert.match(String(r2.because), /^there is already an agent called GEMINI \(@gemini\)/);

  // Control: the same bare folder under a free name is not refused for its name.
  const r3 = discover.connect(bare, { name: 'freshname' });
  assert.doesNotMatch(String(r3.because || ''), /already an agent called/);
});
