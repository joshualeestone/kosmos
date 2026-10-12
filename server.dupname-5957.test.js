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
  assert.match(String(body.nameKept), /Its instructions still say Ge Mini, so it will call itself that until you change the "You are" line\.$/);
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
  assert.equal(r2.because, 'its instructions call it Gemini, and there is already an agent called GEMINI (@gemini). Change the "You are" line in its instructions, or rename that one first.');
  // Typing a free name does not help here (the file's name wins), and the sentence must not tell the person it would.
  const r2b = discover.connect(named, { name: 'Totally Free' });
  assert.equal(r2b.ok, false);
  assert.match(String(r2b.because), /^its instructions call it Gemini/);

  // Control: the same bare folder under a free name is not refused for its name.
  const r3 = discover.connect(bare, { name: 'freshname' });
  assert.doesNotMatch(String(r3.because || ''), /already an agent called/);
});

test('#5957: an agent that already shares its name (made before this check) can still save other things', async (t) => {
  /* Josh's two Geminis exist today. Make gemini and other share a name the way they would have, by the record. */
  const before = shownOf('gemini');
  const shared = shownOf('other');
  store.writeProfile('gemini', { displayName: shared });
  t.after(() => store.writeProfile('gemini', { displayName: before }));

  const res = await send('PUT', '/api/agent/other/profile', { displayName: shared, role: 'Analyst' });
  assert.equal(res.status, 200, 'resending an unchanged name was refused: ' + JSON.stringify(await res.clone().json()));
  assert.equal(store.readProfile('other').role, 'Analyst');

  // Control: a CHANGE into that same clash is still refused (here only the capitals change).
  const changed = await send('PUT', '/api/agent/other/profile', { displayName: shared.toUpperCase() });
  assert.equal(changed.status, 400);
});

test('#5957: the profile route answers a malformed request in a sentence (the page now shows it)', async () => {
  const res = await fetch(base + '/api/agent/other/profile', {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base }, body: '{"displayName":',
  });
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.equal(error, 'we could not read that request; send it as JSON');
});

test('#5957: an instructions line moving BACK to the name already on record is not called a clash', async (t) => {
  /* other's record already shares gemini's name (made before this check); its file line says something else. */
  const before = shownOf('gemini');
  const shared = shownOf('other');
  store.writeProfile('gemini', { displayName: shared });
  t.after(() => store.writeProfile('gemini', { displayName: before }));
  const fileNow = fs.readFileSync(briefOf('other'), 'utf8').replace(/You are \*\*[^*]+\*\*/, 'You are **Zed**');
  fs.writeFileSync(briefOf('other'), fileNow);

  const got = await (await fetch(base + '/api/agent/other/instructions')).json();
  const text = String(got.text).replace(/You are \*\*[^*]+\*\*/, `You are **${shared}**`);
  const body = await (await send('PUT', '/api/agent/other/instructions', { text, version: got.version })).json();
  assert.equal(body.nameKept, undefined, 'a save that changes no record was told the name was taken: ' + body.nameKept);
  assert.equal(shownOf('other'), shared);
});

test('#5957: re-connecting a stopped Kosmos-made agent\'s own folder gets the job refusal, not "already an agent called"', async (t) => {
  /* createdKeys comes from the job files Kosmos wrote, so a stopped created agent always has one; connect's job check
     runs before the name check and owns this case. Write the job file this platform reads. */
  const status = require('./engine/status');
  const key = 'dozer';
  const folder = mk(key);
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), '# Dozer\n\nYou are **Dozer**, an assistant.\n');
  store.writeProfile(key, { provider: 'anthropic', displayName: 'Dozer' });
  /* Both job files, the Mac plist and the Linux unit, so the test needs no host branch: hasJob reads whichever this
     computer uses. A computer that reads neither (Windows keeps its record elsewhere) skips, and says so. */
  const jobs = [create.plistPath(key), require('./engine/linuxjob').unitPath(key)];
  for (const job of jobs) { fs.mkdirSync(path.dirname(job), { recursive: true }); fs.writeFileSync(job, 'fixture job'); }
  status.setCreatedSource(() => [key]);
  t.after(() => { status.setCreatedSource(null); for (const job of jobs) fs.rmSync(job, { force: true }); });
  if (!create.hasJob(key)) { t.skip('this computer does not keep agent jobs as a plist or a systemd unit'); return; }
  const r = require('./engine/discover').connect(folder, {});
  assert.equal(r.ok, false);
  assert.equal(r.because, 'Kosmos already looks after an agent by that name');
  // The other connect path (a folder with no instructions, named by the person) refuses the same way, first.
  const r2 = require('./engine/discover').connect(mk('empty-for-dozer'), { name: key });
  assert.equal(r2.ok, false);
  assert.equal(r2.because, 'Kosmos already looks after an agent by that name');
});

test('#5957: on Windows, a stopped agent is read from the session record (the Windows roster lists only live ones)', (t) => {
  const win32sessions = require('./engine/win32sessions');
  const key = 'winsleeper';
  store.writeProfile(key, { provider: 'anthropic', displayName: 'Win Sleeper' });
  const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
  assert.equal(win32sessions.record(id, { name: key, runner: 'claude' }).ok, true, 'fixture: the record was not written');
  t.after(() => win32sessions.forget(id));
  const { nameCheckFleet } = require('./server');

  const onWindows = nameCheckFleet('win32');
  assert.deepEqual(onWindows.find((a) => a.handle === key), { handle: key, shown: 'Win Sleeper' });
  // Control: elsewhere that record is not a source (the created list is), so the same agent is not there.
  assert.equal(nameCheckFleet('darwin').some((a) => a.handle === key), false);
});

test('#5957: a created list that cannot be read refuses the name check rather than reading as "no stopped agents"', (t) => {
  const status = require('./engine/status');
  const { nameCheckFleet } = require('./server');
  status.setCreatedSource(() => { throw new Error('LaunchAgents unreadable'); });
  t.after(() => status.setCreatedSource(null));
  assert.throws(() => nameCheckFleet('darwin'), /LaunchAgents unreadable/);
});
