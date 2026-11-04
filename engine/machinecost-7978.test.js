'use strict';
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const mc = require('./machinecost');

const row = (pid, ppid, kb, cpu, etime, comm) => `${pid} ${ppid} ${kb} ${cpu} ${etime} ${comm}`;
const table = (...rows) => mc.parsePs(rows.join('\n'));
const GB = 1024 * 1024;

test('a pane tree is summed through its children, and each process counted once', () => {
  const procs = table(row(10, 1, 1000, 0.5, '01:00', '-zsh'), row(11, 10, 400 * 1024, 20.5, '01:00', '/opt/homebrew/bin/node'), row(12, 11, 100 * 1024, 10, '00:30', 'bash'), row(99, 1, 900 * 1024, 90, '01:00', 'Slack'));
  const out = mc.costBySession(mc.parsePanes('angel\t10\t/w/a\n'), procs);
  assert.deepEqual(Object.keys(out), ['angel']);
  assert.equal(out.angel.memMb, 501);
  assert.equal(out.angel.cpuPct, 31);
  assert.equal(out.angel.processes, 3);
  assert.deepEqual(out.angel.top, { name: 'node', memMb: 400, cpuPct: 21, days: 0, left: false, pid: 11 });
  assert.equal(out.angel.leftMemMb, 0);
});

test('every pane of a session counts', () => {
  const procs = table(row(10, 1, 1024, 0, '01:00', 'zsh'), row(20, 1, 2048, 0, '01:00', 'zsh'));
  assert.equal(mc.costBySession(mc.parsePanes('a\t10\t/w/a\na\t20\t/w/a\n'), procs).a.memMb, 3);
});

test('a recycled parent making a cycle ends, and counts each once', () => {
  const procs = table(row(10, 11, 1024, 0, '01:00', 'a'), row(11, 10, 1024, 0, '01:00', 'b'));
  assert.equal(mc.costBySession(mc.parsePanes('a\t10\t/w/a\n'), procs).a.processes, 2);
});

test('a left-behind process is its agent\'s, marked, with what runs under it, and its age is said', () => {
  const procs = table(row(10, 1, 1024, 0, '01:00', 'zsh'), row(50, 1, 6.5 * GB, 99.9, '14-02:03:04', '/bin/bash'), row(51, 50, 1024, 0, '14-02:03:04', 'sleep'));
  const out = mc.costBySession(mc.parsePanes('angel\t10\t/w/a\n'), procs, new Map([[50, 'angel']]));
  assert.equal(out.angel.processes, 3);
  assert.equal(out.angel.leftMemMb, 6657);
  assert.deepEqual(out.angel.top, { name: 'bash', memMb: 6656, cpuPct: 100, days: 14, left: true, pid: 50 });
});

test('CONTROL: with no owner named, the same process belongs to nobody', () => {
  const procs = table(row(10, 1, 1024, 0, '01:00', 'zsh'), row(50, 1, 6.5 * GB, 99.9, '14-02:03:04', '/bin/bash'));
  const out = mc.costBySession(mc.parsePanes('angel\t10\t/w/a\n'), procs, new Map());
  assert.equal(out.angel.memMb, 1);
});

test('an agent with no pane left still shows what it left behind', () => {
  const procs = table(row(50, 1, GB, 0, '03-00:00:00', 'node'));
  const out = mc.costBySession(new Map(), procs, new Map([[50, 'gone']]));
  assert.equal(out.gone.memMb, 1024);
  assert.equal(out.gone.top.days, 3);
});

test('only large parentless processes outside every tree are asked about, largest first, and bounded', () => {
  const big = mc.LEFT_MIN_KB;
  const procs = table(row(1, 0, 10, 0, '01:00', 'launchd'), row(2, 1, big - 1, 0, '01:00', 'small'), row(3, 1, big, 0, '01:00', 'big'), row(4, 1, 10, mc.LEFT_MIN_CPU, '01:00', 'busy'), row(5, 7, big * 2, 0, '01:00', 'haschild'), row(6, 1, big * 3, 0, '01:00', 'intree'));
  assert.deepEqual(mc.leftCandidates(procs, new Set([6])).map((p) => p.pid), [3, 4]);
  const many = table(...Array.from({ length: 30 }, (_, i) => row(100 + i, 1, big + i, 0, '01:00', 'x')));
  assert.equal(mc.leftCandidates(many, new Set()).length, mc.LEFT_MAX_ASKED);
});

