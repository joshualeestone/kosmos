'use strict';
/** #634: a board is sandboxed whole or not at all, and a half-sandboxed one refuses to start naming what is still live. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { audit, sentence } = require('./sandbox');

const clean = (over) => Object.assign({}, over);
const sb = '/tmp/x';

test('nothing sandboxed is the product, and is allowed', () => {
  assert.equal(audit(clean({})).partial, false);
});
test('all four directories plus a stub tmux is whole', () => {
  assert.equal(audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb, AGENT_WORKFORCE_WORKERS: sb, AGENT_WORKFORCE_LAUNCH: sb, AGENT_WORKFORCE_TMUX_BIN: '/x/tmux' })).partial, false);
});
/* 🛑 kosmos#1651. THIS TEST USED TO ASSERT THE OPPOSITE, and its NAME carried
   the false premise: "dry run makes every tmux call a no-op". It does not.
   DRY_RUN stops tmux WRITES. The roster is a READ, and engine/status.js never
   consults DRY_RUN (measured: 0 references, against 104 mentions of tmux); it
   resolves `AGENT_WORKFORCE_TMUX_BIN || 'tmux'`. A board sandboxed this way
   passed the guard and then enumerated the real fleet, 18 agents by name.
   ⇒ Only TMUX_BIN makes a READ inert, so only TMUX_BIN satisfies the guard. */
test('four directories plus DRY_RUN is NOT whole: DRY_RUN stops writes, not the roster read (#1651)', () => {
  const a = audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb, AGENT_WORKFORCE_WORKERS: sb, AGENT_WORKFORCE_LAUNCH: sb, AGENT_WORKFORCE_DRY_RUN: '1' }));
  assert.equal(a.partial, true, 'DRY_RUN alone satisfies the guard again, so a sandboxed board can still read the real fleet');
  assert.ok(a.live.some((l) => l.key === 'tmux'), 'tmux is not named as still-live, so the refusal will not tell anyone what to set');
});
test('the incident shape: DATA and PROJECTS sandboxed, WORKERS and tmux live, is refused and named', () => {
  const a = audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb }));
  assert.equal(a.partial, true);
  const keys = a.live.map((l) => l.key);
  assert.deepEqual(keys, ['AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_LAUNCH', 'tmux']);
  const s = sentence(a);
  assert.match(s, /CLAUDE\.md/, 'the sentence says what WORKERS is, in the words of the harm');
  /* kosmos#1651 widened this sentence: live tmux is now named as BOTH hazards,
     because the read is the one that bit. Asserted as the two properties
     rather than the old exact phrase, so the next rewording does not have
     to come back here. */
  assert.match(s, /read the real fleet/, 'the sentence no longer says live tmux READS the fleet, which is the #1651 half');
  assert.match(s, /type into one/, 'the sentence no longer says live tmux can be typed into, which is the original half');
  assert.match(s, /Sandbox all of them, or set none/);
});
test('all four directories with tmux still real is refused: the tmux leg has no file to restore from', () => {
  const a = audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb, AGENT_WORKFORCE_WORKERS: sb, AGENT_WORKFORCE_LAUNCH: sb }));
  assert.equal(a.partial, true);
  assert.deepEqual(a.live.map((l) => l.key), ['tmux']);
});
test('the override is a sentence in the environment, and it works', () => {
  assert.equal(audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_HALF_SANDBOX_OK: '1' })).partial, false);
});
test('#883: a non-default KOSMOS_HOME derives DATA/PROJECTS/WORKERS but deliberately leaves LAUNCH and tmux real, and sets the override', () => {
  // install/setup.sh's own shape for this exact case (found in #883's own
  // challenge-loop: without AGENT_WORKFORCE_HALF_SANDBOX_OK, this env is
  // "the incident shape" above with a third leg sandboxed too -- refused,
  // and Pete's real release-walk convention (KOSMOS_HOME + _APP_DIR + PORT,
  // nothing else) never sets AGENT_WORKFORCE_LAUNCH or a tmux-inert flag,
  // so it would hit this exact refusal on every walk without the override).
  const a = audit(clean({
    AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb, AGENT_WORKFORCE_WORKERS: sb,
    AGENT_WORKFORCE_HALF_SANDBOX_OK: '1',
  }));
  assert.equal(a.partial, false, 'the derived shape must not refuse to start');
});
test('server.js as a program refuses a half-sandboxed environment with exit 2 and the sentence, before listening', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-half-'));
  const env = {};
  for (const k of Object.keys(process.env)) if (!/^AGENT_WORKFORCE_/.test(k)) env[k] = process.env[k];
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...env, PORT: '0', AGENT_WORKFORCE_DATA: path.join(tmp, 'data') },
    encoding: 'utf8', timeout: 15000,
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 2, 'stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.match(r.stderr, /will not start half-sandboxed/);
  assert.match(r.stderr, /AGENT_WORKFORCE_WORKERS/);
  assert.doesNotMatch(r.stdout, /Kosmos on http/, 'it must refuse before it listens');
});
