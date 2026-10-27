'use strict';
/* kosmos#6389: the /api/remote/forget route. A Remove that could not reach Kosmos+ removed nothing (the engine
   answers kept), and { anyway: true } is the person's choice to remove it from this computer only. The page and
   the engine are tested on their own; this pins the route between them, against the real server, with the
   engine's forget replaced so each answer can be chosen. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remote-forget-6389-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');

let base;
const calls = [];
let answer = null;
const realForget = remote.forget;
remote.forget = async (opts) => { calls.push(opts); return answer; };
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  remote.forget = realForget;
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const post = async (init) => {
  const res = await fetch(base + '/api/remote/forget', { method: 'POST', ...init });
  return { status: res.status, body: await res.json() };
};
const json = (obj) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

test('#6389: an empty body is a plain Remove, and a kept answer is relayed as not done', async () => {
  calls.length = 0;
  answer = { ok: false, kept: true, retired: false, address: 'hers.kosmos.invalid', because: 'this computer is not removed yet, because your Kosmos+ account could not be reached (x)' };
  const got = await post({});
  assert.deepEqual(calls, [{ anyway: false }], 'an empty body was not a plain Remove');
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, false, 'a kept Remove was relayed as done');
  assert.equal(got.body.kept, true, 'the route dropped kept');
  assert.equal(got.body.because, answer.because);
  assert.equal(got.body.address, 'hers.kosmos.invalid');
});

test('#6389: { anyway: true } reaches the engine, and only a real true does', async () => {
  answer = { ok: true, retired: false, address: 'hers.kosmos.invalid', because: 'this computer is forgotten here, but ...' };
  calls.length = 0;
  const got = await post(json({ anyway: true }));
  assert.deepEqual(calls, [{ anyway: true }]);
  assert.equal(got.body.ok, true);
  assert.equal(got.body.kept, undefined, 'a done Remove carried kept');
  calls.length = 0;
  await post(json({ anyway: 'true' }));
  await post(json({ anyway: 1 }));
  assert.deepEqual(calls, [{ anyway: false }, { anyway: false }], 'something other than true was read as anyway');
});

test('#6389: GET /api/remote says a kept Remove after a reload, from remote.json', async () => {
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: false, forget_kept: 'this computer is not removed yet, because z' }));
  const kept = await (await fetch(base + '/api/remote')).json();
  assert.equal(kept.forgetKept, 'this computer is not removed yet, because z');
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: false }));
  const none = await (await fetch(base + '/api/remote')).json();
  assert.equal(none.forgetKept, '', 'a computer with no kept Remove reported one');
});

test('#6389: an unreadable or oversized body is refused with 400 and forgets nothing', async () => {
  calls.length = 0;
  const bad = await post({ headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400);
  // readBody ends the connection on an oversized body, so the client may get no answer at all.
  const big = await post(json({ anyway: true, pad: 'x'.repeat(8192) })).catch(() => null);
  if (big) assert.equal(big.status, 400, 'an oversized body answered ' + big.status);
  assert.deepEqual(calls, [], 'a refused request still forgot this computer');
});

test('#7277: on a Kosmos cloud machine the route refuses and never reaches the engine; on any other computer it does', async (t) => {
  const cm = require('./engine/cloudmachine');
  const real = cm.isCloudMachine;
  t.after(() => { cm.isCloudMachine = real; });
  cm.isCloudMachine = () => true;
  calls.length = 0;
  answer = { ok: true, retired: true, address: 'hers.kosmos.invalid', because: null };
  const refused = await post(json({ anyway: true }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.cloud, true);
  assert.match(refused.body.error, /no way back/);
  assert.deepEqual(calls, [], 'a cloud machine reached the engine\'s forget, even with anyway');
  // CONTROL: the same request on a computer that is not a cloud machine reaches the engine, so the refusal is the cloud.
  cm.isCloudMachine = () => false;
  const done = await post({});
  assert.equal(done.status, 200);
  assert.deepEqual(calls, [{ anyway: false }]);
});
