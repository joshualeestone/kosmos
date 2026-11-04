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
  assert.match(body, new RegExp('Nothing new since my report of ' + OLD + '\\. one new thing'));
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
      unchanged: (from, note) => (earlier ? { ok: true, since: OLD, body: 'Nothing new since my report of ' + OLD + '.' + (note ? ' ' + note : '') } : { ok: false }),
    },
  };
  const go = async (argv) => {
    const err = [];
    const code = await cli.main(argv, { env: {}, engine, readStdin: () => ({ text: 'stdin must not be read', ended: true }),
      out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call expected'); } });
    return { code, err: err.join('\n') };
  };
  assert.equal((await go(['feedback', 'write', '--unchanged', 'one', 'thing'])).code, 0);
  assert.equal((await go(['feedback', 'write', '--unchanged'])).code, 0);
  assert.deepEqual(written, ['Nothing new since my report of ' + OLD + '. one thing', 'Nothing new since my report of ' + OLD + '.']);
  earlier = false;
  const none = await go(['feedback', 'write', '--unchanged']);
  assert.equal(none.code, 2);
  assert.match(none.err, /no earlier report of yours to point back to, so nothing was saved/);
  assert.equal(written.length, 2, 'a report was saved with nothing to point back to');
});

test('kosmos#7886 item 6: the daily nudge teaches --unchanged', () => {
  assert.match(require('./engine/feedbacknudge').nudgeText(), /kosmos feedback write --unchanged/);
});
