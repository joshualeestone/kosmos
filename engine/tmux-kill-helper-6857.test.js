'use strict';
/* kosmos#6857: test-support/tmux-kill.js's killServerAt, with a FAKE tmux that records its arguments, so no real tmux
   server is ever started or ended here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { killServerAt, machineSockets } = require('../test-support/tmux-kill');

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

test("#6857: the machine's own socket is refused, written either way, and tmux is not run", { skip: typeof process.getuid !== 'function' && 'no uid here' }, (t) => {
  const f = fakeTmux(t);
  const uid = process.getuid();
  for (const p of ['/tmp/tmux-' + uid + '/default', '/tmp/./tmux-' + uid + '/default']) {
    assert.throws(() => killServerAt(f.bin, p), /machine's own tmux server/, p);
  }
  if (fs.existsSync('/private/tmp')) assert.throws(() => killServerAt(f.bin, '/private/tmp/tmux-' + uid + '/default'), /machine's own/);
  assert.deepEqual(f.calls(), []);
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
  const script = "const { killServerAt } = require(" + JSON.stringify(path.join(__dirname, '..', 'test-support', 'tmux-kill.js')) + ");\n"
    + 'try { killServerAt(' + JSON.stringify(f.bin) + ', ' + JSON.stringify(sock) + "); console.log('ran'); } catch (e) { console.log(e.message); }";
  const env = { ...process.env, TMUX_TMPDIR: f.dir };
  delete env.TMUX;
  const out = require('node:child_process').execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.match(out, /machine's own/);
  assert.deepEqual(f.calls(), []);
});

test('#6857: no socket path is an error, not a bare kill-server', () => {
  assert.throws(() => killServerAt('tmux', ''), /no socket path/);
  assert.throws(() => killServerAt('tmux'), /no socket path/);
});
