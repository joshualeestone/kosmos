'use strict';
/*
 * kosmos#8844: `kosmos feedback write --unchanged` with its one new line on stdin. The daily nudge says to "add a line
 * after it if there is one new thing", an agent piped that line in, and the command saved the bare pointer and said the
 * report was saved: the line was never read. Measured on installed 0.8.12 (build c20e54b8f6) before this change: a note
 * on stdin saved exactly what no stdin saved, while the same note as words was kept.
 *
 * Now, with no words, --unchanged reads its line from stdin (a terminal is not read), ending when the input ends or has
 * been quiet for 3 seconds, so an open pipe nobody writes to cannot hang it. Refused before anything is saved: a line that
 * stops without ending, more than one line, more than 64 KB, and (Windows) a PowerShell pipeline. A stdin that cannot be
 * read at all is nothing piped, as before. Words, when given, are the line and stdin is not read, as for a plain write.
 *
 * Mac: the real CLI and the real engine against a throwaway data folder (the cli.feedback-unchanged-7886 harness),
 * sending to a dead loopback. Windows: the CLI's write path against an engine stub.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const cli = require('./tools/windows/kosmos-cli');

const CLI = path.join(__dirname, 'install', 'kosmos');
const OLD = '2020-01-02';
const fbDir = (data) => path.join(data, 'Kosmos', 'feedback');

function makeHome({ earlier = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbstdin-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbstdin-data-'));
  if (earlier) {
    fs.mkdirSync(fbDir(data), { recursive: true });
    fs.writeFileSync(path.join(fbDir(data), OLD + '.md'), '---\ndate: ' + OLD + '\n---\n\nthe earlier report\n');
  }
  return { home, data };
}

/* stdin: a string is written and the pipe closed; { partial } is written and the pipe left OPEN; { open: true } writes
   nothing and leaves the pipe open. The pipe is closed after the CLI exits, so an open case can never leak. */
function run(args, { home, data }, stdin) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const started = Date.now();
    const child = spawn('bash', [CLI, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let both = '';
    child.stdout.on('data', (d) => { both += d; });
    child.stderr.on('data', (d) => { both += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      clearTimeout(killer);
      try { child.stdin.destroy(); } catch {}
      const res = { code: exitCode, both, ms: Date.now() - started };
      if (typeof res.code !== 'number') { reject(new Error('the CLI gave no exit code (' + signal + ') after ' + res.ms + ' ms: it hung')); return; }
      resolve(res);
    });
    child.stdin.on('error', () => {});
    if (typeof stdin === 'string') child.stdin.end(stdin);
    else if (stdin && typeof stdin.partial === 'string') child.stdin.write(stdin.partial);
    else if (!(stdin && stdin.open)) child.stdin.end();
  });
}

const todays = (data) => { try { return fs.readdirSync(fbDir(data)).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n) && n !== OLD + '.md'); } catch { return []; } };
const savedBody = (data) => {
  const t = todays(data);
  assert.equal(t.length, 1, 'expected one report for today, found ' + JSON.stringify(t));
  return fs.readFileSync(path.join(fbDir(data), t[0]), 'utf8');
};

test('kosmos#8844 (Mac): a line on stdin after --unchanged is saved with the pointer', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h, 'one new thing on stdin\n');
  assert.equal(r.code, 0, r.both);
  // Anchored on the whole stored text after the front matter (as the #7886 tests are).
  assert.match(savedBody(h.data), new RegExp('\\n---\\nNothing new since my report of ' + OLD + ', except: one new thing on stdin\\n$'));
});

test('kosmos#8844 (Mac): CONTROL, --unchanged with nothing piped saves the pointer alone', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h, '');
  assert.equal(r.code, 0, r.both);
  assert.match(savedBody(h.data), new RegExp('\\n---\\nNothing new since my report of ' + OLD + '\\.\\n$'));
});

test('kosmos#8844 (Mac): words are the line and stdin is not read, as for a plain write', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged', 'the', 'words'], h, 'piped text\n');
  assert.equal(r.code, 0, r.both);
  const body = savedBody(h.data);
  assert.match(body, /, except: the words\n$/);
  assert.doesNotMatch(body, /piped text/);
});