test('ps\'s elapsed shapes, and a program name without its folder', () => {
  assert.equal(mc.daysOf('14-02:03:04'), 14);
  assert.equal(mc.daysOf('02:03:04'), 0);
  assert.equal(mc.daysOf('03:04'), 0);
  assert.equal(mc.daysOf('soon'), null);
  assert.equal(mc.nameOf('/Users/somebody/secret/bin/node'), 'node');
  assert.equal(mc.nameOf('-zsh'), 'zsh');
});

test('the environment gives one name, and on Linux it reads NUL-separated', async () => {
  const exec = (cmd, args, opts, cb) => cb(null, 'node x API_KEY=sk-secret KOSMOS_AGENT_SESSION=angel OTHER=1\n');
  assert.equal(await mc.sessionOfPid(5, { platform: 'darwin', exec }), 'angel');
  const none = (cmd, args, opts, cb) => cb(null, 'node x API_KEY=sk-secret\n');
  assert.equal(await mc.sessionOfPid(5, { platform: 'darwin', exec: none }), null, 'control: no variable, no owner');
  const readFile = async () => 'API_KEY=sk-secret\0KOSMOS_AGENT_SESSION=raph\0';
  assert.equal(await mc.sessionOfPid(5, { platform: 'linux', readFile }), 'raph');
  assert.equal(await mc.sessionOfPid(5, { platform: 'linux', readFile: async () => { throw new Error('gone'); } }), null);
});

test('a sample holds no environment value at all', async () => {
  const exec = (cmd, args, opts, cb) => {
    if (cmd === 'tmux') return cb(null, 'angel\t10\t/w/a\n');
    if (args.includes('-axo')) return cb(null, `${row(10, 1, 1024, 0, '01:00', 'zsh')}\n${row(50, 1, GB, 0, '01:00', 'node')}\n`);
    return cb(null, 'node API_KEY=sk-secret KOSMOS_AGENT_SESSION=angel\n');
  };
  const got = await mc.sample({ platform: 'darwin', exec });
  assert.equal(got.angel.leftMemMb, 1024);
  assert.doesNotMatch(JSON.stringify(got), /secret|API_KEY/);
});

test('a ps that failed is no reading, not an agent using nothing, and the last good one stays', async () => {
  mc.resetForTest();
  let fail = false;
  let t = 1000;
  const exec = (cmd, args, opts, cb) => {
    if (fail && cmd !== 'tmux') return cb(new Error('no'));
    return cmd === 'tmux' ? cb(null, 'angel\t10\t/w/a\n') : cb(null, `${row(10, 1, 2048, 0, '01:00', 'zsh')}\n`);
  };
  const deps = { platform: 'darwin', exec, now: () => t };
  assert.equal(await mc.sample({ platform: 'darwin', exec: (c, a, o, cb) => cb(new Error('no')) }), null);
  await mc.tick(deps);
  assert.equal(mc.read('angel', 1000).memMb, 2);
  fail = true;
  t = 2000;
  await mc.tick(deps);
  assert.equal(mc.read('angel', 2000).memMb, 2, 'kept');
  assert.equal(mc.read('nobody', 2000), null);
  assert.equal(mc.read('angel', 1000 + 3 * mc.SAMPLE_MS + 1), null, 'too old to offer as now');
  assert.equal(mc.read('constructor', 2000), null, 'a name that is not a session');
  mc.resetForTest();
});

test('the timer does not run on Windows, and the board alone starts it', () => {
  assert.equal(mc.start({ platform: 'win32' }), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes("require('./engine/machinecost').start()"), 'the board starts it, with nothing that can throw before it');
  // The first version passed status.tmuxBin(), which status.js does not export: an uncaught throw at every launch, tests green.
  const started = mc.start({ platform: 'darwin', exec: (c, a, o, cb) => cb(new Error('no')) });
  clearInterval(started);
  assert.ok(/require\.main === module[^\n]*machinecost/.test(src), 'only when the file is the board');
});

