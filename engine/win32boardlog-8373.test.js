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
function routeInto(t, file, extra) {   // extra.handlers: how many uncaughtException handlers the monitor sees
  boardlog.resetForTest();
  const out = fakeStream(), err = fakeStream(), crash = {};
  const r = boardlog.route(out, err, { platform: 'win32', path: file, isFile: () => false, taskStarted: () => true, now, handlers: () => 0, onCrash: (name, fn) => { crash[name] = fn; }, ...(extra || {}) });
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

test('#8373 a hex write is copied as it is and leaves the line state; a latin1 write keeps its bytes', (t) => {
  const file = path.join(scratch(), 'board.log');
  const { out } = routeInto(t, file);
  out.write('ab\n');
  out.write('6869', 'hex');
  out.write('caf\u00e9\n', 'latin1');
  const bytes = fs.readFileSync(file);
  assert.deepStrictEqual(bytes, Buffer.concat([Buffer.from(T + ' ab\n'), Buffer.from('hi'), Buffer.from(T + ' caf', 'latin1'), Buffer.from([0xe9, 0x0a])]));
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

test('#8373 an error something catches is not written as a crash', (t) => {
  const file = path.join(scratch(), 'board.log');
  const { crash } = routeInto(t, file, { handlers: () => 1 });
  crash.uncaughtExceptionMonitor(new Error('caught'), 'uncaughtException');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '');
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
  const deps = (extra) => ({ platform: 'win32', isFile: () => false, taskStarted: () => true, inTest: () => true, onCrash: () => {}, ...extra });
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ platform: 'darwin', path: path.join(dir, 'a.log') })), null);
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ path: path.join(dir, 'b.log'), isFile: (fd) => fd === 1 })), null);
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ path: path.join(dir, 'c.log'), isFile: (fd) => fd === 2 })), null);
  assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ path: path.join(dir, 'd.log'), taskStarted: () => false })), null, 'a board started by hand or by a test');
  const cwd = process.cwd();   // a regression would write a relative Windows path: keep it in this folder
  process.chdir(dir);
  try { assert.strictEqual(boardlog.route(fakeStream(), fakeStream(), deps({ env: { LOCALAPPDATA: dir } })), null, 'a test process never writes the real log'); }
  finally { process.chdir(cwd); }
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

test('#8373 server.js routes before the ring and the stamp, and its diagnostics read take the routed file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = src.indexOf("require('./engine/win32boardlog').route(process.stdout, process.stderr)");
  const unrouted = src.indexOf('if (!routedLog) {', route);
  const stamp = src.indexOf('logstamp.install(process.stdout, 1', route);
  const ring = src.indexOf("logring.board.tap(process.stdout, 'stdout')");
  assert.ok(route > 0, 'server.js does not route the Windows board log');
  assert.ok(unrouted > route && stamp > unrouted && ring > stamp, 'the order is not route, then the stamp for an unrouted board, then the ring');
  const diag = src.indexOf("require('./engine/win32boardlog').current()");
  assert.ok(diag > ring, 'the diagnostics route does not ask which file was routed');
  assert.match(src.slice(diag, diag + 600), /readBoardLog\(logPath, logFds,/, 'the diagnostics read does not use the routed descriptors');
});

/* #8373 follow-up (Homer, 0.8.03): a dead console must not stop a routed board. These use node's own Writable, so its
   argument checks and its handling of a stream that has errored are node's, not a fake's. */
const { Writable } = require('node:stream');
function console_(mode) {
  const got = [];
  const w = new Writable({
    write(chunk, enc, cb) {
      if (mode === 'epipe') { const err = new Error('write EPIPE'); err.code = 'EPIPE'; err.syscall = 'write'; return cb(err); }
      got.push(String(chunk)); cb();
    },
  });
  w.got = got;
  return w;
}
function routeConsole(t, out, err) {
  const file = path.join(scratch(), 'board.log');
  boardlog.resetForTest();
  const r = boardlog.route(out, err || fakeStream(), { platform: 'win32', path: file, isFile: () => false, taskStarted: () => true, now, handlers: () => 0, onCrash: () => {} });
  t.after(() => { if (r) fs.closeSync(r.fd); boardlog.resetForTest(); });
  return file;
}
const tick = () => new Promise((res) => setImmediate(res));

