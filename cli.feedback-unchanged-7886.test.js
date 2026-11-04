'use strict';
/*
 * kosmos#7886 item 6: `kosmos feedback write --unchanged [text]`. On a stretch where nothing changed, the honest report
 * repeated yesterday's. --unchanged points back to the writer's own latest earlier report by its date instead, with any
 * words added; with no earlier report it refuses and saves nothing.
 *
 * Mac: the real CLI and the real engine against a throwaway data folder (the cli.feedback-2037 harness), sending to a
 * dead loopback. Windows: the CLI's write path against an engine stub.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const cli = require('./tools/windows/kosmos-cli');

const CLI = path.join(__dirname, 'install', 'kosmos');
const OLD = '2020-01-02';
// The engine's store lives under <AGENT_WORKFORCE_DATA>/Kosmos (engine/store.js ROOT), so the reports are there.
const fbDir = (data) => path.join(data, 'Kosmos', 'feedback');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbunch-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbunch-data-'));
  return { home, data };
}

function run(args, { home, data }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    execFile('bash', [CLI, ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, both: `${stdout}${stderr}` });
    });
  });
}

const reports = (data) => { try { return fs.readdirSync(fbDir(data)).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort(); } catch { return []; } };

test('kosmos#7886 item 6 (Mac): --unchanged with no earlier report refuses and saves nothing', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h);
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /no earlier report of yours to point back to, so nothing was saved/);
  assert.deepEqual(reports(h.data), [], 'a report was saved that points back to nothing');
  // CONTROL: this helper sees a report the CLI saves, so the empty list above is a real absence.
  const plain = await run(['feedback', 'write', 'an ordinary report'], h);
  assert.equal(plain.code, 0, plain.both);
  assert.equal(reports(h.data).length, 1, 'the control write was not seen where the test looks');
});

test('kosmos#7886 item 6 (Mac): --unchanged points back to the last earlier report, with any words added', async () => {
  const h = makeHome();
  fs.mkdirSync(fbDir(h.data), { recursive: true });
  fs.writeFileSync(path.join(fbDir(h.data), OLD + '.md'), '---\ndate: ' + OLD + '\n---\n\nthe earlier report\n');
  const r = await run(['feedback', 'write', '--unchanged', 'one', 'new', 'thing'], h);
  assert.equal(r.code, 0, r.both);
  const today = reports(h.data).filter((n) => n !== OLD + '.md');
  assert.equal(today.length, 1, 'no report saved for today: ' + JSON.stringify(reports(h.data)));
  const body = fs.readFileSync(path.join(fbDir(h.data), today[0]), 'utf8');
  // Anchored on the whole stored text after the front matter, so a leaked first line (the day) would turn it red.
  assert.match(body, new RegExp('\\n---\\nNothing new since my report of ' + OLD + ', except: one new thing\\n$'), JSON.stringify(body));
  assert.doesNotMatch(body, /the earlier report/, 'the earlier report was copied instead of pointed to');
  // CONTROL: the plain write path is untouched (the same harness saves ordinary words).
  const plain = await run(['feedback', 'write', 'an ordinary report'], h);
  assert.equal(plain.code, 0, plain.both);
});

test('kosmos#7886 item 6 (Mac): --unchanged does not take --body-file', async () => {
  const h = makeHome();
  const f = path.join(h.data, 'body.txt');
  fs.writeFileSync(f, 'x');
  const r = await run(['feedback', 'write', '--unchanged', '--body-file', f], h);
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /--unchanged takes a short line, not --body-file/);
});

test('kosmos#7886 item 6 (Windows): --unchanged writes the engine\'s pointer, and refuses when there is none', async () => {
  const written = [];
  let earlier = true;
  const engine = {
    feedback: {
      write: (b) => { written.push(b); return { ok: true }; },
      writer: () => null,
      unchanged: (from, note) => (earlier ? { ok: true, since: OLD, body: 'Nothing new since my report of ' + OLD + (note ? ', except: ' + note : '.') } : { ok: false }),
    },
  };
  const go = async (argv) => {
    const err = [];
    const code = await cli.main(argv, { env: {}, engine, readStdin: () => { throw new Error('stdin was read on --unchanged'); },
      out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call expected'); } });
    return { code, err: err.join('\n') };
  };
  assert.equal((await go(['feedback', 'write', '--unchanged', 'one', 'thing'])).code, 0);
  assert.equal((await go(['feedback', 'write', '--unchanged'])).code, 0);
  assert.deepEqual(written, ['Nothing new since my report of ' + OLD + ', except: one thing', 'Nothing new since my report of ' + OLD + '.']);
  earlier = false;
  const none = await go(['feedback', 'write', '--unchanged']);
  assert.equal(none.code, 2);
  assert.match(none.err, /no earlier report of yours to point back to, so nothing was saved/);
  assert.equal(written.length, 2, 'a report was saved with nothing to point back to');
});

test('kosmos#7886 item 6: the daily nudge teaches --unchanged', () => {
  assert.match(require('./engine/feedbacknudge').nudgeText(), /kosmos feedback write --unchanged/);
});

test('kosmos#7886 item 6 (Mac): --unchanged is taken after the words too, and refuses over a report saved today', async () => {
  const h = makeHome();
  fs.mkdirSync(fbDir(h.data), { recursive: true });
  fs.writeFileSync(path.join(fbDir(h.data), OLD + '.md'), '---\ndate: ' + OLD + '\n---\n\nthe earlier report\n');
  const later = await run(['feedback', 'write', 'one', 'thing', '--unchanged'], h);
  assert.equal(later.code, 0, later.both);
  const again = await run(['feedback', 'write', '--unchanged'], h);
  assert.equal(again.code, 2, again.both);
  assert.match(again.both, /You already saved a report today, so nothing was changed/);
  const today = reports(h.data).filter((n) => n !== OLD + '.md');
  assert.match(fs.readFileSync(path.join(fbDir(h.data), today[0]), 'utf8'), /\n---\nNothing new since my report of 2020-01-02, except: one thing\n$/, 'the first --unchanged report was replaced');
});

test('kosmos#7886 item 6 (Windows): --unchanged after the words, saved under the day checked, and the today refusal', async () => {
  const written = [];
  const dates = [];
  let why = null;
  const engine = { feedback: { write: (b, o) => { written.push(b); dates.push(o && o.date); return { ok: true }; }, writer: () => null,
    unchanged: (from, note) => (why ? { ok: false, why } : { ok: true, since: OLD, day: '2026-11-03', body: 'Nothing new since my report of ' + OLD + (note ? ', except: ' + note : '.') }) } };
  const go = async (argv) => {
    const err = [];
    const code = await cli.main(argv, { env: {}, engine, readStdin: () => { throw new Error('stdin was read on --unchanged'); }, out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call'); } });
    return { code, err: err.join('\n') };
  };
  assert.equal((await go(['feedback', 'write', 'one', 'thing', '--unchanged'])).code, 0);
  assert.deepEqual(written, ['Nothing new since my report of ' + OLD + ', except: one thing']);
  assert.deepEqual(dates, ['2026-11-03'], 'not saved under the day the engine checked');
  why = 'today';
  const t = await go(['feedback', 'write', '--unchanged']);
  assert.equal(t.code, 2);
  assert.match(t.err, /You already saved a report today, so nothing was changed/);
  assert.equal(written.length, 1);
});

test('kosmos#7886 item 6: after a bare --, --unchanged is a word of the report on both CLIs, and a read failure shows no raw error', async () => {
  const h = makeHome();
  const mac = await run(['feedback', 'write', '--', 'said', '--unchanged', 'as', 'words'], h);
  assert.equal(mac.code, 0, mac.both);
  const saved = reports(h.data);
  assert.equal(saved.length, 1);
  assert.match(fs.readFileSync(path.join(fbDir(h.data), saved[0]), 'utf8'), /said --unchanged as words/);
  const written = [];
  const engine = { feedback: { write: (b) => { written.push(b); return { ok: true }; }, writer: () => null,
    unchanged: () => { throw new Error('EACCES: permission denied, open /Users/someone/secret/feedback/2020-01-02.md'); } } };
  const go = async (argv) => {
    const err = [];
    const code = await cli.main(argv, { env: {}, engine, readStdin: () => { throw new Error('stdin read'); }, out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call'); } });
    return { code, err: err.join('\n') };
  };
  assert.equal((await go(['feedback', 'write', '--', 'said', '--unchanged'])).code, 0);
  assert.deepEqual(written, ['said --unchanged']);
  const bad = await go(['feedback', 'write', '--unchanged']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /We could not read your earlier reports, so nothing was saved\./);
  assert.doesNotMatch(bad.err, /Users|EACCES/, 'the raw error reached the person');
});