test('a folder names one agent, the deepest; a tie or the home folder names nobody', () => {
  const f = mc.parseFolders('a\t1\t/w/a\nb\t2\t/w/a/sub\nc\t3\t/w/c\nd\t4\t/w/c\nhomed\t5\t/Users/me\nroot\t6\t/\nspaced\t7\t/w/my folder\n', '/Users/me');
  assert.equal(mc.sessionForFolder('/w/a', f), 'a');
  assert.equal(mc.sessionForFolder('/w/a/deep/er', f), 'a');
  assert.equal(mc.sessionForFolder('/w/a/sub/x', f), 'b', 'the deepest');
  assert.equal(mc.sessionForFolder('/w/my folder/x', f), 'spaced');
  assert.equal(mc.sessionForFolder('/w/c', f), null, 'two agents there: nobody');
  assert.equal(mc.sessionForFolder('/w/ab', f), null, 'a folder that only starts the same');
  assert.equal(mc.sessionForFolder('/Users/me/elsewhere', f), null, 'the home folder is no clue');
  assert.equal(mc.sessionForFolder('/tmp/x', f), null);
  assert.equal(mc.sessionForFolder(null, f), null);
});

test('only Apple\'s own binaries take the folder road, and only on a Mac', () => {
  assert.equal(mc.envHidden('/bin/bash', 'darwin'), true);
  assert.equal(mc.envHidden('/usr/bin/python3', 'darwin'), true);
  assert.equal(mc.envHidden('/opt/homebrew/bin/node', 'darwin'), false);
  assert.equal(mc.envHidden('/bin/bash', 'linux'), false);
});

test('a sample asks a hidden shell for its folder, a node for its variable, and marks which', async () => {
  const exec = (cmd, args, opts, cb) => {
    if (cmd === 'tmux') return cb(null, 'angel\t10\t/w/a\n');
    if (cmd === 'lsof') return cb(null, 'p50\nfcwd\nn/w/a/sub\n');
    if (args.includes('-axo')) return cb(null, [row(10, 1, 1024, 0, '01:00', 'zsh'), row(50, 1, GB, 99, '14-00:00:00', '/bin/bash'), row(60, 1, GB / 2, 0, '02:00:00', '/opt/homebrew/bin/node')].join('\n') + '\n');
    return cb(null, 'node KOSMOS_AGENT_SESSION=raph\n');
  };
  const got = await mc.sample({ platform: 'darwin', exec, home: '/Users/me' });
  assert.equal(got.angel.top.name, 'bash');
  assert.equal(got.angel.top.how, 'folder');
  assert.equal(got.raph.top.name, 'node');
  assert.equal(got.raph.top.how, undefined, 'named outright');
});

test('REAL: on this computer, a parentless node is named by its environment and a parentless shell by its folder', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mc-real-7978-')));
  const start = (cmd) => Number(spawnSync('/bin/sh', ['-c', `${cmd} >/dev/null 2>&1 & echo $!`], { cwd: dir, encoding: 'utf8', timeout: 5000, env: { ...process.env, KOSMOS_AGENT_SESSION: 'real-7978' } }).stdout.trim());
  const node = start(`'${process.execPath}' -e 'setTimeout(()=>{},60000)'`);
  const shell = start("/bin/sh -c '/bin/sleep 60; true'");
  try {
    assert.ok(node > 1 && shell > 1);
    await new Promise((r) => { setTimeout(r, 400); });
    for (const pid of [node, shell]) assert.equal(spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim(), '1', 'control: it has no parent');
    assert.equal(await mc.sessionOfPid(node), 'real-7978');
    assert.equal(await mc.cwdOfPid(shell), dir);
    assert.equal(mc.sessionForFolder(await mc.cwdOfPid(shell), mc.parseFolders(`real-7978\t1\t${dir}\n`, '/nowhere')), 'real-7978');
    if (process.platform === 'darwin') assert.equal(await mc.sessionOfPid(shell), null, 'the measured reason for the folder road: if this goes green, macOS changed');
    const none = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { env: { PATH: process.env.PATH }, stdio: 'ignore' });
    await new Promise((r) => { setTimeout(r, 300); });
    try { assert.equal(await mc.sessionOfPid(none.pid), null, 'control: a process with no such variable names nobody'); } finally { none.kill(); }
  } finally { for (const pid of [node, shell]) { try { process.kill(pid); } catch { /* gone */ } } }
});
