'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
// kosmos#8599: a reader that stops early ends a CLI node process quietly (exit 141), not with a stack trace.
// The whole-CLI path (install/kosmos preloading this through NODE_OPTIONS) is tools/test-cli-epipe-8599.sh.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const clipipe = require('./clipipe');

const GUARD = path.join(__dirname, 'clipipe.js');
// kosmos#8714: a spawned child's stdout is a socket, so its closed reader can read as ENOTCONN or ECONNRESET.
const CLOSED = /EPIPE|ENOTCONN|ECONNRESET/;
// About 1 MB, far more than a pipe holds, so the write is still going when the reader closes.
const WRITER = "process.stdout.write(Array.from({ length: 20000 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(40)).join('\\n') + '\\n');";

/** Run node with `args`, read stdout until the first newline, then close the read end. */
function runAndCloseEarly(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let first = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => {
      first += d;
      if (first.includes('\n')) child.stdout.destroy();
    });
    child.on('close', (code, signal) => resolve({ code, signal, err, first: first.split('\n')[0] }));
  });
}

test('guarded: a closed reader is a quiet exit 141 (CONTROL: unguarded, the same writer prints the closed-reader trace)', async () => {
  const guarded = await runAndCloseEarly(['-e', "require(process.argv[1]).install(process); " + WRITER, GUARD]);
  assert.strictEqual(guarded.first, 'line 0 ' + 'x'.repeat(40));
  assert.strictEqual(guarded.code, 141, guarded.err);
  assert.doesNotMatch(guarded.err, /EPIPE|ENOTCONN|ECONNRESET|Unhandled 'error'/);

  const bare = await runAndCloseEarly(['-e', WRITER]);
  assert.match(bare.err, CLOSED, 'CONTROL: without the guard the trace must show, or the guarded arm proves nothing');
  assert.notStrictEqual(bare.code, 141);
});

test('as a preload: it restores the NODE_OPTIONS it was loaded with, then guards', async () => {
  const env = { NODE_OPTIONS: '--require "' + GUARD + '"', KOSMOS_CLIPIPE_SET: '1',
    KOSMOS_USER_NODE_OPTIONS: '', KOSMOS_USER_NODE_OPTIONS_SET: '' };
  const seen = await runAndCloseEarly(['-e',
    "process.stderr.write(JSON.stringify([process.env.NODE_OPTIONS ?? null, process.env.KOSMOS_CLIPIPE_SET ?? null]) + '\\n'); " + WRITER], env);
  assert.strictEqual(seen.code, 141, seen.err);
  assert.strictEqual(seen.err.trim(), '[null,null]');
});

test('the board (an entry named server.js) restores the env but is not guarded (CONTROL: another entry is)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-clipipe-8599-'));
  const body = "process.stderr.write(JSON.stringify([process.env.NODE_OPTIONS ?? null]) + '\\n'); " + WRITER;
  fs.writeFileSync(path.join(dir, 'server.js'), body);
  fs.writeFileSync(path.join(dir, 'other.js'), body);
  const env = { NODE_OPTIONS: '--require "' + GUARD + '"', KOSMOS_CLIPIPE_SET: '1',
    KOSMOS_USER_NODE_OPTIONS: '', KOSMOS_USER_NODE_OPTIONS_SET: '' };
  const board = await runAndCloseEarly([path.join(dir, 'server.js')], env);
  assert.match(board.err, /^\[null\]/, 'the board still restores NODE_OPTIONS');
  assert.match(board.err, CLOSED, 'the board keeps its own closed-stdout behaviour (no guard)');
  const other = await runAndCloseEarly([path.join(dir, 'other.js')], env);
  assert.strictEqual(other.code, 141, other.err);
  assert.doesNotMatch(other.err, CLOSED);
});

test('restoreNodeOptions: back to the person\'s value, or unset when they had none; untouched without the marker', () => {
  const theirs = { NODE_OPTIONS: '--max-old-space-size=300 --require x', KOSMOS_CLIPIPE_SET: '1',
    KOSMOS_USER_NODE_OPTIONS: '--max-old-space-size=300', KOSMOS_USER_NODE_OPTIONS_SET: '1' };
  assert.strictEqual(clipipe.restoreNodeOptions(theirs), true);
  assert.deepStrictEqual(theirs, { NODE_OPTIONS: '--max-old-space-size=300' });

  const emptyButSet = { NODE_OPTIONS: '--require x', KOSMOS_CLIPIPE_SET: '1', KOSMOS_USER_NODE_OPTIONS: '', KOSMOS_USER_NODE_OPTIONS_SET: '1' };
  clipipe.restoreNodeOptions(emptyButSet);
  assert.deepStrictEqual(emptyButSet, { NODE_OPTIONS: '' });

  const none = { NODE_OPTIONS: '--require x', KOSMOS_CLIPIPE_SET: '1', KOSMOS_USER_NODE_OPTIONS: '', KOSMOS_USER_NODE_OPTIONS_SET: '' };
  clipipe.restoreNodeOptions(none);
  assert.deepStrictEqual(none, {});

  const notOurs = { NODE_OPTIONS: '--require y' };
  assert.strictEqual(clipipe.restoreNodeOptions(notOurs), false);
  assert.deepStrictEqual(notOurs, { NODE_OPTIONS: '--require y' });
});