test('kosmos#8844 (Mac): an open pipe nobody writes to does not hang a plain --unchanged', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h, { open: true });
  assert.equal(r.code, 0, r.both);
  assert.match(savedBody(h.data), new RegExp('Nothing new since my report of ' + OLD + '\\.\\n$'));
  assert.ok(r.ms < 15000, 'took ' + r.ms + ' ms');
});

test('kosmos#8844 (Mac): a line that stops without ending is refused and nothing is saved', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h, { partial: 'half a li' });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was saved: the line piped in after --unchanged stopped arriving/);
  assert.deepEqual(todays(h.data), [], 'a report was saved from a line that may be cut short');
});

test('kosmos#8844 (Mac): a piped line with no earlier report still refuses and saves nothing', async () => {
  const h = makeHome({ earlier: false });
  const r = await run(['feedback', 'write', '--unchanged'], h, 'one new thing\n');
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /no earlier report of yours to point back to, so nothing was saved/);
  assert.deepEqual(todays(h.data), []);
});

test('kosmos#8844 (Windows): the piped line is added, a cut line is refused, and words are not joined by stdin', async () => {
  const written = [];
  const notes = [];
  const engine = { feedback: { write: (b) => { written.push(b); return { ok: true }; }, writer: () => null,
    unchanged: (from, note) => { notes.push(note); return { ok: true, since: OLD, day: '2026-11-03', body: 'Nothing new since my report of ' + OLD + (note ? ', except: ' + note : '.') }; } } };
  let reads = 0;
  const go = async (argv, piped) => {
    const err = [];
    const code = await cli.main(argv, { env: {}, engine, readStdin: async () => { reads += 1; return piped; },
      out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call'); } });
    return { code, err: err.join('\n') };
  };
  assert.equal((await go(['feedback', 'write', '--unchanged'], { text: 'one new thing\n', ended: true })).code, 0);
  assert.deepEqual(written, ['Nothing new since my report of ' + OLD + ', except: one new thing']);
  // CONTROL: nothing piped is the pointer alone.
  assert.equal((await go(['feedback', 'write', '--unchanged'], { text: '', ended: true })).code, 0);
  assert.equal(written[1], 'Nothing new since my report of ' + OLD + '.');
  const cut = await go(['feedback', 'write', '--unchanged'], { text: 'half a li', ended: false });
  assert.equal(cut.code, 2);
  assert.match(cut.err, /Nothing was saved: the line piped in after --unchanged stopped arriving/);
  assert.equal(written.length, 2, 'a cut line was saved');
  const before = reads;
  assert.equal((await go(['feedback', 'write', '--unchanged', 'the', 'words'], { text: 'piped\n', ended: true })).code, 0);
  assert.equal(reads, before, 'stdin was read although words were given');
  assert.equal(written[2], 'Nothing new since my report of ' + OLD + ', except: the words');
});

test('kosmos#8844 (Mac): more than one line piped in is refused and nothing is saved', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h, 'first line\nsecond line\n');
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was saved: --unchanged takes one short line, and more than that was piped in/);
  assert.deepEqual(todays(h.data), [], 'a many-line pipe was saved as the note');
});

