'use strict';
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const mc = require('./machinecost');
const { killServerAt } = require('../test-support/tmux-kill');

const row = (pid, ppid, kb, cpu, etime, comm) => `${pid} ${ppid} ${kb} ${cpu} ${etime} ${comm}`;
const table = (...rows) => mc.parsePs(rows.join('\n'));
const GB = 1024 * 1024;
const pane = (s, pid, dir = '/w/a') => `${s}\t${pid}\t${dir}\n`;
const owners = (...pairs) => new Map(pairs.map(([pid, session, how = null]) => [pid, { session, how }]));

test('a pane tree is summed through its children, and each process counted once', () => {
  const procs = table(row(10, 1, 1000, 0.5, '01:00', '-zsh'), row(11, 10, 400 * 1024, 20.5, '01:00', '/opt/homebrew/bin/node'), row(12, 11, 100 * 1024, 10, '00:30', 'bash'), row(99, 1, 900 * 1024, 90, '01:00', 'Slack'));
  const out = mc.costBySession(mc.parsePanes(pane('angel', 10)), procs);
  assert.deepEqual(Object.keys(out), ['angel']);
  assert.equal(out.angel.memMb, 501);
  assert.equal(out.angel.cpuPct, 31);
  assert.equal(out.angel.processes, 3);
  assert.deepEqual(out.angel.top, { name: 'node', memMb: 400, cpuPct: 21, days: 0, pid: 11 });
  assert.equal(out.angel.left, null);
  assert.equal(out.angel.leftMemMb, 0);
});

test('every pane of a session counts', () => {
  const procs = table(row(10, 1, 1024, 0, '01:00', 'zsh'), row(20, 1, 2048, 0, '01:00', 'zsh'));
  assert.equal(mc.costBySession(mc.parsePanes(pane('a', 10) + pane('a', 20)), procs).a.memMb, 3);
});

test('a recycled parent making a cycle ends, and counts each once', () => {
  const procs = table(row(10, 11, 1024, 0, '01:00', 'a'), row(11, 10, 1024, 0, '01:00', 'b'));
  assert.equal(mc.costBySession(mc.parsePanes(pane('a', 10)), procs).a.processes, 2);
});

test('a left-behind process is its agent\'s, with what runs under it, and its age is said', () => {
  const procs = table(row(10, 1, 1024, 0, '01:00', 'zsh'), row(50, 1, 6.5 * GB, 99.9, '14-02:03:04', '/bin/bash'), row(51, 50, 1024, 0, '14-02:03:04', 'sleep'));
  const out = mc.costBySession(mc.parsePanes(pane('angel', 10)), procs, owners([50, 'angel']));
  assert.equal(out.angel.processes, 3);
  assert.equal(out.angel.leftMemMb, 6657);
  assert.deepEqual(out.angel.left, { name: 'bash', memMb: 6656, cpuPct: 100, days: 14, pid: 50 });
  assert.equal(out.angel.top.pid, 50);
});

test('the leftover is named even when something running now is larger (review: the card and the page must agree)', () => {
  const procs = table(row(10, 1, 700 * 1024, 0, '01:00', 'claude'), row(50, 1, 400 * 1024, 0, '01:00', 'node'));
  const out = mc.costBySession(mc.parsePanes(pane('angel', 10)), procs, owners([50, 'angel']));
  assert.equal(out.angel.top.name, 'claude');
  assert.equal(out.angel.left.name, 'node');
  assert.equal(out.angel.leftMemMb, 400);
});

test('weak evidence stays marked, per process (review: a named one beside it must not hide that)', () => {
  const procs = table(row(50, 1, 6 * GB, 0, '01:00', 'bash'), row(60, 1, GB, 0, '01:00', 'node'));
  const out = mc.costBySession(new Map(), procs, owners([50, 'angel', 'folder'], [60, 'angel']));
  assert.equal(out.angel.left.name, 'bash');
  assert.equal(out.angel.left.how, 'folder');
});

test('CONTROL: with no owner named, the same process belongs to nobody', () => {
  const procs = table(row(10, 1, 1024, 0, '01:00', 'zsh'), row(50, 1, 6.5 * GB, 99.9, '14-02:03:04', '/bin/bash'));
  const out = mc.costBySession(mc.parsePanes(pane('angel', 10)), procs, new Map());
  assert.equal(out.angel.memMb, 1);
});