test('kosmos#8714: each closed-reader code is a quiet exit on either stream (EPIPE, ENOTCONN, ECONNRESET)', () => {
  for (const code of ['EPIPE', 'ENOTCONN', 'ECONNRESET']) {
    for (const which of ['stdout', 'stderr']) {
      const exits = [];
      const proc = { stdout: new EventEmitter(), stderr: new EventEmitter(), exit: (c) => exits.push(c) };
      clipipe.install(proc);
      proc[which].emit('error', Object.assign(new Error('write ' + code), { code, syscall: 'write' }));
      assert.deepStrictEqual(exits, [clipipe.QUIT_ON_CLOSED_READER], code + ' on ' + which);
    }
  }
  assert.deepStrictEqual([...clipipe.CLOSED_READER_CODES].sort(), ['ECONNRESET', 'ENOTCONN', 'EPIPE']);
});

test('any other stream error is thrown again (only a closed reader is quiet)', () => {
  const exits = [];
  const proc = { stdout: new EventEmitter(), stderr: new EventEmitter(), exit: (c) => exits.push(c) };
  clipipe.install(proc);
  const eio = Object.assign(new Error('EIO'), { code: 'EIO' });
  assert.throws(() => proc.stdout.emit('error', eio), /EIO/);
  assert.deepStrictEqual(exits, []);
  proc.stderr.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }));
  assert.deepStrictEqual(exits, [clipipe.QUIT_ON_CLOSED_READER]);
  clipipe.install(proc);   // a second call adds no second listener
  assert.strictEqual(proc.stdout.listenerCount('error'), 1);
});

test('a program with its own error handler keeps it: the guard steps aside (CONTROL: alone, it acts)', () => {
  const exits = [];
  const proc = { stdout: new EventEmitter(), stderr: new EventEmitter(), exit: (c) => exits.push(c) };
  clipipe.install(proc);
  const theirs = [];
  proc.stdout.on('error', (e) => theirs.push(e.code));
  proc.stdout.emit('error', Object.assign(new Error('EIO'), { code: 'EIO' }));       // not thrown: theirs handled it
  proc.stdout.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }));   // not an exit: theirs handled it
  assert.deepStrictEqual(theirs, ['EIO', 'EPIPE']);
  assert.deepStrictEqual(exits, []);
  proc.stderr.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }));   // CONTROL: stderr has only ours
  assert.deepStrictEqual(exits, [clipipe.QUIT_ON_CLOSED_READER]);
});

test('the Windows CLI guards itself before main() runs, checked by source (measured on Windows by hand; see the plan)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  const entry = src.slice(src.indexOf('if (require.main === module) {'));
  const guard = entry.indexOf("require(path.join(engineDir(), 'clipipe.js')).install(process)");
  assert.ok(guard > 0, 'the entry block requires clipipe and installs it');
  assert.ok(guard < entry.indexOf('main(process.argv.slice(2))'), 'before main() starts writing');
});

/* kosmos#8603 item 2: "still crashes as before" measured in a real process (the error is emitted by hand): a stream error
   that is not a closed reader still ends the program with a non-zero exit and its message on stderr (CONTROL: Node
   alone does the same). Only the trace differs: it points at this guard's rethrow, not at Node's own line. */
test('kosmos#8603: a non-closed-reader stream error still crashes, non-zero, with its message (CONTROL: unguarded, the same)', () => {
  const { spawnSync } = require('node:child_process');
  const body = "const e = new Error('boom-8603'); e.code = 'EIO'; process.stdout.emit('error', e);";
  const guarded = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(GUARD) + ').install(); ' + body], { encoding: 'utf8' });
  const alone = spawnSync(process.execPath, ['-e', body], { encoding: 'utf8' });
  assert.notStrictEqual(alone.status, 0, 'CONTROL: Node alone must crash on it');
  assert.strictEqual(guarded.status, alone.status, 'the guard changed the exit code: ' + guarded.status + ' vs ' + alone.status);
  assert.match(guarded.stderr, /boom-8603/, 'the error is not said on stderr');
  assert.notStrictEqual(guarded.status, 141, 'a non-closed-reader error was taken for a closed reader');
});