test('kosmos#8844 (Windows): more than one line is refused, and a PowerShell pipeline is refused with the words form, no file', async () => {
  const written = [];
  const engine = { feedback: { write: (b) => { written.push(b); return { ok: true }; }, writer: () => null,
    unchanged: (from, note) => ({ ok: true, since: OLD, day: '2026-11-03', body: 'Nothing new since my report of ' + OLD + (note ? ', except: ' + note : '.') }) } };
  const go = async (argv, piped) => {
    const err = [];
    const code = await cli.main(argv, { env: {}, engine, readStdin: async () => piped,
      out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call'); } });
    return { code, err: err.join('\n') };
  };
  const many = await go(['feedback', 'write', '--unchanged'], { text: 'first line\r\nsecond line\r\n', ended: true });
  assert.equal(many.code, 2);
  assert.match(many.err, /Nothing was saved: --unchanged takes one short line, and more than that was piped in/);
  assert.deepEqual(written, []);
  // The PowerShell launcher passes the words in a file and says a pipeline was used (kosmos.ps1).
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbstdin-argv-')), 'argv.json');
  fs.writeFileSync(f, JSON.stringify(['feedback', 'write', '--unchanged']));
  const ps = await go([cli.ARGV_FILE_FLAG, f, '--kosmos-ps-pipeline'], { text: 'never read', ended: true });
  assert.equal(ps.code, 2, ps.err);
  assert.match(ps.err, /text piped into kosmos in PowerShell does not reach it\. Give the one new thing as words instead: kosmos feedback write --unchanged 'the one new thing'/);
  assert.doesNotMatch(ps.err, /file/, 'the refusal sends the person to a file, which --unchanged refuses');
  assert.deepEqual(written, []);
  // CONTROL: the same launcher path without the pipeline flag saves the pointer, so the refusal above is the flag's.
  fs.writeFileSync(f, JSON.stringify(['feedback', 'write', '--unchanged']));
  assert.equal((await go([cli.ARGV_FILE_FLAG, f], { text: '', ended: true })).code, 0);
  assert.deepEqual(written, ['Nothing new since my report of ' + OLD + '.']);
});

test('kosmos#8844 (Mac): a piped line over 64 KB is refused unsaved', async () => {
  const h = makeHome();
  const big = await run(['feedback', 'write', '--unchanged'], h, 'x'.repeat(65537) + '\n');
  assert.equal(big.code, 2, big.both);
  assert.match(big.both, /Nothing was saved: --unchanged takes one short line, and more than that was piped in/);
  assert.deepEqual(todays(h.data), []);
  // CONTROL: exactly 64 KB, one line, is still saved, so the cap is where it says.
  const at = await run(['feedback', 'write', '--unchanged'], h, 'y'.repeat(65536));
  assert.equal(at.code, 0, at.both);
  assert.match(savedBody(h.data), /, except: y{65536}\n$/);
});

test('kosmos#8844 (Windows): a piped line over the cap is refused unsaved', async () => {
  const written = [];
  const engine = { feedback: { write: (b) => { written.push(b); return { ok: true }; }, writer: () => null,
    unchanged: (from, note) => ({ ok: true, since: OLD, day: '2026-11-03', body: 'x' + note }) } };
  let cap = null;
  const err = [];
  const code = await cli.main(['feedback', 'write', '--unchanged'], { env: {}, engine,
    readStdin: async (quietMs, maxBytes) => { cap = maxBytes; return { text: '', ended: false, overflow: true }; },
    out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call'); } });
  assert.equal(code, 2);
  assert.equal(cap, 65536, 'the reader was not given the cap');
  assert.match(err.join('\n'), /Nothing was saved: --unchanged takes one short line, and more than that was piped in/);
  assert.deepEqual(written, []);
});

test('kosmos#8844 (Mac): a stdin that cannot be read (write-only) is nothing piped, as before: the pointer alone is saved', async () => {
  const h = makeHome();
  const env = { ...process.env, KOSMOS_HOME: h.home, AGENT_WORKFORCE_DATA: h.data, KOSMOS_PORT: '9',
    AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
  const fd = fs.openSync(path.join(h.data, 'write-only'), 'w');   // node's process.stdin errors on it (EBADF)
  const r = await new Promise((resolve, reject) => {
    const child = spawn('bash', [CLI, 'feedback', 'write', '--unchanged'], { env, stdio: [fd, 'pipe', 'pipe'] });
    let both = '';
    child.stdout.on('data', (d) => { both += d; });
    child.stderr.on('data', (d) => { both += d; });
    child.on('error', reject);
    child.on('close', (exitCode) => { const res = { code: exitCode, both }; if (typeof res.code !== 'number') { reject(new Error('no exit code')); return; } resolve(res); });
  });
  fs.closeSync(fd);
  assert.equal(r.code, 0, r.both);
  assert.doesNotMatch(r.both, /could not be read/);
  assert.match(savedBody(h.data), new RegExp('\\n---\\nNothing new since my report of ' + OLD + '\\.\\n$'));
});
