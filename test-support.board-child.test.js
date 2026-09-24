'use strict';
/**
 * test-support/board-child.js (#3607): the escalation paths the boot tests
 * never reach, because a real board honours SIGTERM. Lives at the root because
 * tools/run-tests.sh globs `engine/*.test.js *.test.js` (#1934).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { stopBoard, runUntilBanner } = require('./test-support/board-child');

const node = (script) => spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
const started = (child) => new Promise((r) => child.stdout.once('data', r));

test('a child that already exited resolves dead at once', async () => {
  const child = node('0');
  await new Promise((r) => child.once('exit', r));
  const t = Date.now();
  assert.equal(await stopBoard(child), true);
  assert.ok(Date.now() - t < 200, 'waited on a child that was already gone');
});

test('a child that honours SIGTERM is dead when stopBoard resolves', async () => {
  const child = node("process.stdout.write('up'); setInterval(() => {}, 1000)");
  await started(child);
  assert.equal(await stopBoard(child), true);
  assert.equal(child.signalCode, 'SIGTERM');
});

test('a child that ignores SIGTERM is SIGKILLed after the grace period', async () => {
  /* Leaves on its own after 3s, so a missing escalation fails below instead of
     hanging the suite. */
  const child = node("process.on('SIGTERM', () => {}); process.stdout.write('up'); setTimeout(() => process.exit(0), 3000)");
  await started(child);
  const t = Date.now();
  assert.equal(await stopBoard(child, { graceMs: 300, giveUpMs: 5000 }), true);
  const took = Date.now() - t;
  assert.equal(child.signalCode, 'SIGKILL', 'it was not SIGKILLed');
  assert.ok(took >= 290 && took < 2000, `escalation took ${took}ms, expected just past the 300ms grace`);
});

test('a child that never reports an exit gives up and says it is NOT dead', async () => {
  /* A stand-in whose kill() does nothing, so within giveUpMs only the give-up
     can end the wait. */
  const child = Object.assign(new EventEmitter(), { pid: -1, exitCode: null, signalCode: null, kill() {} });
  /* A late 'exit' at 1.5s, so a missing give-up fails below instead of hanging. */
  const late = setTimeout(() => child.emit('exit'), 1500);
  const logged = [];
  const realError = console.error;
  console.error = (m) => logged.push(m);
  const t = Date.now();
  let dead;
  try { dead = await stopBoard(child, { graceMs: 50, giveUpMs: 300 }); } finally { console.error = realError; }
  const took = Date.now() - t;
  clearTimeout(late);
  assert.equal(dead, false);
  assert.match(logged.join('\n'), /did not report an exit within 300ms/, 'the give-up was silent');
  assert.ok(took >= 290 && took < 1000, `gave up after ${took}ms, expected about 300ms`);
});

test('a grandchild holding the pipes does not hold stopBoard open', async () => {
  const child = node("require('child_process').spawn('sleep', ['3'], { stdio: 'inherit' }); process.stdout.write('up'); setInterval(() => {}, 1000)");
  await started(child);
  const t = Date.now();
  assert.equal(await stopBoard(child, { giveUpMs: 2500 }), true);
  assert.ok(Date.now() - t < 2000, 'waited on the grandchild, not the board');
});

test('runUntilBanner returns early, with the output, when the board dies before its banner', async () => {
  const child = node("process.stderr.write('cannot start'); process.exit(3)");
  const t = Date.now();
  const r = await runUntilBanner(child, { timeoutMs: 5000 });
  assert.ok(Date.now() - t < 2000, 'sat out the banner timeout for a board that had already died');
  assert.equal(r.dead, true);
  assert.match(r.err, /cannot start/);
});
