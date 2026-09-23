'use strict';

/**
 * #3492: the three primitives behind "Write a handoff, then restart", driven
 * against the real server with a fake tmux (a real live-session resolution, an
 * empty board otherwise). The load-bearing route behaviours:
 *  - ask     delivers a prompt to a RUNNING agent and returns the handoff path +
 *            the current-mtime baseline; it 409s a not-running agent (nothing to
 *            hand off) and 404s an unknown one.
 *  - status  reports fresh:false until the handoff file appears/advances past the
 *            baseline, then fresh:true -- the gate the client restarts on.
 *  - pickup  delivers the pointer to the (freshly restarted) session.
 *
 * The pure prompt/freshness logic is tested in engine/handoff-restart.test.js;
 * this proves the WIRING -- path resolution (same file the sweep writes), the
 * gates, and the freshness flip.
 *
 *   node --test server.handoff-restart-3492.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-handoff-restart-3492-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) {
  fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;

const FAKE_TMUX = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
const PANES = nodePath.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_TMUX_BIN = FAKE_TMUX;
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;

const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const store = require('./engine/store');
const autohandoffSweep = require('./engine/autohandoff-sweep');
const handoffRestart = require('./engine/handoff-restart');

function born(name) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');
  return name;
}
function stopped() { fs.writeFileSync(PANES, ''); }

// The path the routes resolve to, computed the SAME way they do, so a drift in
// path resolution fails the test rather than passing against a wrong file.
function handoffPathOf(name) {
  return autohandoffSweep.handoffPathFor(store, name + '-discord');
}

const { start, server } = require('./server');
let base = '';

test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  try { server.close(); } catch { /* going away anyway */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function hit(method, p) {
  const res = await fetch(base + '/api/agent/' + p, { method });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

test('ask: a running agent gets a prompt, and the response names the handoff path + baseline', async () => {
  const name = 'hr-ask';
  born(name);
  // No handoff file yet.
  try { fs.unlinkSync(handoffPathOf(name)); } catch { /* absent */ }
  const r = await hit('POST', encodeURIComponent(name) + '/handoff-restart/ask');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.delivery, 'a delivery verdict came back');
  assert.notEqual(r.body.delivery.state, 'could_not', 'the prompt was not refused: ' + JSON.stringify(r.body.delivery));
  assert.equal(r.body.handoffPath, handoffPathOf(name), 'the route resolves the same handoff path the sweep writes');
  // No file yet -> baseline is empty (any later appearance is fresh).
  assert.equal(r.body.baseline, '', 'baseline is empty when no handoff exists yet');
});

test('status: fresh flips false -> true only once the handoff is (re)written', async () => {
  const name = 'hr-status';
  born(name);
  const p = handoffPathOf(name);
  try { fs.unlinkSync(p); } catch { /* absent */ }

  // Baseline empty (no file). Before the write: not fresh.
  let r = await hit('GET', encodeURIComponent(name) + '/handoff-restart/status?baseline=');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.fresh, false, 'no handoff yet: not fresh');
  assert.equal(r.body.exists, false);

  // The agent writes its handoff.
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, '# handoff\nbranch and next steps\n', 'utf8');
  r = await hit('GET', encodeURIComponent(name) + '/handoff-restart/status?baseline=');
  assert.equal(r.body.fresh, true, 'the handoff appeared: fresh');
  assert.equal(r.body.exists, true);

  // 🛑 Red control: an UNCHANGED file against its own mtime baseline must NOT
  // read fresh -- otherwise a restart would proceed on a handoff never rewritten.
  const mtimeMs = fs.statSync(p).mtimeMs;
  r = await hit('GET', encodeURIComponent(name) + '/handoff-restart/status?baseline=' + encodeURIComponent(String(mtimeMs)));
  assert.equal(r.body.fresh, false, 'same mtime as baseline: not fresh (the dangerous direction)');

  // A rewrite that advances the mtime IS fresh.
  const later = mtimeMs + 5000;
  fs.utimesSync(p, new Date(later), new Date(later));
  r = await hit('GET', encodeURIComponent(name) + '/handoff-restart/status?baseline=' + encodeURIComponent(String(mtimeMs)));
  assert.equal(r.body.fresh, true, 'mtime advanced past baseline: fresh');
});

