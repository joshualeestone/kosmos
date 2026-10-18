'use strict';

/**
 * kosmos#6362 slice 2: killUnderScope ends the processes naming this file's tmpscope dir, group and all, and nothing
 * else. It takes no dir: the scope is the only one it can search for.
 *
 *   node --test test-support.stray-processes.test.js
 */
const tmpscope = require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const stray = require('./test-support/stray-processes');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (g) => { try { process.kill(-g, 0); return true; } catch { return false; } };
const posix = { skip: process.platform === 'win32' && 'POSIX ps' };
/* A detached sh naming `arg` (as its $0, the way git -C carries a path), with a sleep child that does not name it. */
const holder = (arg) => spawn('/bin/sh', ['-c', 'sleep 30 & wait', arg], { detached: true, stdio: 'ignore' });
/* Wait (up to 3 s) until every given process has a child, rather than a fixed pause a loaded Mac can outrun (review 8). */
const kidsOf = (pid) => require('node:child_process').spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
const inGroup = (g) => require('node:child_process').spawnSync('pgrep', ['-g', String(g)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
/* The double-fork fixtures have no child of ours to wait for: wait until their group holds `n` processes. */
const settleGroup = async (g, n) => {
  const until = Date.now() + 3000;
  do { await new Promise((r) => setTimeout(r, 100)); } while (inGroup(g).length < n && Date.now() < until);
};
const settle = async (...pids) => {
  const until = Date.now() + 3000;
  do { await new Promise((r) => setTimeout(r, 100)); } while (pids.some((p) => !kidsOf(p).length) && Date.now() < until);
};

test('a process naming the scope dir is ended with its group; a prefix sibling and another dir are left alone (CONTROLS)', posix, async () => {
  const scope = tmpscope.scopeDir();
  assert.ok(scope, 'fixture: this file has a tmpscope dir');
  const named = holder(path.join(scope, 'plugins-clone'));
  const prefix = holder(scope + 'x');   // the scope dir as a prefix of another name: not a path under it
  const other = holder(path.dirname(scope));   // not os.tmpdir(): tmpscope points TMPDIR at the scope itself
  try {
    await settle(named.pid, prefix.pid, other.pid);
    for (const c of [named, prefix, other]) assert.ok(groupAlive(c.pid), 'fixture: a holder did not start');
    assert.equal(kidsOf(named.pid).length, 1, 'fixture: the named holder has its sleep child (else a pid-only kill would pass)');
    assert.equal(stray.killUnderScope(), 1, 'it found the one process naming the scope dir');
    // No sleep here: killUnderScope waits until nothing in the group is running, its child (which names nothing) included.
    // Running, not answering kill(-g, 0): our own unreaped child stays a zombie until this test yields (review 2).
    assert.equal(stray.liveInGroup(named.pid), false, 'the named process or its child is still running');
    assert.equal(alive(prefix.pid), true, 'a name that only starts with the scope dir was ended');
    assert.equal(alive(other.pid), true, 'a process naming another dir was ended');
    assert.equal(stray.killUnderScope(), 0, 'nothing is left to end');
  } finally {
    for (const c of [named, prefix, other]) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});

test('in this test\'s own process group, the named process and its child are ended, and the test is not (review 3)', posix, async () => {
  const scope = tmpscope.scopeDir();
  // Not detached: the holder shares our group, so a group kill would end this test too.
  const holder = spawn('/bin/sh', ['-c', 'sleep 30 & wait', path.join(scope, 'plugins-clone')], { stdio: 'ignore' });
  let child = null;
  try {
    await settle(holder.pid);
    const kids = require('node:child_process').spawnSync('pgrep', ['-P', String(holder.pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    assert.equal(kids.length, 1, 'fixture: the holder has its sleep child');
    child = Number(kids[0]);
    assert.equal(stray.killUnderScope(), 1);
    const runningPid = (pid) => { try { return !/^Z/.test(require('node:child_process').spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim() || 'Z'); } catch { return false; } };
    assert.equal(runningPid(holder.pid), false, 'the named process is still running');
    assert.equal(runningPid(child), false, 'its child (which names nothing) is still running');
  } finally {
    // Its children too, read again here, so a fixture that failed before `child` was set leaves no sleep running.
    const again = require('node:child_process').spawnSync('pgrep', ['-P', String(holder.pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).map(Number);
    for (const pid of [holder.pid, child, ...again]) { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  }
});

test('a descendant two unnamed processes below this test that names the dir is this test\'s, and is ended (review 12)', posix, async () => {
  const scope = tmpscope.scopeDir();
  // outer and mid name nothing (the dir comes through the environment); the innermost names it.
  const outer = spawn('/bin/sh', ['-c', 'sh -c \'sh -c "sleep 30 & wait" "$P"; :\'; :'],
    { detached: true, stdio: 'ignore', env: { ...process.env, P: path.join(scope, 'deep') } });
  try {
    await settleGroup(outer.pid, 4);
    assert.ok(inGroup(outer.pid).length >= 4, 'fixture: outer, mid, the named shell and its sleep are running');
    assert.equal(stray.killUnderScope(), 1, 'the named descendant two hops down was not found as this test\'s');
    const left = inGroup(outer.pid).map(Number).filter((pid) => !/^Z|^$/.test(require('node:child_process').spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()));
    assert.equal(left.length, 0, 'the named process\'s group still has running processes: ' + left.join(' '));
  } finally {
    try { process.kill(-outer.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

test('a process that names the dir but is not this test\'s (another agent\'s shell, say) is left alone (review 7)', posix, async () => {
  const scope = tmpscope.scopeDir();
  // Double fork: the middle shell names nothing and is orphaned to init, like an unrelated shell; under it, a process
  // that does name the dir. Its chain never reaches this test and runs through a process naming nothing.
  const outer = spawn('/bin/sh', ['-c', '( sh -c "sleep 30 & wait" "$P" & wait ) & exit 0'],
    { detached: true, stdio: 'ignore', env: { ...process.env, P: path.join(scope, 'looked-at') } });
  try {
    await settleGroup(outer.pid, 2);
    // Until outer has exited, so the middle shell is orphaned: while outer lives, the chain still reaches this test.
    for (const until = Date.now() + 3000; alive(outer.pid) && Date.now() < until;) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(outer.pid), false, 'fixture: the outer shell did not exit');
    const before = require('node:child_process').spawnSync('pgrep', ['-g', String(outer.pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    assert.ok(before.length >= 2, 'fixture: the orphaned shell and its child are running');
    assert.equal(stray.killUnderScope(), 0, 'it acted on a process that is not this test\'s');
    assert.equal(groupAlive(outer.pid), true, 'the unrelated group was killed');
  } finally {
    try { process.kill(-outer.pid, 'SIGKILL'); } catch { /* gone */ }   // the fixture's own group, never a name
  }
});

test('an orphan inside our own group that names the dir (the codexhooks shape: git under a non-detached Codex) is ended, with its child (review 9)', posix, async (t) => {
  const scope = tmpscope.scopeDir();
  // Not detached: the middle shell is ours and in our group; it exits at once, so the one naming the dir is reparented
  // to init but stays in our process group, as the git under codexhooks' non-detached Codex does.
  const outer = spawn('/bin/sh', ['-c', 'sh -c "sleep 30 & wait" "$P" & echo $! ; exit 0'],
    { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, P: path.join(scope, '.tmp', 'plugins-clone-y') } });
  // Its pid from the first line: not 'end', as the orphan inherits the pipe and holds it open.
  const orphanPid = Number(await new Promise((r) => {
    let b = '';
    outer.stdout.on('data', (d) => { b += d; if (b.includes('\n')) r(b.trim()); });
    outer.on('close', () => r(b.trim()));   // never a hang if outer dies before printing (review 13)
  }));
  assert.ok(orphanPid > 0, 'fixture: the orphan\'s pid was never printed');
  outer.stdout.destroy();
  let kids = [];
  try {
    const until = Date.now() + 3000;
    const ppidOf = (p) => Number(require('node:child_process').spawnSync('ps', ['-o', 'ppid=', '-p', String(p)], { encoding: 'utf8' }).stdout.trim());
    while ((ppidOf(orphanPid) !== 1 || !kidsOf(orphanPid).length) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    kids = kidsOf(orphanPid).map(Number);   // before any skip, so finally can end them (review 11)
    assert.ok(ppidOf(orphanPid) > 0, 'fixture: the orphan is not running');   // not a broken fixture read as a subreaper
    if (ppidOf(orphanPid) !== 1) { t.skip('this host reparents orphans to a subreaper, not pid 1 (not handled; see stray-processes.js)'); return; }
    assert.equal(kids.length, 1, 'fixture: the orphan has its sleep child');
    assert.equal(stray.killUnderScope(), 1, 'the orphan in our own group was not found as this test\'s');
    const running = (p) => !/^Z|^$/.test(require('node:child_process').spawnSync('ps', ['-o', 'stat=', '-p', String(p)], { encoding: 'utf8' }).stdout.trim());
    assert.equal(running(orphanPid), false, 'the orphan is still running');
    assert.equal(running(kids[0]), false, 'its child is still running');
  } finally {
    for (const p of [orphanPid, ...kids]) { if (p) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } }
  }
});

test('an orphan in another group that names the dir (orgchartcodex: git under a detached Codex) is ended, with its child', posix, async (t) => {
  const scope = tmpscope.scopeDir();
  // The middle shell exits at once, so the one naming the dir is reparented to init, as Codex's plugin-sync git was.
  const outer = spawn('/bin/sh', ['-c', 'sh -c "sleep 30 & wait" "$P" & exit 0'],
    { detached: true, stdio: 'ignore', env: { ...process.env, P: path.join(scope, '.tmp', 'plugins-clone-x') } });
  try {
    await settleGroup(outer.pid, 2);
    // Until the middle shell has exited and its child is reparented, not just until the group has two members (review 9).
    const ppidsNow = () => inGroup(outer.pid).map((p) => Number(require('node:child_process').spawnSync('ps', ['-o', 'ppid=', '-p', p], { encoding: 'utf8' }).stdout.trim()));
    for (const until = Date.now() + 3000; !ppidsNow().includes(1) && alive(outer.pid) && Date.now() < until;) await new Promise((r) => setTimeout(r, 100));
    const orphan = inGroup(outer.pid);
    assert.ok(orphan.length >= 2, 'fixture: the orphan and its child are running');
    // A host that reparents orphans to a subreaper, not pid 1, is the documented gap: say so rather than fail (review 8).
    const ppids = orphan.map((p) => Number(require('node:child_process').spawnSync('ps', ['-o', 'ppid=', '-p', p], { encoding: 'utf8' }).stdout.trim()));
    if (!ppids.includes(1)) { t.skip('this host reparents orphans to a subreaper, not pid 1 (not handled; see stray-processes.js)'); return; }
    assert.equal(stray.killUnderScope(), 1, 'the orphan naming the dir was not found as this test\'s');
    assert.equal(stray.liveInGroup(outer.pid), false, 'the orphan or its child is still running');
  } finally {
    try { process.kill(-outer.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

test('names: the dir as a whole path or a path under it, in either spelling; never as a prefix of another name', () => {
  const d = '/var/folders/xy/kts-AbC123';
  assert.equal(stray.names('git -C ' + d + '/home/.tmp fetch', [d]), true);
  assert.equal(stray.names('cat ' + d, [d]), true);
  assert.equal(stray.names('ls ' + d + ' -la', [d]), true);
  assert.equal(stray.names('ls ' + d + 'x', [d]), false);
  assert.equal(stray.names('ls ' + d + 'x ' + d + '/y', [d]), true, 'a later whole-path mention still counts');
  assert.equal(stray.names('ls /private' + d + '/y', [d, '/private' + d]), true);
  assert.equal(stray.names('ls /tmp/other', [d]), false);
  assert.equal(stray.names('x ' + d + '\tfoo', [d]), true, 'a tab bounds it');
  assert.equal(stray.names('x "' + d + '"', [d]), true, 'a quote bounds it');
  assert.equal(stray.names('PATH=/bin:' + d + ':/usr/bin', [d]), true, 'a colon bounds it');
  assert.equal(stray.names('ls /mnt' + d + '/z', [d]), false, 'a longer path ending in it is another name');
  assert.equal(stray.names('git -C' + d + '/x fetch', [d]), true, 'a one-letter option glued to it');
  assert.equal(stray.names('cc -I' + d + '/inc', [d]), true);
  assert.equal(stray.names('x a-C' + d, [d]), false, 'a name ending in -C is not an option');
  assert.equal(stray.names('tar -xC' + d + '/x', [d]), true, 'combined short options glued to it');
  assert.equal(stray.names('ls /mnt/foo-abcdefghijklmno' + d + '/z', [d]), false, 'a dash and letters inside a word are not an option (review 9)');
  // Only an absolute path is a spelling (review 6): '' would loop forever, '.' would name every relative path.
  assert.equal(stray.names('git -C . status', ['.']), false);
  assert.equal(stray.names('ls ./x', ['']), false);
  assert.equal(stray.names('ls /x', ['/']), false);
});
