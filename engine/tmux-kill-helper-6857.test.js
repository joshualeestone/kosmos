'use strict';
/* kosmos#6857: test-support/tmux-kill.js's killServerAt, with a FAKE tmux that records its arguments, so no real tmux
   server is ever started or ended here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { killServerAt, machineSockets } = require('../test-support/tmux-kill');

/* Calls killServerAt in a fresh node, so what the module reads AT LOAD is under the test's control. `before` runs in
   the child after the helper loads and before the call. Prints 'ran' or the error's message. */
function inChild(env, bin, sock, before) {
  const script = 'const { killServerAt } = require(' + JSON.stringify(path.join(__dirname, '..', 'test-support', 'tmux-kill.js')) + ');\n'
    + (before || '') + '\n'
    + 'try { killServerAt(' + JSON.stringify(bin) + ', ' + JSON.stringify(sock) + "); console.log('ran'); } catch (e) { console.log(e.message); }";
  return require('node:child_process').execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
}
/* This process's env with every tmux variable removed, so one refusal cannot stand in for another (review 13: inside
   an agent's pane, $TMUX names the same socket as /tmp/tmux-<uid>/default). */
function noTmuxEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  for (const k of ['TMUX', 'TMUX_PANE', 'TMUX_TMPDIR']) if (!(extra && k in extra)) delete env[k];
  return env;
}

function fakeTmux(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k6857-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls');
  const bin = path.join(dir, 'tmux');
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@" >> "' + log + '"\n', { mode: 0o755 });
  return { dir, bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

test('#6857: a socket that is there is ended by -S <path> kill-server', { skip: process.platform === 'win32' && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  const sock = path.join(f.dir, 'tmux-1', 'default');
  fs.mkdirSync(path.dirname(sock));
  fs.writeFileSync(sock, '');
  killServerAt(f.bin, sock);
  assert.deepEqual(f.calls(), ['-S', sock, 'kill-server']);
});

test('#6857: no socket there, nothing is run (the case that used to fall back to the machine server)', { skip: process.platform === 'win32' && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  assert.equal(killServerAt(f.bin, path.join(f.dir, 'gone', 'tmux-1', 'default')), null);
  assert.deepEqual(f.calls(), [], 'tmux was run for a socket that is not there');
});

test("#6857: the machine's own socket is refused, written either way, with no tmux variable set, and tmux is not run", { skip: typeof process.getuid !== 'function' && 'no uid here' }, (t) => {
  const f = fakeTmux(t);
  const uid = process.getuid();
  const paths = ['/tmp/tmux-' + uid + '/default', '/tmp/./tmux-' + uid + '/default'];
  if (fs.existsSync('/private/tmp')) paths.push('/private/tmp/tmux-' + uid + '/default');
  for (const p of paths) assert.match(inChild(noTmuxEnv(), f.bin, p), /machine's own tmux server/, p);
  assert.deepEqual(f.calls(), []);
});

test('#6857: $TMUX read when the helper loads still refuses after a test deletes it (what live-connect does)', { skip: process.platform === 'win32' && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  const fleet = path.join(f.dir, 'fleet');
  fs.writeFileSync(fleet, '');
  assert.match(inChild(noTmuxEnv({ TMUX: fleet + ',1,0' }), f.bin, fleet, 'delete process.env.TMUX;'), /machine's own/);
  assert.deepEqual(f.calls(), []);
  // CONTROL: with $TMUX naming something else at load, the same file is ended.
  assert.equal(inChild(noTmuxEnv({ TMUX: path.join(f.dir, 'other') + ',1,0' }), f.bin, fleet, 'delete process.env.TMUX;').trim(), 'ran');
  assert.deepEqual(f.calls(), ['-S', fleet, 'kill-server']);
});

test('#6857: the socket $TMUX names is refused, even when $TMUX is read at the call', { skip: process.platform === 'win32' && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  const sock = path.join(f.dir, 'fleet');
  fs.writeFileSync(sock, '');
  const was = process.env.TMUX;
  t.after(() => { if (was === undefined) delete process.env.TMUX; else process.env.TMUX = was; });
  process.env.TMUX = sock + ',123,0';
  assert.ok(machineSockets().length >= 2);
  assert.throws(() => killServerAt(f.bin, sock), /machine's own/);
  // CONTROL: the same file is ended when $TMUX names something else.
  process.env.TMUX = path.join(f.dir, 'other') + ',1,0';
  killServerAt(f.bin, sock);
  assert.deepEqual(f.calls(), ['-S', sock, 'kill-server']);
});

test('#6857: a symlink to the machine socket is refused by the file it names (review 12)', { skip: process.platform === 'win32' && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  const fleet = path.join(f.dir, 'fleet');
  fs.writeFileSync(fleet, '');
  const link = path.join(f.dir, 'looks-private');
  fs.symlinkSync(fleet, link);
  const was = process.env.TMUX;
  t.after(() => { if (was === undefined) delete process.env.TMUX; else process.env.TMUX = was; });
  process.env.TMUX = fleet + ',1,0';
  assert.throws(() => killServerAt(f.bin, link), /machine's own/);
  assert.deepEqual(f.calls(), []);
});

test("#6857: a test's own TMUX_TMPDIR, set after load or passed in opts.env, is the server it ends, not the machine's", { skip: process.platform === 'win32' && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  const sock = path.join(f.dir, 'tmux-' + (process.getuid ? process.getuid() : 0), 'default');
  fs.mkdirSync(path.dirname(sock));
  fs.writeFileSync(sock, '');
  const was = process.env.TMUX_TMPDIR;
  t.after(() => { if (was === undefined) delete process.env.TMUX_TMPDIR; else process.env.TMUX_TMPDIR = was; });
  process.env.TMUX_TMPDIR = f.dir;   // what live-connect does after it requires the helper
  killServerAt(f.bin, sock, { env: { TMUX_TMPDIR: f.dir } });   // what last-look passes
  assert.deepEqual(f.calls(), ['-S', sock, 'kill-server']);
});

test('#6857: the default socket under the TMUX_TMPDIR the machine had at load is refused', { skip: (process.platform === 'win32' || typeof process.getuid !== 'function') && 'no tmux on Windows' }, (t) => {
  const f = fakeTmux(t);
  const sock = path.join(f.dir, 'tmux-' + process.getuid(), 'default');
  fs.mkdirSync(path.dirname(sock));
  fs.writeFileSync(sock, '');
  assert.match(inChild(noTmuxEnv({ TMUX_TMPDIR: f.dir }), f.bin, sock), /machine's own/);
  assert.deepEqual(f.calls(), []);
});

test('#6857: no socket path is an error, not a bare kill-server', () => {
  assert.throws(() => killServerAt('tmux', ''), /no socket path/);
  assert.throws(() => killServerAt('tmux'), /no socket path/);
});