test('an agent with no pane left still shows what it left behind', () => {
  const out = mc.costBySession(new Map(), table(row(50, 1, GB, 0, '03-00:00:00', 'node')), owners([50, 'gone']));
  assert.equal(out.gone.memMb, 1024);
  assert.equal(out.gone.left.days, 3);
});

test('only large parentless processes outside every tree are asked about, largest first, and bounded', () => {
  const big = mc.LEFT_MIN_KB;
  const procs = table(row(1, 0, 10, 0, '01:00', 'launchd'), row(2, 1, big - 1, 0, '01:00', 'small'), row(3, 1, big, 0, '01:00', 'big'), row(4, 1, 10, mc.LEFT_MIN_CPU, '01:00', 'busy'), row(5, 7, big * 2, 0, '01:00', 'haschild'), row(6, 1, big * 3, 0, '01:00', 'intree'), row(8, 1, big * 9, 0, '01:00', '/Applications/Big.app/Contents/MacOS/Big'));
  assert.deepEqual(mc.leftCandidates(procs, new Set([6])).map((p) => p.pid), [3, 4]);
  const many = table(...Array.from({ length: 30 }, (_, i) => row(100 + i, 1, big + i, 0, '01:00', 'x')));
  assert.equal(mc.leftCandidates(many, new Set()).length, mc.LEFT_MAX_ASKED);
});

test('a small wrapper with a large child is asked about (review: measured 0 candidates before)', () => {
  const procs = table(row(50, 1, 2048, 0, '01:00', 'zsh'), row(51, 50, 6 * GB, 0, '01:00', 'node'));
  assert.deepEqual(mc.leftCandidates(procs, new Set()).map((p) => p.pid), [50]);
  const out = mc.costBySession(new Map(), procs, owners([50, 'angel']));
  assert.equal(out.angel.left.name, 'node', 'the child is what is named');
});

test('NEVER Kosmos itself: the board, what is above it, the tunnel and tmux are not candidates, since the page says to end it', () => {
  const big = mc.LEFT_MIN_KB * 4;
  const procs = table(row(1, 0, 10, 0, '01:00', 'launchd'), row(70, 1, big, 0, '01:00', 'bash'), row(71, 70, big, 0, '01:00', 'node'), row(80, 1, big, 0, '01:00', '/x/kosmos-tunnel'), row(81, 1, big, 0, '01:00', 'tmux: server'), row(82, 1, big, 0, '01:00', 'tmux'), row(90, 1, big, 0, '01:00', 'node'));
  assert.deepEqual(mc.leftCandidates(procs, new Set(), 71).map((p) => p.pid), [90], 'the board at 71 and the shell above it, the tunnel and both spellings of tmux are out');
  assert.equal(mc.leftCandidates(procs, new Set(), 999).map((p) => p.pid).includes(70), true, 'control: with the board elsewhere, that shell is a candidate');
});

test('tmux, parentless and above every pane, cannot make one agent pay for them all (a subtree stops at a pane)', () => {
  const procs = table(row(5, 1, 2048, 0, '01:00', 'tmux'), row(10, 5, 3 * 1024 * 1024, 0, '01:00', 'zsh'), row(20, 5, 3 * 1024 * 1024, 0, '01:00', 'zsh'));
  const panes = mc.parsePanes(pane('a', 10) + pane('b', 20));
  const inTrees = new Set([10, 20]);
  assert.deepEqual(mc.leftCandidates(procs, inTrees), [], 'not even by another name');
  const renamed = table(row(5, 1, 2048, 0, '01:00', 'wrapper'), row(10, 5, 3 * 1024 * 1024, 0, '01:00', 'zsh'), row(20, 5, 3 * 1024 * 1024, 0, '01:00', 'zsh'));
  assert.deepEqual(mc.leftCandidates(renamed, inTrees), [], 'a parent above panes is sized without them');
  const out = mc.costBySession(panes, renamed, owners([5, 'a']));
  assert.equal(out.b.memMb, 3072, 'b keeps its own');
  assert.equal(out.a.memMb, 3074, 'a pays for its own and the wrapper only');
  assert.equal(out.a.leftMemMb, 2);
});

