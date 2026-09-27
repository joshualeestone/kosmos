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
    assert.equal(logstamp.install(s, fd, () => new Date(0)), true);
    assert.equal(logstamp.install(s, fd, () => new Date(0)), false, 'installed twice (lines would get two times)');
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
  assert.match(src.slice(0, at + 300), /if \(require\.main === module\) \{\s*const logstamp = require\('\.\/engine\/logstamp'\);\s*logstamp\.install\(process\.stdout, 1\);\s*logstamp\.install\(process\.stderr, 2\);/);
});