test('#8373 a console that fails with EPIPE does not become an uncaught error, and the file keeps every line', async (t) => {
  const out = console_('epipe');
  const file = routeConsole(t, out);
  assert.ok(out.listenerCount('error') > 0, 'the console stream has an error listener');
  const seen = [];
  out.write('first\n', (e) => seen.push(e && e.code));
  await tick();
  out.write('second\n', (e) => seen.push(e && e.code));
  await tick();
  assert.strictEqual(seen.length, 2, 'both callbacks ran');
  assert.strictEqual(seen[0], 'EPIPE', 'the failing write is told why');
  assert.ok(seen[1], 'a write after the failure is told the stream is gone: ' + seen[1]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), `${T} first\n${T} the console copy of stdout stopped (EPIPE); this file keeps every line\n${T} second\n`);
});

test('#8373 a caller\'s bad argument throws as node decides, on a healthy console and a dead one', async (t) => {
  const healthy = console_('ok');
  const f1 = routeConsole(t, healthy);
  for (const [bad, code] of [[42, 'ERR_INVALID_ARG_TYPE'], [null, 'ERR_STREAM_NULL_VALUES']]) {
    assert.throws(() => healthy.write(bad), { code }, 'healthy: ' + String(bad));
  }
  assert.throws(() => healthy.write(Buffer.from('x'), 'bogus'), { code: 'ERR_UNKNOWN_ENCODING' });
  assert.doesNotMatch(fs.readFileSync(f1, 'utf8'), /console copy of (stdout|stderr) stopped/, 'a bad argument does not end the console copy');
  healthy.write('after\n');
  assert.deepStrictEqual(healthy.got, ['after\n'], 'and the console still gets a good write');
  const dead = console_('epipe');
  routeConsole(t, dead);
  dead.write('x\n');
  await tick();
  for (const [bad, code] of [[42, 'ERR_INVALID_ARG_TYPE'], [null, 'ERR_STREAM_NULL_VALUES']]) {
    assert.throws(() => dead.write(bad), { code }, 'dead: ' + String(bad));
  }
  assert.throws(() => dead.write(Buffer.from('x'), 'bogus'), { code: 'ERR_UNKNOWN_ENCODING' });
});

test('#8373 control: a healthy console gets every write, and the file says nothing stopped', (t) => {
  const out = console_('ok');
  const file = routeConsole(t, out);
  out.write('a\n'); out.write('b\n');
  assert.deepStrictEqual(out.got, ['a\n', 'b\n']);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /console copy of (stdout|stderr) stopped/);
});

test('#8373 stdout and stderr fail apart, each with its own line', async (t) => {
  const out = console_('epipe'), err = console_('ok');
  const file = routeConsole(t, out, err);
  out.write('o\n');
  await tick();
  err.write('e\n');
  assert.deepStrictEqual(err.got, ['e\n'], 'stderr still reaches its console after stdout failed');
  const log = fs.readFileSync(file, 'utf8');
  assert.match(log, /console copy of stdout stopped/);
  assert.doesNotMatch(log, /console copy of stderr stopped/);
});

test('#8373 a write that throws an I/O error does not throw out of the board', async (t) => {
  const out = { write() { const e = new Error('write EPIPE'); e.code = 'EPIPE'; e.syscall = 'write'; throw e; }, on() {} };
  const file = routeConsole(t, out);
  let got;
  assert.doesNotThrow(() => out.write('kept\n', 'utf8', (e) => { got = e && e.code; }));
  await tick();
  assert.strictEqual(got, 'EPIPE', 'its callback carries the error');
  assert.match(fs.readFileSync(file, 'utf8'), /kept\n[\s\S]*the console copy of stdout stopped \(EPIPE\)/);
});

test('#8373 once the console has failed, a write returns true, so no caller waits for a drain', async (t) => {
  const out = console_('epipe');
  routeConsole(t, out);
  out.write('first\n');
  await tick();
  assert.strictEqual(out.write('later\n'), true);
});