test('the asking stops at its budget, largest first, so a slow machine still gets a sample', async () => {
  let asked = 0;
  const exec = (cmd, args, opts, cb) => {
    if (cmd === 'tmux') return cb(null, pane('angel', 10), '');
    if (args.includes('-A')) return cb(null, zsh10 + Array.from({ length: 5 }, (_, i) => row(100 + i, 1, GB, 0, '01:00', 'node')).join('\n') + '\n', '');
    asked += 1;
    return setTimeout(() => cb(null, 'node\n', ''), 30);
  };
  const got = await mc.sample({ platform: 'linux', exec, readFile: async () => { asked += 1; await new Promise((r) => { setTimeout(r, 30); }); return ''; }, askBudgetMs: 40 });
  assert.ok(got.angel, 'a sample came back');
  assert.ok(asked >= 1 && asked < 5, `asked ${asked} of 5`);
});

test('on Linux an orphan adopted by a user\'s systemd counts as parentless, and systemd itself does not', () => {
  const procs = table(row(1, 0, 10, 0, '01:00', 'systemd'), row(900, 1, mc.LEFT_MIN_KB * 2, 0, '01:00', 'systemd'), row(50, 900, mc.LEFT_MIN_KB, 0, '01:00', 'node'));
  assert.deepEqual(mc.leftCandidates(procs, new Set()).map((p) => p.pid), [50]);
});

test('ps\'s elapsed shapes, and a program name without its folder', () => {
  assert.equal(mc.daysOf('14-02:03:04'), 14);
  assert.equal(mc.daysOf('02:03:04'), 0);
  assert.equal(mc.daysOf('03:04'), 0);
  assert.equal(mc.daysOf('soon'), null);
  assert.equal(mc.nameOf('/Users/somebody/secret/bin/node'), 'node');
  assert.equal(mc.nameOf('-zsh'), 'zsh');
});

/* ps as a Mac answers: plain is the arguments, -E is the arguments and then the environment, if any can be read. */
const psAnswer = (cmdline, env = '') => (cmd, args, opts, cb) => cb(null, (args.includes('-Eww') ? (env ? cmdline + ' ' + env : cmdline) : cmdline) + '\n', '');

test('the environment gives one name, hidden is told from absent, and an argument cannot pose as it', async () => {
  const ask = (cmdline, env) => mc.askEnv(5, { platform: 'darwin', exec: psAnswer(cmdline, env) });
  assert.deepEqual(await ask('node x', 'API_KEY=sk-secret KOSMOS_AGENT_SESSION=angel OTHER=1'), { session: 'angel', hidden: false });
  assert.deepEqual(await ask('node x', 'API_KEY=sk-secret'), { session: null, hidden: false }, 'readable, and not an agent\'s');
  assert.deepEqual(await ask('/bin/bash x', ''), { session: null, hidden: true }, 'nothing past the arguments: hidden');
  assert.deepEqual(await ask('/bin/bash -c KOSMOS_AGENT_SESSION=sam ./job.sh', ''), { session: null, hidden: true }, 'review: an argument on a hidden process names nobody');
  assert.deepEqual(await ask('node KOSMOS_AGENT_SESSION=spoof', 'KOSMOS_AGENT_SESSION=angel'), { session: 'angel', hidden: false }, 'the arguments are not read at all');
  const gone = (cmd, args, opts, cb) => cb(new Error('no such process'), '', '');
  assert.deepEqual(await mc.askEnv(5, { platform: 'darwin', exec: gone }), { session: null, hidden: false }, 'no reading is not hidden: no folder is guessed');
  let n = 0;
  const changed = (cmd, args, opts, cb) => cb(null, n++ === 0 ? 'one\n' : 'two KOSMOS_AGENT_SESSION=x\n', '');
  assert.deepEqual(await mc.askEnv(5, { platform: 'darwin', exec: changed }), { session: null, hidden: false }, 'a process that changed between the two reads: nothing known');
});

test('on Linux it reads NUL-separated, and a failed read names nobody', async () => {
  const readFile = async () => 'API_KEY=sk-secret\0KOSMOS_AGENT_SESSION=raph\0';
  assert.equal(await mc.sessionOfPid(5, { platform: 'linux', readFile }), 'raph');
  assert.equal(await mc.sessionOfPid(5, { platform: 'linux', readFile: async () => { throw new Error('gone'); } }), null);
});

