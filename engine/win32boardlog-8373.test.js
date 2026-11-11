'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
/* #8373: a Windows board's output goes to <LOCALAPPDATA>\Kosmos\logs\board.log, stamped as the Mac's file is, while
   the console copy stays the board's own text; the diagnostics read takes the file back as this board's output.
   Runs on every platform: the platform is passed in. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boardlog = require('./win32boardlog');
const diagnostics = require('./diagnostics');

const T = '2026-11-11T14:00:00.000Z';
const now = () => new Date(T);
function fakeStream() {
  const got = [];
  return { got, write(chunk, encoding, cb) { got.push(String(chunk)); if (typeof encoding === 'function') encoding(); else if (typeof cb === 'function') cb(); return true; } };
}
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-winlog-8373-')); }
/* Routes two fake streams into `file`, with the crash writer captured instead of registered on this process. */
function routeInto(t, file, extra) {
  boardlog.resetForTest();
  const out = fakeStream(), err = fakeStream(), crash = {};
  const r = boardlog.route(out, err, { platform: 'win32', path: file, isFile: () => false, taskStarted: () => true, now, onCrash: (name, fn) => { crash[name] = fn; }, ...(extra || {}) });
  t.after(() => { if (r) fs.closeSync(r.fd); boardlog.resetForTest(); });
  return { r, out, err, crash };
}

test('#8373 the log sits beside the durable runtime folder; a named Kosmos has its own file', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' };
  assert.strictEqual(boardlog.logPath('win32', 'C:\\Users\\p', env), 'C:\\Users\\p\\AppData\\Local\\Kosmos\\logs\\board.log');
  assert.strictEqual(boardlog.logPath('win32', 'C:\\Users\\p', { ...env, KOSMOS_WORLD: 'acme' }),
    'C:\\Users\\p\\AppData\\Local\\Kosmos\\logs\\board-acme.log');
  assert.strictEqual(boardlog.logPath('win32', 'C:\\Users\\p', { ...env, KOSMOS_WORLD: 'a b' }).endsWith('\\board-a_b.log'), true, 'odd characters stay out of the name');
});

test('#8373 both streams reach the file stamped; the console gets the board\'s own text and its callbacks', (t) => {
  const file = path.join(scratch(), 'logs', 'board.log');
  const { r, out, err } = routeInto(t, file);
  assert.ok(r, 'it routed');
  assert.strictEqual(r.path, file);
  assert.strictEqual(boardlog.current(), r);
  let called = 0;
  out.write('one\n', () => { called++; });
  err.write(Buffer.from('two\nthr'));
  out.write('ee\n', 'utf8', () => { called++; });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), `${T} one\n${T} two\n${T} three\n`, 'one line state for both streams');
  assert.deepStrictEqual(out.got, ['one\n', 'ee\n'], 'the console copy is not stamped');
  assert.deepStrictEqual(err.got, ['two\nthr']);
  assert.strictEqual(called, 2, 'callbacks still run');
});

test('#8373 diagnostics read the routed file back as this board\'s output', (t) => {
  const file = path.join(scratch(), 'logs', 'board.log');
  const { r, out } = routeInto(t, file);
  out.write('a known board line\n');
  const why = {};
  assert.deepStrictEqual(diagnostics.readBoardLog(file, [r.fd, r.fd], 50, why), [`${T} a known board line`], 'why=' + why.why);
});

test('#8373 an uncaught exception\'s stack is written to the file, every line stamped', (t) => {
  const file = path.join(scratch(), 'board.log');
  const { out, crash } = routeInto(t, file);
  out.write('half a line');
  assert.strictEqual(typeof crash.uncaughtExceptionMonitor, 'function', 'the writer is registered');
  const e = new Error('boom'); e.stack = 'Error: boom\n    at here';
  crash.uncaughtExceptionMonitor(e, 'uncaughtException');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), `${T} half a line\n${T} uncaughtException: Error: boom\n${T}     at here\n`);
});

test('#8373 a big file is moved aside at start, and a file left mid-line gets its line ended first', (t) => {
  const dir = scratch(), file = path.join(dir, 'board.log');
  fs.writeFileSync(file, Buffer.alloc(boardlog.ROTATE_BYTES + 1, 0x61));
  const first = routeInto(t, file);
  assert.strictEqual(fs.statSync(file + '.old').size, boardlog.ROTATE_BYTES + 1, 'the old file is kept once');
  first.out.write('fresh\n');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), `${T} fresh\n`);
  boardlog.resetForTest();   // first's descriptor is closed by its own after()
  fs.writeFileSync(file, 'cut off');
  const second = boardlog.route(fakeStream(), fakeStream(), { platform: 'win32', path: file, isFile: () => false, taskStarted: () => true, now, onCrash: () => {} });
  t.after(() => { if (second) fs.closeSync(second.fd); boardlog.resetForTest(); });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'cut off\n');
});

test('#8373 nothing changes off Windows, for a board its task did not start, when either stream is already a file, or in a test with no file named', () => {
  boardlog.resetForTest();
  const dir = scratch();
  const deps = (extra) => ({ platform: 'win32', isFile: () => false, taskStarted: () => true, onCrash: () => {}, ...extra });
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ platform: 'darwin', path: path.join(dir, 'a.log') })), null);
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ path: path.join(dir, 'b.log'), isFile: (fd) => fd === 1 })), null);
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ path: path.join(dir, 'c.log'), isFile: (fd) => fd === 2 })), null);
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ path: path.join(dir, 'd.log'), taskStarted: () => false })), null, 'a board started by hand or by a test');
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ env: { LOCALAPPDATA: dir } })), null, 'a test process never writes the real log');
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'no file was made');
  assert.strictEqual(boardlog.current(), null);
});

test('#8373 a log that cannot be opened leaves the board as it was', () => {
  boardlog.resetForTest();
  const blocked = path.join(scratch(), 'logs');
  fs.writeFileSync(blocked, 'a file where the folder should be');
  const out = fakeStream();
  const before = out.write;
  assert.strictEqual(boardlog.route(out, fakeStream(), { platform: 'win32', path: path.join(blocked, 'board.log'), isFile: () => false, taskStarted: () => true, onCrash: () => {} }), null);
  assert.strictEqual(out.write, before, 'the stream was not wrapped');
  assert.strictEqual(boardlog.current(), null);
});
