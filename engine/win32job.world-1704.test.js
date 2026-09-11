'use strict';
/**
 * #1704 / #2828: a Windows agent's machine-wide names -- its Scheduled Task and
 * its channel pipe -- are keyed by the process's own Kosmos, the default world's
 * are unchanged, and the task line carries a named world to the agent.
 *
 *   node --test engine/win32job.world-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');

const win32job = require('./win32job');
const win32channel = require('./win32channel');
const win32argv = require('./win32argv');

/* Run `body` with this process in `world` (undefined = default), then restore. */
function inWorld(world, body) {
  const saved = process.env.KOSMOS_WORLD;
  if (world === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = world;
  try { return body(); } finally {
    if (saved === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = saved;
  }
}

test('#1704 the DEFAULT world\'s task and pipe names are exactly today\'s', () => {
  inWorld(undefined, () => {
    assert.equal(win32job.taskName('ava'), 'Kosmos\\agent-ava');
    assert.equal(win32channel.pipePath('ava'), '\\\\.\\pipe\\kosmos-agent-ava');
  });
});

test('#1704 a NAMED world\'s agent gets its own task and pipe', () => {
  inWorld('test', () => {
    assert.equal(win32job.taskName('ava'), 'Kosmos\\agent-ava+test');
    assert.equal(win32channel.pipePath('ava'), '\\\\.\\pipe\\kosmos-agent-ava+test');
    assert.equal(win32channel.pipePath('Ava'), '\\\\.\\pipe\\kosmos-agent-ava+test',
      'the name is keyed first, so the separator survives safeKey');
  });
  assert.equal(win32job.taskName('ava', 'test'), 'Kosmos\\agent-ava+test', 'an explicit world wins');
  assert.equal(win32job.taskName('ava', 'default'), 'Kosmos\\agent-ava');
});

test('#1704 the task line carries a NAMED world as argument seven, and a default one not at all', () => {
  const spec = { name: 'ava', cwd: 'C:\\work\\ava', node: 'C:\\n\\node.exe', supervisor: 'C:\\r\\supervisor-boot.js' };
  const args = (exec) => (exec.args.match(/"[^"]*"/g) || []).map((q) => q.slice(1, -1)).slice(1);
  inWorld(undefined, () => {
    assert.deepEqual(args(win32job.taskExec(spec)), ['ava', 'C:\\work\\ava', '-', '-', 'claude', '-'],
      'a default-world task line is unchanged');
  });
  inWorld('test', () => {
    const a = args(win32job.taskExec(spec));
    assert.deepEqual(a, ['ava', 'C:\\work\\ava', '-', '-', 'claude', '-', 'test']);
    assert.equal(win32argv.specFromArgv(a).world, 'test', 'and the one parser reads it back');
  });
});

test('#1704 install names the task and hands the agent ONE world: the name and argument seven agree', () => {
  /* Review round 1: install used to name the task by the current world while the
     line honoured an explicit one, so a board could register `Kosmos\agent-ava`
     whose agent served `kosmos-agent-ava+test`, and nothing could find it. */
  let created = null;
  win32job.setAnchorer(() => ({ ok: true, node: 'C:\\n\\node.exe', boot: 'C:\\r\\supervisor-boot.js' }));
  win32job.setRunner((args) => {
    if (args[0] === '/Create') {
      const xml = fs.readFileSync(args[args.indexOf('/XML') + 1]).toString('utf16le');
      const line = win32job.xmlUnescape(/<Arguments>([^<]*)<\/Arguments>/.exec(xml)[1]);
      /* The registered line is conhost's: `--headless "<node>" "<boot>" "<name>" ...`,
         so the agent's argv starts at the third quoted token -- the same
         `slice(2)` configDirFor reads it with. */
      created = { task: args[args.indexOf('/TN') + 1], argv: (line.match(/"[^"]*"/g) || []).map((q) => q.slice(1, -1)).slice(2) };
    }
    return { ok: true, out: '' };
  });
  const env = { USERNAME: 'jo', USERDOMAIN: 'PC' };
  try {
    inWorld(undefined, () => assert.equal(win32job.install({ name: 'ava', cwd: 'C:\\w\\ava', env, world: 'test' }).task, 'Kosmos\\agent-ava+test'));
    assert.equal(created.task, 'Kosmos\\agent-ava+test');
    assert.equal(created.argv[6], 'test', 'an explicit world names the task AND rides the line');

    inWorld('test', () => win32job.install({ name: 'ava', cwd: 'C:\\w\\ava', env }));
    assert.equal(created.task, 'Kosmos\\agent-ava+test');
    assert.equal(created.argv[6], 'test', 'the board\'s own world, the same way');

    inWorld(undefined, () => win32job.install({ name: 'ava', cwd: 'C:\\w\\ava', env }));
    assert.equal(created.task, 'Kosmos\\agent-ava');
    assert.equal(created.argv.length, 6, 'a default-world task line is unchanged');
  } finally {
    win32job.setRunner(null);
    win32job.setAnchorer(null);
  }
});

test('#1704 argument seven is optional: a task from before it existed is a default-world agent', () => {
  assert.equal(win32argv.specFromArgv(['ava', 'C:\\w', '-', '-', 'claude', '-']).world, undefined);
  assert.equal(win32argv.specFromArgv(['ava', 'C:\\w', '-', '-', 'claude', '-', '-']).world, undefined);
  assert.equal(win32argv.specFromArgv(['ava', 'C:\\w', '-', '-', 'claude', '-', 'test']).world, 'test');
});

test('#1704 a board lists ONLY its own world\'s tasks: another Kosmos\'s agent is not a stray', () => {
  /* The task folder holds every Kosmos's agents. register.js's stray sweep and
     every "is it registered" read go through list(), so a default board that
     counted `ava+test` would report it as a leftover to clean up. */
  const csv = [
    '"\\Kosmos\\agent-ava","N/A","Ready"',
    '"\\Kosmos\\agent-ava+test","N/A","Ready"',
    '"\\Kosmos\\agent-bo+test","N/A","Running"',
    '"\\Kosmos\\agent-cy+other","N/A","Ready"',
    '"\\Kosmos\\board","N/A","Running"',
  ].join('\r\n');
  win32job.setRunner((args) => (args[0] === '/Query' ? { ok: true, out: csv } : { ok: false, out: '' }));
  try {
    inWorld(undefined, () => assert.deepEqual([...win32job.list().names].sort(), ['ava']));
    inWorld('test', () => assert.deepEqual([...win32job.list().names].sort(), ['ava', 'bo']));
  } finally { win32job.setRunner(null); }
});

test('#2828 acting on "ava" in a named world reaches THAT world\'s task, never the default world\'s', () => {
  /* The Windows half of #2828: remove.js stops an agent through disable/end, and
     delete-leftover through remove, all by bare agent name. Each must land on
     the task of the Kosmos doing the acting. */
  const named = [];
  win32job.setRunner((args) => {
    const at = args.indexOf('/TN');
    if (at >= 0) named.push(args[at + 1]);
    return { ok: true, out: '' };
  });
  try {
    inWorld('test', () => { win32job.disable('ava'); win32job.end('ava'); win32job.start('ava'); win32job.remove('ava'); });
  } finally { win32job.setRunner(null); }
  assert.ok(named.length >= 4, 'every act named a task: ' + JSON.stringify(named));
  for (const n of named) assert.equal(n, 'Kosmos\\agent-ava+test', 'an act in Kosmos "test" reached ' + n);
});

test('#1704 there is ONE argv parser: the supervisor\'s is win32argv\'s', () => {
  assert.equal(require('./win32supervisor').specFromArgv, win32argv.specFromArgv);
});

test('#1704 Windows accepts the separator in a REAL named pipe', { skip: process.platform !== 'win32' && 'named pipes are a Windows fact' }, async () => {
  /* The pipe name is the one place the key meets the operating system directly
     (a task name is checked by schtasks at registration). Serve and connect for
     real, so an OS that refused `+` would fail here rather than at an agent. */
  const at = inWorld('world-1704-probe', () => win32channel.pipePath('probe' + process.pid));
  assert.ok(at.includes('+world-1704-probe'));
  const server = net.createServer((sock) => { sock.end('ok'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(at, resolve); });
  try {
    const reply = await new Promise((resolve, reject) => {
      const c = net.connect(at);
      let got = '';
      c.on('data', (d) => { got += d; });
      c.on('end', () => resolve(got));
      c.on('error', reject);
    });
    assert.equal(reply, 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
