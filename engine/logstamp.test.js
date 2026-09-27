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

test('#4199 server.js installs the stamp first, for stdout and stderr, only when it runs as the board', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("require('./engine/logstamp')");
  assert.ok(at > 0, 'server.js does not install logstamp');
  assert.ok(src.indexOf('require(', 0) >= at || src.slice(0, at).indexOf("require('") === -1, 'something is required (and could write) before the stamp is installed');
  const block = src.slice(src.lastIndexOf('if (require.main === module)', at), at + 600);
  assert.ok(block.startsWith('if (require.main === module)'), 'the stamp is not inside the board-only guard');
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

test('#4199 install: a UTF-8 character split across two Buffer writes stays whole', () => {
  const f = fileStream();
  try {
    logstamp.install(f.s, f.fd, { now: () => new Date(0) });
    const bytes = Buffer.from('é\n');   // c3 a9 0a
    f.s.write(bytes.subarray(0, 1)); f.s.write(bytes.subarray(1));
    assert.equal(f.out.map((x) => x[0]).join(''), '1970-01-01T00:00:00.000Z é\n', 'the character came out broken');
  } finally { f.done(); }
});

test('#4199 install: a string in another encoding goes through untouched', () => {
  const f = fileStream();
  try {
    logstamp.install(f.s, f.fd, { now: () => new Date(0) });
    f.s.write('68690a', 'hex');
    assert.deepEqual(f.out, [['68690a', 'hex']], 'a hex write was stamped or re-encoded');
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

test('#4199 bytes of a character still waiting when the board exits reach the file, not dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logstamp-4199-'));
  const file = path.join(dir, 'board.log');
  const fd = fs.openSync(file, 'a');
  const script = "require(" + JSON.stringify(path.join(__dirname, 'logstamp.js')) + ").install(process.stdout, 1);"
    + "process.stdout.write('line\\n'); process.stdout.write(Buffer.from([0xc3]));";
  try {
    const r = spawnSync(process.execPath, ['-e', script], { stdio: ['ignore', fd, 'inherit'] });
    assert.equal(r.status, 0);
  } finally { fs.closeSync(fd); }
  const bytes = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(bytes.length > 0 && bytes.toString('utf8').includes('line\n'), 'setup: the line was not written');
  assert.notEqual(bytes.toString('utf8').replace(/^.* line\n/, ''), '', 'the waiting byte was dropped at exit');
});
