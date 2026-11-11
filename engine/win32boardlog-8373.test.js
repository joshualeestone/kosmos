'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
/* #8373: a Windows board's output goes to <LOCALAPPDATA>\Kosmos\logs\board.log, and the stamp and the
   diagnostics read treat that file as the Mac treats fd 1. Runs on every platform: the platform is passed in. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boardlog = require('./win32boardlog');
const logstamp = require('./logstamp');
const diagnostics = require('./diagnostics');

function fakeStream() {
  const got = [];
  return { got, write(chunk, encoding, cb) { got.push(String(chunk)); if (typeof encoding === 'function') encoding(); else if (typeof cb === 'function') cb(); return true; } };
}
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-winlog-8373-')); }

test('#8373 the log sits beside the durable runtime folder, not under the app', () => {
  assert.strictEqual(boardlog.logPath('win32', 'C:\\Users\\p', { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' }),
    'C:\\Users\\p\\AppData\\Local\\Kosmos\\logs\\board.log');
});

test('#8373 on Windows both streams are copied into the log, and still written as before', (t) => {
  boardlog.resetForTest();
  const dir = scratch(), file = path.join(dir, 'logs', 'board.log');
  const out = fakeStream(), err = fakeStream();
  const r = boardlog.route(out, err, { platform: 'win32', path: file, isFile: () => false });
  t.after(() => { if (r) fs.closeSync(r.fd); boardlog.resetForTest(); });
  assert.ok(r, 'it routed');
  assert.strictEqual(r.path, file);
  assert.strictEqual(boardlog.current(), r);
  let called = 0;
  out.write('one\n', () => { called++; });
  err.write(Buffer.from('two\n'));
  out.write('three\n', 'utf8', () => { called++; });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'one\ntwo\nthree\n');
  assert.deepStrictEqual(out.got, ['one\n', 'three\n']);
  assert.deepStrictEqual(err.got, ['two\n']);
  assert.strictEqual(called, 2, 'callbacks still run');
});

test('#8373 the stamp marks the routed file and diagnostics read it back as this board\'s output', (t) => {
  boardlog.resetForTest();
  const dir = scratch(), file = path.join(dir, 'logs', 'board.log');
  const out = fakeStream(), err = fakeStream();
  const r = boardlog.route(out, err, { platform: 'win32', path: file, isFile: () => false });
  t.after(() => { if (r) fs.closeSync(r.fd); boardlog.resetForTest(); });
  const shared = logstamp.sameFile(r.fd, r.fd) ? { atLineStart: true } : undefined;
  const now = () => new Date('2026-11-11T14:00:00.000Z');
  assert.strictEqual(logstamp.install(out, r.fd, { shared, logPaths: [file], now }), true, 'the stamp installs on the routed fd');
  logstamp.install(err, r.fd, { shared, logPaths: [file], now });
  out.write('a known board line\n');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '2026-11-11T14:00:00.000Z a known board line\n');
  const why = {};
  const lines = diagnostics.readBoardLog(file, [r.fd, r.fd], 50, why);
  assert.deepStrictEqual(lines, ['2026-11-11T14:00:00.000Z a known board line'], 'read back, why=' + why.why);
});

test('#8373 nothing changes off Windows, or when the output is already a file', () => {
  boardlog.resetForTest();
  const dir = scratch();
  const mac = boardlog.route(fakeStream(), fakeStream(), { platform: 'darwin', path: path.join(dir, 'a.log'), isFile: () => false });
  assert.strictEqual(mac, null);
  const filed = boardlog.route(fakeStream(), fakeStream(), { platform: 'win32', path: path.join(dir, 'b.log'), isFile: () => true });
  assert.strictEqual(filed, null);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'no file was made');
  assert.strictEqual(boardlog.current(), null);
});

test('#8373 a log that cannot be opened leaves the board as it was', () => {
  boardlog.resetForTest();
  const dir = scratch();
  const blocked = path.join(dir, 'logs');
  fs.writeFileSync(blocked, 'a file where the folder should be');
  const out = fakeStream();
  const before = out.write;
  assert.strictEqual(boardlog.route(out, fakeStream(), { platform: 'win32', path: path.join(blocked, 'board.log'), isFile: () => false }), null);
  assert.strictEqual(out.write, before, 'the stream was not wrapped');
  assert.strictEqual(boardlog.current(), null);
});