/* A fake of the four commands a sample runs. */
function fakeExec({ tmux = pane('angel', 10), ps, cmdline = 'x', env = '', lsof = '', launchctl = 'PID\tStatus\tLabel\n-\t0\tcom.example\n1\t0\tcom.apple.xpc.launchd\n' }) {
  return (cmd, args, opts, cb) => {
    if (typeof tmux === 'object' && cmd === 'tmux') return cb(new Error('failed'), '', tmux.err);
    if (cmd === 'tmux') return cb(null, tmux, '');
    if (cmd === 'lsof') return cb(null, lsof, '');
    if (cmd === 'launchctl') return launchctl === null ? cb(new Error('no'), '', '') : cb(null, launchctl, '');
    if (args.includes('-A')) return ps === null ? cb(new Error('no'), '', '') : cb(null, ps, '');
    return cb(null, (args.includes('-Eww') && env ? cmdline + ' ' + env : cmdline) + '\n', '');
  };
}
const zsh10 = `${row(10, 1, 2048, 0, '01:00', 'zsh')}\n`;

test('a sample holds no environment value at all', async () => {
  const got = await mc.sample({ platform: 'darwin', exec: fakeExec({ ps: `${zsh10}${row(50, 1, GB, 0, '01:00', 'node')}\n`, env: 'API_KEY=sk-secret KOSMOS_AGENT_SESSION=angel' }) });
  assert.equal(got.angel.leftMemMb, 1024);
  assert.doesNotMatch(JSON.stringify(got), /secret|API_KEY/);
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

test('a hidden environment is asked for its folder, whatever its name reads (review: comm is argv0)', async () => {
  for (const comm of ['/bin/bash', 'bash', '-zsh']) {
    const got = await mc.sample({ platform: 'darwin', home: '/Users/me', exec: fakeExec({ ps: `${zsh10}${row(50, 1, GB, 99, '14-00:00:00', comm)}\n`, lsof: 'p50\nfcwd\nn/w/a/sub\n' }) });
    assert.equal(got.angel.left.how, 'folder', comm);
    assert.equal(got.angel.left.days, 14);
  }
  const elsewhere = await mc.sample({ platform: 'darwin', home: '/Users/me', exec: fakeExec({ ps: `${zsh10}${row(50, 1, GB, 99, '01:00', 'bash')}\n`, lsof: 'p50\nfcwd\nn/Users/me/x\n' }) });
  assert.equal(elsewhere.angel.left, null, 'control: outside every agent\'s folder, nobody\'s');
});

test('BLOCKER from review: a readable environment with no variable is never named by its folder, like another Kosmos\'s board', async () => {
  const got = await mc.sample({ platform: 'darwin', home: '/Users/me', exec: fakeExec({ ps: `${zsh10}${row(200, 1, GB, 0, '01:00', 'node')}\n`, cmdline: 'node server.js', env: 'PATH=/bin HOME=/Users/me', lsof: 'p200\nfcwd\nn/w/a\n' }) });
  assert.equal(got.angel.left, null);
  assert.equal(got.angel.memMb, 2, 'and it is not charged');
});

test('anything launchd runs is never named, and if that list cannot be read the folder clue is not used', async () => {
  const ps = `${zsh10}${row(300, 1, GB, 0, '01:00', '/bin/bash')}\n`;
  const lsof = 'p300\nfcwd\nn/w/a\n';
  const asJob = await mc.sample({ platform: 'darwin', home: '/h', exec: fakeExec({ ps, lsof, launchctl: 'PID\tStatus\tLabel\n300\t0\tcom.kosmos.angel\n' }) });
  assert.equal(asJob.angel.left, null, 'a supervisor or a scheduled job');
  const unknown = await mc.sample({ platform: 'darwin', home: '/h', exec: fakeExec({ ps, lsof, launchctl: null }) });
  assert.equal(unknown.angel.left, null, 'the list could not be read: no guess');
  const notAJob = await mc.sample({ platform: 'darwin', home: '/h', exec: fakeExec({ ps, lsof }) });
  assert.equal(notAJob.angel.left.how, 'folder', 'control: not a job, it is named');
  const named = await mc.sample({ platform: 'darwin', home: '/h', exec: fakeExec({ ps: `${zsh10}${row(60, 1, GB, 0, '01:00', 'node')}\n`, env: 'KOSMOS_AGENT_SESSION=raph' }) });
  assert.equal(named.raph.left.how, undefined, 'a name is not marked');
  const namedNoList = await mc.sample({ platform: 'darwin', home: '/h', exec: fakeExec({ ps: `${zsh10}${row(60, 1, GB, 0, '01:00', 'node')}\n`, env: 'KOSMOS_AGENT_SESSION=raph', launchctl: null }) });
  assert.equal(namedNoList.raph, undefined, 'review 4: with no list even a named process is not named, since launchd may run it');
  assert.equal(namedNoList.angel.memMb, 2, 'and the panes are still measured');
  for (const short of ['', 'PID\tStatus\tLabel\n', '-\t0\tcom.example\n', 'PID\tStatus\tLabel\n-\t0\tcom.example\n']) {
    const got = await mc.sample({ platform: 'darwin', home: '/h', exec: fakeExec({ ps, lsof, launchctl: short }) });
    assert.equal(got.angel.left, null, `review 4: a short list that exits 0 is no list: ${JSON.stringify(short)}`);
  }
  const linux = await mc.sample({ platform: 'linux', home: '/h', readFile: async () => 'X=1\0', exec: fakeExec({ ps, lsof }) });
  assert.equal(linux.angel.left, null, 'Linux can read every environment, so no folder guess there');
});

test('a pane above the home folder claims nothing', () => {
  const f = mc.parseFolders('a\t1\t/Users\nb\t2\t/Users/me/work\n', '/Users/me');
  assert.equal(mc.sessionForFolder('/Users/other/x', f), null);
  assert.equal(mc.sessionForFolder('/Users/me/work/x', f), 'b', 'control: below it still counts');
});

test('a tmux that says the server exited is not an empty board (a version wall, status.js)', async () => {
  assert.equal(await mc.sample({ platform: 'darwin', exec: fakeExec({ ps: zsh10, tmux: { err: 'server exited unexpectedly' } }) }), null);
});

test('nested owners count a process once', () => {
  const procs = table(row(50, 1, GB, 0, '01:00', 'a'), row(51, 50, GB, 0, '01:00', 'b'));
  const out = mc.costBySession(new Map(), procs, owners([50, 'x'], [51, 'x']));
  assert.equal(out.x.leftMemMb, 2048);
  assert.equal(out.x.memMb, 2048);
});

test('a tmux that failed is no reading, and keeps the last good one; no server is a true empty (review)', async () => {
  mc.resetForTest();
  let t = 1000;
  const good = fakeExec({ ps: zsh10 });
  await mc.tick({ platform: 'darwin', exec: good, now: () => t });
  assert.equal(mc.read('angel', 1000).memMb, 2);
  t = 2000;
  await mc.tick({ platform: 'darwin', exec: fakeExec({ ps: zsh10, tmux: { err: 'something else broke' } }), now: () => t });
  assert.equal(mc.read('angel', 2000).memMb, 2, 'a failed tmux does not wipe the panes');
  await mc.tick({ platform: 'darwin', exec: fakeExec({ ps: null }), now: () => t });
  assert.equal(mc.read('angel', 2000).memMb, 2, 'nor does a failed ps');
  assert.deepEqual(await mc.sample({ platform: 'darwin', exec: fakeExec({ ps: zsh10, tmux: { err: 'no server running on /tmp/x' } }) }), {}, 'no server: truly no panes');
  assert.equal(mc.read('nobody', 2000), null);
  assert.equal(mc.read('angel', 1000 + 3 * mc.SAMPLE_MS + 1), null, 'too old to offer as now');
  assert.equal(mc.read('constructor', 2000), null, 'a name that is not a session');
  mc.resetForTest();
});

test('an agent with only a name finds its session through the board\'s own rule, and another Kosmos\'s same name is not it', async () => {
  mc.resetForTest();
  const t = 1000;
  const exec = fakeExec({ tmux: pane('ava-discord', 10) + pane('ava+qa', 20), ps: `${zsh10}${row(20, 1, 4096, 0, '01:00', 'zsh')}\n` });
  await mc.tick({ platform: 'darwin', exec, now: () => t });
  const toName = (s) => (s.includes('+') ? null : s.replace(/-discord$/, ''));
  assert.equal(mc.readAgent('ava', toName, 1000).memMb, 2);
  assert.equal(mc.readAgent('nobody', toName, 1000), null);
  mc.resetForTest();
  assert.equal(mc.readAgent('ava', toName, 1000), null, 'no sample yet');
});

test('a stuck child cannot end sampling, since a command answers by its own timer', () => {
  // Pinned as source: the real timer is twelve seconds, and a fake that never calls back would hold this test that long.
  const src = fs.readFileSync(path.join(__dirname, 'machinecost.js'), 'utf8');
  assert.ok(src.includes("killSignal: 'SIGKILL'") && src.includes('setTimeout(() => done({ out: null'), 'SIGTERM alone waits on a child stuck on a dead mount');
});

test('the timer does not run on Windows, and the board alone starts it', () => {
  assert.equal(mc.start({ platform: 'win32' }), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes("require('./engine/machinecost').start()"), 'the board starts it, with nothing that can throw before it');
  assert.ok(/require\.main === module[^\n]*machinecost/.test(src), 'only when the file is the board');
  // The first version passed status.tmuxBin(), which status.js does not export: an uncaught throw at every launch, tests green.
  const started = mc.start({ platform: 'darwin', exec: (c, a, o, cb) => cb(new Error('no'), '', '') });
  clearInterval(started);
  mc.resetForTest();
});

const haveTmux = spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0 && process.platform !== 'win32';

/* The review's two blockers lived here: tmux's locale outside a pane, and which name a sample is keyed by. So: a REAL tmux on
   a private socket, with the environment a board started outside a pane has, through the real sample and read. */
test('REAL tmux, outside a pane, under a C locale: the sample finds the session by its raw name', { skip: !haveTmux }, async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tmux-7978-')));
  const sock = path.join(dir, 's');
  const wrapper = path.join(dir, 'tmux');
  const real = execFileSync('/usr/bin/env', ['sh', '-c', 'command -v tmux'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec '${real}' -S '${sock}' "$@"\n`, { mode: 0o755 });
  const saved = { TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE, LC_ALL: process.env.LC_ALL, LANG: process.env.LANG, LC_CTYPE: process.env.LC_CTYPE };
  const clean = { ...process.env, LC_ALL: 'C' };
  for (const k of ['TMUX', 'TMUX_PANE', 'LANG', 'LC_CTYPE']) delete clean[k];
  spawnSync(wrapper, ['new-session', '-d', '-s', 'ava-discord', '/bin/sleep 60'], { env: { ...clean, LC_ALL: 'en_US.UTF-8' }, timeout: 10000 });
  try {
    for (const k of ['TMUX', 'TMUX_PANE', 'LANG', 'LC_CTYPE']) delete process.env[k];
    process.env.LC_ALL = 'C';
    const plain = spawnSync(wrapper, ['list-panes', '-a', '-F', mc.PANE_LIST], { env: clean, encoding: 'utf8', timeout: 10000 });
    assert.ok(plain.stdout.includes('ava-discord'), `control: the session exists: ${plain.stderr}`);
    assert.equal(plain.stdout.includes('\t'), false, 'control: without -u this locale really does eat the tabs, which is the failure this guards');
    const got = await mc.sample({ tmuxBin: wrapper });
    assert.ok(got && got['ava-discord'], `the raw session is the key: ${JSON.stringify(Object.keys(got || {}))}`);
    assert.ok(got['ava-discord'].processes >= 1);
    mc.resetForTest();
    await mc.tick({ tmuxBin: wrapper });
    assert.ok(mc.read('ava-discord'), 'and it reads back by that name');
    assert.equal(mc.read('ava'), null, 'not by the short name a status row calls sessionName');
    assert.ok(mc.readAgent('ava', (s) => s.replace(/-discord$/, '')), 'which a not-running row finds through the name rule');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    killServerAt(real, sock);
    mc.resetForTest();
  }
});

/* The other half of the second blocker: the REAL status row against the REAL sample, joined as the route joins them. A private
   tmux and a throwaway data root, in a child so nothing here reaches this computer's own agents. */
test('REAL status row: its session finds the sample and its sessionName does not', { skip: !haveTmux }, () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-join-7978-')));
  const sock = path.join(dir, 's');
  const wrapper = path.join(dir, 'tmux');
  const real = execFileSync('/usr/bin/env', ['sh', '-c', 'command -v tmux'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec '${real}' -S '${sock}' "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, LC_ALL: 'en_US.UTF-8', AGENT_WORKFORCE_TMUX_BIN: wrapper, AGENT_WORKFORCE_DATA: path.join(dir, 'data'), AGENT_WORKFORCE_HOME: dir, HOME: dir };
  for (const k of ['TMUX', 'TMUX_PANE', 'KOSMOS_WORLD']) delete env[k];
  spawnSync(wrapper, ['new-session', '-d', '-s', 'ava-discord', '/bin/sleep 60'], { env, timeout: 10000 });
  try {
    const script = `
      const mc = require(${JSON.stringify(path.join(__dirname, 'machinecost'))});
      const status = require(${JSON.stringify(path.join(__dirname, 'status'))});
      (async () => {
        await mc.tick();
        const a = (status.snapshot().agents || []).find((x) => x.session === 'ava-discord');
        process.stdout.write('\\nJOIN ' + JSON.stringify(a ? { sessionName: a.sessionName, ours: a.isNamedOurs, bySession: Boolean(mc.read(a.session)), byName: Boolean(mc.read(a.sessionName)) } : null) + '\\n');
        process.exit(0);
      })();`;
    const r = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 45000 });
    const m = /^JOIN (.*)$/m.exec(r.stdout || '');
    assert.ok(m, `no join printed: ${(r.stderr || '').slice(-400)}`);
    assert.deepEqual(JSON.parse(m[1]), { sessionName: 'ava', ours: true, bySession: true, byName: false });
  } finally { killServerAt(real, sock); }
});

test('REAL ps: the columns parse, and this test process is in them', { skip: process.platform === 'win32' }, () => {
  const out = execFileSync('ps', mc.PS_ARGS, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024 });
  const procs = mc.parsePs(out);
  assert.ok(procs.size > 1);
  const me = procs.get(process.pid);
  assert.ok(me, 'this process is listed');
  assert.ok(me.rssKb > 0);
  assert.notEqual(mc.daysOf(me.etime), null, me.etime);
});

async function waitFor(fn, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await new Promise((r) => { setTimeout(r, 100); });
  }
}

test('REAL: launchctl answers on this computer and its pids parse', { skip: process.platform !== 'darwin' }, async () => {
  const pids = await mc.launchdPids();
  assert.ok(pids instanceof Set && pids.size > 0, 'the real list has its header and at least one running job, or the rule above would blank this feature on every Mac');
});

test('REAL: on this computer, a parentless node is named by its environment and a parentless shell by its folder', { skip: process.platform !== 'darwin' }, async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-real-7978-')));
  const start = (cmd) => Number(spawnSync('/bin/sh', ['-c', `${cmd} >/dev/null 2>&1 & echo $!`], { cwd: dir, encoding: 'utf8', timeout: 5000, env: { ...process.env, KOSMOS_AGENT_SESSION: 'real-7978' } }).stdout.trim());
  const node = start(`'${process.execPath}' -e 'setTimeout(()=>{},60000)'`);
  const shell = start("/bin/sh -c '/bin/sleep 60; true'");
  const shellKids = () => spawnSync('pgrep', ['-P', String(shell)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).map(Number);
  let kids = [];
  try {
    assert.ok(node > 1 && shell > 1);
    assert.equal(await waitFor(async () => (await mc.askEnv(node)).session), 'real-7978', 'polled: exec may not have happened yet on a loaded machine');
    for (const pid of [node, shell]) assert.equal(spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim(), '1', 'control: it has no parent');
    assert.equal(await waitFor(() => mc.cwdOfPid(shell)), dir);
    kids = shellKids();
    assert.equal(mc.sessionForFolder(await mc.cwdOfPid(shell), mc.parseFolders(`real-7978\t1\t${dir}\n`, '/nowhere')), 'real-7978');
    assert.deepEqual(await mc.askEnv(shell), { session: null, hidden: true }, 'the measured reason for the folder road: if this changes, macOS changed');
    const none = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { env: { PATH: process.env.PATH }, stdio: 'ignore' });
    try {
      await new Promise((r) => { setTimeout(r, 500); });
      assert.deepEqual(await mc.askEnv(none.pid), { session: null, hidden: false }, 'control: readable, with no such variable: nobody, and no folder guess');
    } finally { none.kill(); }
  } finally {
    kids = kids.length ? kids : shellKids();
    for (const pid of [node, ...kids, shell]) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});
