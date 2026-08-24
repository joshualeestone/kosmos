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
test('all four directories plus DRY_RUN is whole: dry run makes every tmux call a no-op', () => {
  assert.equal(audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb, AGENT_WORKFORCE_WORKERS: sb, AGENT_WORKFORCE_LAUNCH: sb, AGENT_WORKFORCE_DRY_RUN: '1' })).partial, false);
});
test('the incident shape: DATA and PROJECTS sandboxed, WORKERS and tmux live, is refused and named', () => {
  const a = audit(clean({ AGENT_WORKFORCE_DATA: sb, AGENT_WORKFORCE_PROJECTS: sb }));
  assert.equal(a.partial, true);
  const keys = a.live.map((l) => l.key);
  assert.deepEqual(keys, ['AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_LAUNCH', 'tmux']);
  const s = sentence(a);
  assert.match(s, /CLAUDE\.md/, 'the sentence says what WORKERS is, in the words of the harm');
  assert.match(s, /type into a real agent/, 'the sentence says what live tmux does');
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
