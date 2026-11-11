'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = require('./slowspawn');

function fake(result) {
  const calls = [];
  const cp = {
    execFileSync(...a) { calls.push(a); if (result instanceof Error) throw result; return result; },
    execSync() { return 'x'; },
    spawnSync() { return { status: 0 }; },
  };
  return { cp, calls };
}
// A clock the fake spawn appears to take `ms` on: each pair of reads is ms apart.
function clock(ms) { let t = 1000000; return () => { const v = t; t += ms; return v; }; }

test('a slow call is logged with its program and caller, and the secret argument is not', () => {
  const { cp } = fake('out');
  const lines = [];
  s.install(cp, { log: (l) => lines.push(l), now: clock(1500) });
  assert.equal(cp.execFileSync('/opt/x/tmux', ['send-keys', 'secret words']), 'out');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[slow-spawn\] 1500 ms execFileSync tmux from .*slowspawn-7693\.test\.js:\d+/);
  assert.doesNotMatch(lines[0], /secret|send-keys|\/opt/);
});

test('a deep caller is still named, and the stack limit is left as it was', () => {
  const { cp } = fake('out');
  const lines = [];
  s.install(cp, { log: (l) => lines.push(l), now: clock(1500) });
  const before = Error.stackTraceLimit;
  const f9 = () => cp.execFileSync('tmux', []); const f8 = () => f9(); const f7 = () => f8(); const f6 = () => f7(); const f5 = () => f6();
  const f4 = () => f5(); const f3 = () => f4(); const f2 = () => f3(); const f1 = () => f2(); const f0 = () => f1();
  f0();
  // Ten named callers and the test itself: all of them, past the six that stopped short on the live board.
  assert.equal(lines[0].split(' < ').length, 11, lines[0]);
  assert.equal(Error.stackTraceLimit, before);
});

test('control: a quick call logs nothing', () => {
  const { cp } = fake('out');
  const lines = [];
  s.install(cp, { log: (l) => lines.push(l), now: clock(10) });
  cp.execFileSync('tmux', []);
  assert.equal(lines.length, 0);
});

test('a slow throw comes out as the same error, and is logged', () => {
  const boom = new Error('timed out');
  const { cp } = fake(boom);
  const lines = [];
  s.install(cp, { log: (l) => lines.push(l), now: clock(5000) });
  assert.throws(() => cp.execFileSync('ps', []), (e) => e === boom);
  assert.equal(lines.length, 1);
});

test('a failing logger does not change the result', () => {
  const { cp } = fake('out');
  s.install(cp, { log: () => { throw new Error('log broke'); }, now: clock(5000) });
  assert.equal(cp.execFileSync('ps', []), 'out');
});

test('execSync logs no word of its command line', () => {
  for (const line of ['FOO=secret tool x', '"/Users/a b/bin/t" c', ' /usr/bin/git log']) assert.equal(s.programOf('execSync', line), '(shell)');
  assert.equal(s.programOf('execFileSync', 'echo SECRET', [{ shell: true }]), '(shell)');
  assert.equal(s.programOf('spawnSync', 'echo SECRET', [[], { shell: '/bin/sh' }]), '(shell)');
  assert.equal(s.programOf('spawnSync', '/bin/ps', [[], { timeout: 5 }]), 'ps');
});

test('spawnSync and execSync are watched too, and this is passed through', () => {
  const seen = [];
  const cp = { execFileSync() { return 1; }, execSync() { seen.push(this); return 2; }, spawnSync() { return 3; } };
  const lines = [];
  s.install(cp, { log: (l) => lines.push(l), now: clock(1500) });
  assert.equal(cp.execSync('x y'), 2);
  assert.equal(seen[0], cp);
  assert.equal(cp.spawnSync('/bin/ps', []), 3);
  assert.match(lines[0], /execSync \(shell\) from/);
  assert.match(lines[1], /spawnSync ps from/);
});

test('server.js installs it after the log stamp and ahead of every other engine require', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const order = [...src.matchAll(/require\('\.\/engine\/([A-Za-z0-9_.-]+)'\)/g)].map((m) => m[1]);
  assert.ok(order.includes('slowspawn'), 'not installed');
  /* #8373: win32boardlog is part of the log setup (a task-started Windows board's own board.log). What it loads on
     Windows holds child_process as the module and calls through it, so the install below still watches those calls. */
  assert.deepEqual(order.slice(0, order.indexOf('slowspawn')).filter((n) => !['worldenv', 'logstamp', 'win32boardlog', 'logring'].includes(n)), []);
  assert.equal(src.match(/^if \(require\.main === module\) require\('\.\/engine\/slowspawn'\)\.install\(require\('node:child_process'\)\);$/gm)?.length, 1);
});

test('lines are capped per minute', () => {
  const { cp } = fake('out');
  const lines = [];
  // Each slow call reads the clock three times; only the second read is later, so all 25 fall in one minute.
  let reads = 0;
  s.install(cp, { log: (l) => lines.push(l), now: () => (reads++ % 3 === 1 ? 2000 : 0) + 100000 });
  for (let i = 0; i < 25; i++) cp.execFileSync('ps', []);
  assert.equal(lines.length, s.MAX_PER_MINUTE);
});

test('installing twice does not wrap twice', () => {
  const { cp } = fake('out');
  const lines = [];
  s.install(cp, { log: (l) => lines.push(l), now: clock(1500) });
  const first = cp.execFileSync;
  s.install(cp, { log: (l) => lines.push(l), now: clock(1500) });
  assert.equal(cp.execFileSync, first);
});
