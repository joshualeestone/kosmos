'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4421, the server half, for EVERY provider (Josh: "check it for all the models of agents"). The page's surfaces
 * follow the agent's card (web.rename-4421.test.js), so the card must carry the new name whatever runs the agent:
 * Claude, Codex (OpenAI), Gemini (API key), Antigravity (Google subscription), Grok and Muse each read a different
 * instructions file, and the card's name comes from engine/status.js readIdentity, where the recorded name wins.
 * Each agent runs as a pane of its OWN runner (the card says so) and is born with a name different from its id in its
 * own runner's file (CLAUDE.md, AGENTS.md or GEMINI.md). The rename route also rewrites that file, asserted per
 * runner, so both sources move together; the control that fails this test is a card naming the pane id, the failure
 * Josh saw, not a readIdentity that ignores the record.
 * Through the REAL rename route (PUT /api/agent/:name/profile) and the REAL /api/status and /api/projects, whose
 * members' names are what the project room labels its posts with (pjNameOf).
 * Not red on main: this half was already right. It guards the "every provider, DMs and rooms" claim the fix rests on.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rename-4421-')));
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

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const create = require('./engine/create');
const projects = require('./engine/projects');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

/* provider (as the profile records it), the runner its pane runs, and its session name (the internal id). Each is
   BORN with a name different from its id, in its own runner's instructions file, in the "You are **Name**" line
   the rename route rewrites. */
const AGENTS = [
  { provider: 'anthropic', runner: '', session: 'claude-sub', state: 'idle' },
  { provider: 'openai', runner: 'codex', session: 'codex-sub', state: 'unknown' },
  { provider: 'google', runner: 'gemini', session: 'gemini-sub', state: 'idle' },
  { provider: 'antigravity', runner: 'antigravity', session: 'agy-sub', state: 'stopped' },
  { provider: 'xai', runner: 'grok', session: 'grok-sub', state: 'stopped' },
  { provider: 'meta', runner: 'muse', session: 'muse-sub', state: 'stopped' },
];
const born = (a) => 'Born ' + a.session;
const renamed = (a) => 'Demis Hassabis - ' + a.session;
const briefOf = (a) => path.join(create.workerDir(a.session), create.briefFilename(create.recordedRunner(a.session)));

let base;
let board = null;
test.before(async () => {
  for (const a of AGENTS) {
    fs.mkdirSync(create.workerDir(a.session), { recursive: true });
    store.writeProfile(a.session, { provider: a.provider });
    fs.writeFileSync(briefOf(a), `# ${born(a)}\n\nYou are **${born(a)}**, a project manager.\n`);
  }
  /* Kosmos panes of each agent's OWN runner, through the real status producers (test-support/fleet): the rename
     route only accepts an agent on a Kosmos pane. The states are what the engine reads off a pane without that
     runner's real process (the fleet fixture verifies them); the name comes from the same readIdentity whatever
     the state. */
  board = fleet.install(AGENTS.map((a) => fleet.agent(a.session, { state: a.state, runner: a.runner })));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } if (board) board.restore(); });

const cards = async () => {
  const res = await fetch(base + '/api/status');
  assert.equal(res.status, 200);
  return (await res.json()).agents || [];
};
const cardOf = (list, s) => list.find((c) => c.sessionName === s) || {};
const nameOf = (list, s) => cardOf(list, s).name;

test('#4421: every provider\'s card carries the new name after a rename, never the id', async () => {
  const before = await cards();
  for (const a of AGENTS) {
    assert.equal(nameOf(before, a.session), born(a), 'fixture: ' + a.session + ' has no card, or one not named by its own file');
    assert.equal(cardOf(before, a.session).runner || 'claude', a.runner || 'claude', 'fixture: ' + a.session + '\'s pane is not its runner');
  }
  const files = new Set(AGENTS.map(briefOf).map((f) => path.basename(f)));
  assert.deepEqual([...files].sort(), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'], 'fixture: the runners do not read their three kinds of file');

  for (const a of AGENTS) {
    const res = await fetch(`${base}/api/agent/${a.session}/profile`, {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ displayName: renamed(a) }),
    });
    assert.equal(res.status, 200, 'the rename route refused ' + a.session);
    const body = await res.json();
    assert.equal(body.renamed && body.renamed.changed, true, a.session + ': its own file was not rewritten: ' + JSON.stringify(body.renamed));
    assert.match(fs.readFileSync(briefOf(a), 'utf8'), new RegExp('You are \\*\\*' + renamed(a) + '\\*\\*'), a.session + '\'s file does not say its new name');
  }
  const after = await cards();
  for (const a of AGENTS) {
    assert.equal(nameOf(after, a.session), renamed(a), `${a.session} (${a.runner || 'claude'}) kept its old name on its card`);
  }
});

test('#4421: a project room names its members by the new name (the name its posts are labelled with)', async () => {
  const folder = mk('room');
  const made = projects.create({ name: 'Rename room', folder, agents: AGENTS.map((a) => a.session), roster: await cards() });
  const res = await fetch(base + '/api/projects');
  assert.equal(res.status, 200);
  const room = ((await res.json()).projects || []).find((p) => p.id === made.id);
  assert.ok(room, 'fixture: the project is not listed');
  for (const a of AGENTS) {
    const m = (room.agents || []).find((x) => x.sessionName === a.session);
    assert.ok(m, 'fixture: ' + a.session + ' is not a member');
    assert.equal(m.name, renamed(a), `${a.session}'s room label kept its old name`);
  }
});
