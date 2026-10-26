'use strict';
/**
 * kosmos#7210 (Josh, 2026-10-26: "mute projects so that I can select the notifications on a project-by-project
 * basis"): a project's notification level, All / Mentions only / Muted, kept on the board's project record.
 *   - the engine keeps it (absent reads as all, 'all' is never stored, anything else is refused);
 *   - only the person's screen can set it (an agent's token, or no token and no browser headers, is refused);
 *   - the board's phone notifications obey it: Muted sends nothing from the project, Mentions only drops a room post
 *     that does not name the person, and an event with no project (an agent's own trouble) is never muted.
 *
 *   node --test server.projmute-7210.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-projmute-7210-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const STATE = path.join(SANDBOX, 'remote');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example.test/kosmos';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const phonenotify = require('./engine/phonenotify');
const fleet = require('./test-support/fleet');

const AGENT = 'ef'.repeat(16);
let base;
const sent = [];

/* Signed in to Kosmos+ and switched on, with phone notifications on and every kind on (postedRoom is opt-in). */
function enrol() {
  fs.mkdirSync(STATE, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  fs.writeFileSync(path.join(STATE, 'phone-notify.json'), JSON.stringify({ on: true, notifyId: '11111111-2222-4333-8444-555555555555',
    token: 'knt1_projmute0123456789', kinds: { needsYou: true, replied: true, postedMention: true, ready: true, postedRoom: true } }));
  const remoteFile = require('./engine/remote').FILE;
  fs.mkdirSync(path.dirname(remoteFile), { recursive: true });
  fs.writeFileSync(remoteFile, JSON.stringify({ on: true }));
}

test.before(async () => {
  phonenotify.setAvailableForTests(true);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = false;
  enrol();
  phonenotify.setSender((url, headers, body) => sent.push(JSON.parse(body)));
});
test.after(() => {
  phonenotify.setSender(null);
  try { fleet.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const stored = (id) => projects.readAll().find((p) => p.id === id);
const put = (id, body, headers) => fetch(`${base}/api/project/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asScreen = (id, body) => put(id, body, { 'sec-fetch-site': 'same-origin' });
const asAgent = (id, body) => put(id, body, { 'x-kosmos-agent-token': AGENT });

test('#7210 engine: the level is kept, read back, and "all" is never stored', () => {
  const p = projects.create({ name: 'Level Engine' });
  assert.equal(projects.get(p.id, []).notify, 'all', 'a project with no level did not read as all');
  projects.edit(p.id, { notify: 'muted' });
  assert.equal(stored(p.id).notify, 'muted');
  assert.equal(projects.notifyLevel(p.id), 'muted');
  assert.equal(projects.get(p.id, []).notify, 'muted');
  projects.edit(p.id, { notify: 'mentions' });
  assert.equal(projects.notifyLevel(p.id), 'mentions');
  projects.edit(p.id, { notify: 'all' });
  assert.equal('notify' in stored(p.id), false, '"all" was stored, so the record no longer reads as an older one does');
  for (const bad of ['Muted', 'off', '', null, true, ['muted']]) assert.throws(() => projects.edit(p.id, { notify: bad }), /notify must be one of/, String(bad));
  assert.equal(projects.notifyLevel('no-such-project'), 'all', 'a project not found must never read quieter than all');
});

test('#7210 route: only the person\'s screen sets the level; an agent (or a bare request) is refused and nothing changes', async () => {
  const p = projects.create({ name: 'Level Route' });
  const agent = await asAgent(p.id, { notify: 'muted' });
  assert.equal(agent.status, 403, await agent.text());
  const bare = await put(p.id, { notify: 'muted' }, {});
  assert.equal(bare.status, 403, 'a request with no token and no browser headers set the person\'s level');
  assert.equal(projects.notifyLevel(p.id), 'all', 'a refused request changed the level');
  // CONTROL: the same agent may still rename it, so the 403 above is about the level, not the route.
  assert.equal((await asAgent(p.id, { name: 'Level Route 2' })).status, 200);
  const screen = await asScreen(p.id, { notify: 'muted' });
  const said = await screen.text();
  assert.equal(screen.status, 200, said);
  assert.equal(JSON.parse(said).project.notify, 'muted');
  assert.equal(projects.notifyLevel(p.id), 'muted');
  const wrong = await asScreen(p.id, { notify: 'quiet' });
  assert.equal(wrong.status >= 400 && wrong.status < 500, true, 'a level the board does not know was accepted');
  assert.equal(projects.notifyLevel(p.id), 'muted', 'a refused level changed the stored one');
});

test('#7210 push: Muted sends nothing from the project; Mentions only keeps what is addressed to the person', () => {
  const all = projects.create({ name: 'Push All' });
  const mentions = projects.create({ name: 'Push Mentions' });
  const muted = projects.create({ name: 'Push Muted' });
  projects.edit(mentions.id, { notify: 'mentions' });
  projects.edit(muted.id, { notify: 'muted' });
  let n = 0;
  /* Each event its own agent, so no cooldown (per agent, or per room) hides a send. */
  const fire = (kind, extra) => { n += 1; sent.length = 0; phonenotify.happened({ kind, id: 'e' + n, agent: 'A' + n, session: 's' + n, ...extra }); return sent.length; };
  // CONTROL: on All, every kind reaches the phone, so a zero below is the level, not a dead sender.
  assert.equal(fire('posted', { namesPerson: false, project: 'Push All', projectId: all.id }), 1, 'CONTROL: a room post on All did not send');
  assert.equal(fire('needs_you', { project: 'Push All', levelProjectId: all.id }), 1, 'CONTROL: needs_you on All did not send');
  // Muted: nothing, whichever field names the project.
  assert.equal(fire('posted', { namesPerson: true, project: 'Push Muted', projectId: muted.id }), 0, 'a muted project\'s post naming the person was sent');
  assert.equal(fire('needs_you', { project: 'Push Muted', levelProjectId: muted.id }), 0, 'a muted project\'s needs_you was sent');
  assert.equal(fire('ready', { project: 'Push Muted', levelProjectId: muted.id }), 0, 'a muted project\'s ready was sent');
  // Mentions only: addressed to the person goes; any other room post does not.
  assert.equal(fire('posted', { namesPerson: false, project: 'Push Mentions', projectId: mentions.id }), 0, 'a room post not naming the person was sent on Mentions only');
  assert.equal(fire('posted', { namesPerson: true, project: 'Push Mentions', projectId: mentions.id }), 1, 'a post naming the person was dropped on Mentions only');
  assert.equal(fire('needs_you', { project: 'Push Mentions', levelProjectId: mentions.id }), 1);
  assert.equal(fire('ready', { project: 'Push Mentions', levelProjectId: mentions.id }), 1);
  // An agent's own trouble names no project and is never muted by one.
  assert.equal(fire('needs_you', { project: null }), 1, 'an event with no project was muted');
  // The board-only field never reaches the coordinator.
  fire('needs_you', { project: 'Push All', levelProjectId: all.id });
  assert.equal('levelProjectId' in sent[0], false, 'levelProjectId leaked into the payload the coordinator sees');
});

test('#7210 push: a muted event spends no cooldown, so unmuting does not swallow the next one', () => {
  const p = projects.create({ name: 'Push Cooldown' });
  projects.edit(p.id, { notify: 'muted' });
  sent.length = 0;
  phonenotify.happened({ kind: 'needs_you', id: 'c1', agent: 'Cool', session: 'cool', project: 'Push Cooldown', levelProjectId: p.id });
  assert.equal(sent.length, 0);
  projects.edit(p.id, { notify: 'all' });
  phonenotify.happened({ kind: 'needs_you', id: 'c2', agent: 'Cool', session: 'cool', project: 'Push Cooldown', levelProjectId: p.id });
  assert.equal(sent.length, 1, 'the muted event took the agent\'s 5-minute window, so the first unmuted one was dropped');
});
