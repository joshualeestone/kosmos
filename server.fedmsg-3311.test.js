'use strict';

/**
 * #3311: the message path through server.js. A federated project's room shows a
 * message from outside as an external row (JSON and `kosmos room` text), and an
 * operator post that lands in that room is sent out through the project's seat.
 * The connector is a fake child; nothing reaches a relay.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.fedmsg-3311.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fedmsg-3311-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');
const federation = require('./engine/federation');
const fedseats = require('./engine/fedseats');

const children = [];
fedseats.configure({
  spawnSeat: (edge) => {
    const c = new EventEmitter();
    c.stdin = new PassThrough();
    c.stdout = new PassThrough();
    c.edge = edge;
    c.written = [];
    c.stdin.on('data', (d) => c.written.push(String(d)));
    children.push(c);
    return c;
  },
  macRequest: async () => ({ ok: false, because: 'not used' }),
  recordExternal: (projectId, msg) => messages.externalPost(projectId, msg),
  enrolled: () => true,
});

let base;
let pid;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  pid = projects.create({ name: 'Shared Club' }).id;
  federation.recordLink(pid, { role: 'member', edge_id: 'edge-9', project_name: 'Shared Club' });
  await fedseats.ensure(pid);
  children[0].stdout.write(JSON.stringify({ event: 'connected', room: 'r', expires_at: 9 }) + '\n');
  await new Promise((r) => setImmediate(r));
});
test.after(() => { fedseats.stopAll(); try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('a delivered message shows in the room as external, in JSON and in the text view', async () => {
  children[0].stdout.write(JSON.stringify({ event: 'message', data: { from: 'Ada', kind: 'agent', text: 'hello from outside' } }) + '\n');
  await new Promise((r) => setImmediate(r));
  const json = await (await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room`)).json();
  const rows = (json.rows || json.messages || json.thread || (Array.isArray(json) ? json : [])).filter((m) => m.kind === 'external');
  assert.equal(rows.length, 1, JSON.stringify(json).slice(0, 400));
  assert.equal(rows[0].from, 'Ada');
  assert.equal(rows[0].fromKind, 'agent');
  assert.equal(rows[0].external, true);

  const text = await (await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room?as=text`)).text();
  assert.match(text, /\[external agent\] Ada: hello from outside/);
});

test('an operator post that lands in a federated room goes out through its seat, under their name', async () => {
  require('./engine/you').save({ name: 'Josh Stone', does: 'runs this computer' });
  const before = children[0].written.length;
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ text: 'welcome in' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.delivery && body.delivery.id, 'the post landed: ' + JSON.stringify(body));
  await new Promise((r) => setImmediate(r));
  const out = JSON.parse(children[0].written.slice(before).join('').trim());
  assert.equal(out.kind, 'person');
  assert.equal(out.text, 'welcome in');
  assert.equal(out.from, 'Josh Stone', 'the name from the About you screen, not the fallback');
});
