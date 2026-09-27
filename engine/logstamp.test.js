'use strict';

/*
 * #4199: every line the board writes into board.log starts with a UTC time; a pipe or a terminal is left alone.
 * The pure stamping is tested directly, and install() is tested on a REAL child process whose stdout is a file (as
 * board.log is under launchd and nohup) against one whose stdout is a pipe (as every test that spawns the board reads it).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const logstamp = require('./logstamp');

const ISO = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z';

test('#4199 stampText: every line start gets the stamp and one space; the text after it is unchanged', () => {
  assert.deepEqual(logstamp.stampText('a\nb\n', true, 'T'), { text: 'T a\nT b\n', atLineStart: true });
  assert.deepEqual(logstamp.stampText('', true, 'T'), { text: '', atLineStart: true }, 'an empty write stamps nothing');
  assert.deepEqual(logstamp.stampText('\n\n', true, 'T'), { text: 'T \nT \n', atLineStart: true }, 'blank lines are lines too');
});

test('#4199 stampText: a line split across writes is stamped once, where it starts', () => {
  const a = logstamp.stampText('class1-autohandle: Ka', true, 'T1');
  assert.deepEqual(a, { text: 'T1 class1-autohandle: Ka', atLineStart: false });
  const b = logstamp.stampText('no (kano) handled\nnext', a.atLineStart, 'T2');
  assert.equal(b.text, 'no (kano) handled\nT2 next', 'the rest of a line was stamped again, or the next line was not');
  assert.equal(b.atLineStart, false);
});

function childWrites(stdio) {
  const script = [
    "require(" + JSON.stringify(path.join(__dirname, 'logstamp.js')) + ").install(process.stdout, 1);",
    "process.stdout.write('class1-autohandle: Kano (kano) handled (trust+restart) - x\\n');",
    "console.log('Kosmos on http://127.0.0.1:1');",
    "process.stdout.write(Buffer.from('a buffer line\\n'));",
  ].join('\n');
  return spawnSync(process.execPath, ['-e', script], { stdio, encoding: 'utf8' });
}

test('#4199 install: into a FILE (board.log), each line starts with an ISO-8601 UTC time and keeps its text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const file = path.join(dir, 'board.log');
  const fd = fs.openSync(file, 'a');
  try {
    const r = childWrites(['ignore', fd, 'inherit']);
    assert.equal(r.status, 0, String(r.stderr));
  } finally { fs.closeSync(fd); }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(lines.length, 3, JSON.stringify(lines));
  for (const l of lines) assert.match(l, new RegExp('^' + ISO + ' '), 'a board.log line has no UTC time: ' + l);
  assert.match(lines[0], new RegExp('^' + ISO + ' class1-autohandle: Kano \\(kano\\) handled \\(trust\\+restart\\) - x$'), 'the text after the time changed');
  assert.match(lines[1], /Kosmos on http:\/\/127\.0\.0\.1:1$/, 'console.log is not stamped the same way');
  assert.match(lines[2], /a buffer line$/, 'a Buffer write lost its text');
  assert.ok(lines.every((l) => l.includes('class1-autohandle:') || l.includes('Kosmos on') || l.includes('a buffer line')), 'a grep for the old text no longer matches');
});

test('#4199 install: into a PIPE (a test reading the board), nothing is stamped', () => {
  const r = childWrites(['ignore', 'pipe', 'inherit']);
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(r.stdout, 'class1-autohandle: Kano (kano) handled (trust+restart) - x\nKosmos on http://127.0.0.1:1\na buffer line\n', 'a pipe was stamped');
});

test('#4199 install: once per stream, and never on a stream that is not a regular file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const fd = fs.openSync(path.join(dir, 'f'), 'a');
  const out = [];
  const s = { write: (t) => { out.push(t); return true; } };
  try {
    assert.equal(logstamp.install(s, fd, { now: () => new Date(0) }), true);
    assert.equal(logstamp.install(s, fd, { now: () => new Date(0) }), false, 'installed twice (lines would get two times)');
    s.write('x\n');
    assert.deepEqual(out, ['1970-01-01T00:00:00.000Z x\n']);
    assert.equal(logstamp.install({ write() {} }, 999999), false, 'a bad descriptor was treated as a file');
  } finally { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#4199 server.js installs the stamp right after the world bootstrap, for stdout and stderr, only when it runs as the board', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const boot = src.indexOf("require('./engine/worldenv').bootstrapWorldEnv(");
  const at = src.indexOf("require('./engine/logstamp')");
  assert.ok(boot > 0 && at > boot, 'the stamp is not after the world bootstrap (which must stay the first engine require)');
  const between = src.slice(src.indexOf('\n', boot) + 1, at).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.ok(between.startsWith('if (require.main === module) {'), 'something runs between the bootstrap and the stamp: ' + between.slice(0, 80));
  const blockStart = src.lastIndexOf('if (require.main === module)', at);
  const block = src.slice(blockStart, src.indexOf('\n}\n', at) + 2);   // the whole guard block, however long its comments
  assert.match(block, /logstamp\.install\(process\.stdout, 1\b/, 'stdout is not stamped');
  assert.match(block, /logstamp\.install\(process\.stderr, 2\b/, 'stderr is not stamped');
  assert.match(block, /logstamp\.sameFile\(1, 2\)/, 'stdout and stderr do not share a line state when they are the same file');
});

function fileStream() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const fd = fs.openSync(path.join(dir, 'f'), 'a');
  const out = [];
  return { fd, out, s: { write: (t, enc) => { out.push([t, enc]); return true; } }, done: () => { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('#4199 install: Buffer writes go out byte for byte, a split UTF-8 character and invalid bytes included', () => {
  const f = fileStream();
  try {
    logstamp.install(f.s, f.fd, { now: () => new Date(0) });
    const bytes = Buffer.from('é\n');   // c3 a9 0a
    f.s.write(bytes.subarray(0, 1)); f.s.write(bytes.subarray(1));
    f.s.write(Buffer.from([0xff, 0x41, 0x0a]));   // not UTF-8: must not be rewritten
    const all = Buffer.concat(f.out.map((x) => (Buffer.isBuffer(x[0]) ? x[0] : Buffer.from(x[0]))));
    const stamp = Buffer.from('1970-01-01T00:00:00.000Z ');
    assert.deepEqual(all, Buffer.concat([stamp, Buffer.from([0xc3]), Buffer.from([0xa9, 0x0a]), stamp, Buffer.from([0xff, 0x41, 0x0a])]),
      'a byte was changed, dropped, held back or reordered');
  } finally { f.done(); }
});

test('#4199 install: hex goes through untouched; latin1 and ascii text is stamped and keeps its encoding', () => {
  const f = fileStream();
  try {
    logstamp.install(f.s, f.fd, { now: () => new Date(0) });
    f.s.write('68690a', 'hex');
    f.s.write('caf\xe9\n', 'latin1');
    f.s.write('plain\n', 'ascii');
    assert.deepEqual(f.out, [['68690a', 'hex'], ['1970-01-01T00:00:00.000Z caf\xe9\n', 'latin1'], ['1970-01-01T00:00:00.000Z plain\n', 'ascii']]);
  } finally { f.done(); }
});

test('#4199 install: two streams on the SAME file share one line state, so a line one starts and the other ends is stamped once', () => {
  const f = fileStream();
  const g = { out: [], s: null };
  g.s = { write: (t) => { g.out.push(t); return true; } };
  try {
    const shared = { atLineStart: true };
    logstamp.install(f.s, f.fd, { now: () => new Date(0), shared });
    logstamp.install(g.s, f.fd, { now: () => new Date(0), shared });
    f.s.write('half ');
    g.s.write('the rest\n');
    f.s.write('next\n');
    assert.deepEqual([f.out[0][0], g.out[0], f.out[1][0]], ['1970-01-01T00:00:00.000Z half ', 'the rest\n', '1970-01-01T00:00:00.000Z next\n']);
    assert.equal(logstamp.sameFile(f.fd, f.fd), true);
  } finally { f.done(); }
});

test('#4199 a board.log left mid-line by a board that died is ended first, so this run starts on its own line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const file = path.join(dir, 'board.log');
  fs.writeFileSync(file, 'the old board died in the middle of this');
  const fd = fs.openSync(file, 'a');
  const out = [];
  const s = { write: (t) => { out.push(t); fs.writeSync(fd, t); return true; } };
  try {
    assert.equal(logstamp.endsMidLine(fd, [path.join(dir, 'other.log'), file]), true, 'the unfinished line was not seen');
    logstamp.install(s, fd, { now: () => new Date(0), logPaths: [file] });
    s.write('Kosmos on http://127.0.0.1:1\n');
  } finally { fs.closeSync(fd); }
  const text = fs.readFileSync(file, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(text, 'the old board died in the middle of this\n1970-01-01T00:00:00.000Z Kosmos on http://127.0.0.1:1\n', 'the new line was glued to the old one');
});

test('#4199 a board.log that ends a line, or that is not the file on fd, gets no extra newline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const file = path.join(dir, 'board.log');
  const other = path.join(dir, 'other.log');
  fs.writeFileSync(file, 'a finished line\n');
  fs.writeFileSync(other, 'mid');
  const fd = fs.openSync(file, 'a');
  try {
    assert.equal(logstamp.endsMidLine(fd, [file]), false);
    assert.equal(logstamp.endsMidLine(fd, [other]), false, 'a different file was read in its place');
  } finally { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#4199 stampBytes: stamps after each newline byte and changes no byte of the text', () => {
  const r = logstamp.stampBytes(Buffer.from('a\nb'), true, 'T');
  assert.equal(r.buf.toString(), 'T a\nT b');
  assert.equal(r.atLineStart, false);
  const e = logstamp.stampBytes(Buffer.alloc(0), true, 'T');
  assert.equal(e.buf.length, 0, 'an empty write stamped something');
});

test('#4199 end to end: a child whose stdout AND stderr are the same board.log stamps console.log and console.error once each', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const file = path.join(dir, 'board.log');
  const fd = fs.openSync(file, 'a');
  const mod = JSON.stringify(path.join(__dirname, 'logstamp.js'));
  const script = "const l = require(" + mod + "); const shared = l.sameFile(1, 2) ? { atLineStart: true } : undefined;"
    + "l.install(process.stdout, 1, { shared }); l.install(process.stderr, 2, { shared });"
    + "process.stdout.write('half from stdout, '); process.stderr.write('ended by stderr\\n');"
    + "console.log('a log line'); console.error('an error line');";
  try {
    const r = spawnSync(process.execPath, ['-e', script], { stdio: ['ignore', fd, fd] });
    assert.equal(r.status, 0);
  } finally { fs.closeSync(fd); }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(lines.length, 3, JSON.stringify(lines));
  for (const l of lines) assert.equal((l.match(new RegExp(ISO, 'g')) || []).length, 1, 'a line has no time, or two: ' + l);
  assert.match(lines[0], /half from stdout, ended by stderr$/, 'the shared line was split or double-stamped');
  assert.match(lines[1], /a log line$/);
  assert.match(lines[2], /an error line$/);
});

test('#4199 endsMidLine: a file truncated to empty after the board opened it is never "mid-line" (the read-count guard for a race between the two looks is defensive and not reproducible here)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const file = path.join(dir, 'board.log');
  fs.writeFileSync(file, 'x');
  const fd = fs.openSync(file, 'a');
  try {
    fs.truncateSync(file, 0);   // truncated after the board opened it
    assert.equal(logstamp.endsMidLine(fd, [file]), false, 'an empty file was read as mid-line (a spurious blank line)');
  } finally { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#4199 server.js looks for board.log where install/kosmos puts it (../logs/board.log from the app)', () => {
  const kosmos = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  assert.match(kosmos, /^APP="\$KOSMOS_HOME\/app\/server\.js"$/m, 'install/kosmos no longer puts server.js at $KOSMOS_HOME/app');
  assert.match(kosmos, /^LOG_DIR="\$KOSMOS_HOME\/logs"$/m, 'install/kosmos no longer puts logs at $KOSMOS_HOME/logs');
  assert.match(kosmos, /^BOARD_LOG="\$LOG_DIR\/board\.log"$/m, 'install/kosmos renamed board.log');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const logPaths = \[path\.join\(__dirname, '\.\.', 'logs', 'board\.log'\)\];/, 'server.js does not look at ../logs/board.log');
});
