'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
// kosmos#8599: a reader that stops early ends a CLI node process quietly (exit 141), not with an EPIPE stack trace.
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

test('guarded: a closed reader is a quiet exit 141 (CONTROL: unguarded, the same writer prints the EPIPE trace)', async () => {
  const guarded = await runAndCloseEarly(['-e', "require(process.argv[1]).install(process); " + WRITER, GUARD]);
  assert.strictEqual(guarded.first, 'line 0 ' + 'x'.repeat(40));
  assert.strictEqual(guarded.code, 141, guarded.err);
  assert.doesNotMatch(guarded.err, /EPIPE|Unhandled 'error'/);

  const bare = await runAndCloseEarly(['-e', WRITER]);
  assert.match(bare.err, /EPIPE/, 'CONTROL: without the guard the trace must show, or the guarded arm proves nothing');
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
  assert.match(board.err, /EPIPE/, 'the board keeps its own closed-stdout behaviour (no guard)');
  const other = await runAndCloseEarly([path.join(dir, 'other.js')], env);
  assert.strictEqual(other.code, 141, other.err);
  assert.doesNotMatch(other.err, /EPIPE/);
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

test('any other stream error is thrown again (only EPIPE is quiet)', () => {
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

test('the Windows CLI guards itself before main() runs (it is one node program, with no install/kosmos preload)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  const entry = src.slice(src.indexOf('if (require.main === module) {'));
  const guard = entry.indexOf("require(path.join(engineDir(), 'clipipe.js')).install(process)");
  assert.ok(guard > 0, 'the entry block requires clipipe and installs it');
  assert.ok(guard < entry.indexOf('main(process.argv.slice(2))'), 'before main() starts writing');
});
