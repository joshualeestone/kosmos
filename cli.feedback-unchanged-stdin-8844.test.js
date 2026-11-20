'use strict';
/*
 * kosmos#8844: `kosmos feedback write --unchanged` with its one new line on stdin. The daily nudge says to "add a line
 * after it if there is one new thing", an agent piped that line in, and the command saved the bare pointer and said the
 * report was saved: the line was never read. Measured on installed 0.8.12 (build c20e54b8f6) before this change: a note
 * on stdin saved exactly what no stdin saved, while the same note as words was kept.
 *
 * Now, with no words, --unchanged reads its line from stdin (a terminal is not read), ending when the input ends or has
 * been quiet for 3 seconds, so an open pipe nobody writes to cannot hang it. A line that stops without ending is refused
 * before anything is saved. Words, when given, are the line and stdin is not read, as for a plain write.
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
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      try { child.stdin.destroy(); } catch {}
      if (signal) { reject(new Error('the CLI was killed (' + signal + ') after ' + (Date.now() - started) + ' ms: it hung')); return; }
      resolve({ code, both, ms: Date.now() - started });
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
