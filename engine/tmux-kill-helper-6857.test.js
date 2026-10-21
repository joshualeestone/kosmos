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

test('#6857: no socket path is an error, not a bare kill-server', () => {
  assert.throws(() => killServerAt('tmux', ''), /no socket path/);
  assert.throws(() => killServerAt('tmux'), /no socket path/);
});