test('status: a malformed baseline is REFUSED (400), never silently reported fresh', async () => {
  // 🛑 The dangerous direction: a bad baseline must NOT coerce into a snapshot
  // that reads fresh for a pre-existing handoff. `Number('abc')` is NaN (the
  // unreadable-time trap), and `Number(' ')`/`Number('-1')` are finite 0/-1 (the
  // whitespace/negative traps) -- all three would otherwise report fresh:true
  // for any agent whose handoff merely exists, with no new write.
  const name = 'hr-badbaseline';
  born(name);
  const p = handoffPathOf(name);
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, '# an OLD handoff, unrelated to this restart\n', 'utf8'); // file exists from a prior write
  for (const bad of ['abc', ' ', '-1', '1e3', '0x5', '  5  ', 'NaN', 'Infinity', '5.5.5']) {
    const r = await hit('GET', encodeURIComponent(name) + '/handoff-restart/status?baseline=' + encodeURIComponent(bad));
    assert.equal(r.status, 400, `baseline='${bad}' must be a 400: ` + JSON.stringify(r.body));
    assert.notEqual(r.body && r.body.fresh, true, `baseline='${bad}' must never report fresh:true`);
  }
  // CONTROL: a legitimate numeric baseline (a real mtime) is accepted, not refused.
  const ok = await hit('GET', encodeURIComponent(name) + '/handoff-restart/status?baseline=1727000000000.5');
  assert.equal(ok.status, 200, 'a valid numeric baseline is accepted: ' + JSON.stringify(ok.body));
});

test('pickup: a running agent gets the pointer delivery', async () => {
  const name = 'hr-pickup';
  born(name);
  const r = await hit('POST', encodeURIComponent(name) + '/handoff-restart/pickup');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.delivery, 'a delivery verdict came back');
  assert.notEqual(r.body.delivery.state, 'could_not');
  assert.equal(r.body.handoffPath, handoffPathOf(name));
});

test('not running / unknown: all three routes 404 (pane-gated, like the thread route)', async () => {
  /* These routes gate on knownAgent, which is pane-based: an agent with no live
     pane is simply not known to them, so a stopped-but-born agent and a name
     nobody ever ran both 404 -- the same gate the /thread send uses. The
     confirm dialog these back is only shown for a RUNNING agent (a fully-dead
     one gets the separate Start button), so 404 here is the correct floor. The
     409 "known but sessionless" arm in the routes is defensive for the rare
     card-without-session case, which the pane fixtures cannot produce. */
  const born1 = 'hr-stopped';
  born(born1);
  stopped(); // empty board: neither a born-but-stopped agent nor a stranger is known
  for (const name of [born1, 'nobody-here']) {
    for (const [method, suffix] of [['POST', 'ask'], ['GET', 'status'], ['POST', 'pickup']]) {
      const r = await hit(method, encodeURIComponent(name) + '/handoff-restart/' + suffix);
      assert.equal(r.status, 404, suffix + ' for a not-running/unknown agent should be 404: ' + JSON.stringify(r.body));
    }
  }
});

test('an undecodable name is 400 on ALL three routes (consistent within the feature)', async () => {
  // %ZZ is an invalid percent-escape, so decodeSegment returns null. All three
  // feature routes must agree on 400 (malformed request), not split 400/404.
  for (const [method, suffix] of [['POST', 'ask'], ['GET', 'status'], ['POST', 'pickup']]) {
    const r = await hit(method, '%ZZ/handoff-restart/' + suffix);
    assert.equal(r.status, 400, suffix + ' on an undecodable name should be 400: ' + JSON.stringify(r.body));
  }
});

test('the prompts delivered are the engine\'s, not a re-typed copy', () => {
  // A cross-check that the module the routes call produces the intended text --
  // guards against a future edit that swaps in an inline string here or there.
  const p = handoffPathOf('anyone');
  assert.match(handoffRestart.handoffForRestartPrompt(p), /about to be restarted/);
  assert.match(handoffRestart.pickupPrompt(p), /[Rr]ead your handoff/);
});
