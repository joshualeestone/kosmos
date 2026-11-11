'use strict';
/*
 * kosmos#8269: `kosmos feedback write --unchanged` refused with "no earlier report of yours" although `feedback show`
 * printed a report. Baron could not reproduce a chain defect (the chain works); the board's daily ask passes to the next
 * agent when one is busy (engine/feedbacknudge.js), so a quiet stretch can ask an agent whose last report is not on this
 * computer, while the reports it can see are another agent's. --unchanged still points back only to the writer's own
 * report (#7886 item 6: "my report" must be true), and the refusal now says the newest report here is another agent's.
 *
 * Mac: the real CLI and the real engine against a throwaway data folder (the cli.feedback-unchanged-7886 harness).
 * Windows: the CLI's write path against an engine stub.
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
const OLDER = '2019-05-06';
const fbDir = (data) => path.join(data, 'Kosmos', 'feedback');
const OTHERS = /the newest report here, of (\d{4}-\d{2}-\d{2}), is another agent's, and --unchanged points back only to your own\. Nothing was saved\./;

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fb8269-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fb8269-data-'));
  return { home, data };
}

// The writer here is the unnamed section (no token, no tmux), so a section by "otheragent" is another writer's.
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

function put(data, date, body) {
  fs.mkdirSync(fbDir(data), { recursive: true });
  fs.writeFileSync(path.join(fbDir(data), date + '.md'), '---\ndate: ' + date + '\n---\n\n' + body);
}
const other = (text) => '<!-- kosmos-feedback-from: otheragent -->\n## From otheragent\n\n' + text + '\n';
const reports = (data) => { try { return fs.readdirSync(fbDir(data)).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort(); } catch { return []; } };

test('kosmos#8269 (Mac): with only another agent\'s report here, --unchanged says whose it is and saves nothing', async () => {
  const h = makeHome();
  put(h.data, OLDER, other('an older report of theirs'));
  put(h.data, OLD, other('their report'));
  // Today's report by them is not an EARLIER report, so it is not the day named (the pointer never points at today).
  const today = require('./engine/feedback').today();
  put(h.data, today, other('their report today'));
  const r = await run(['feedback', 'write', '--unchanged'], h);
  assert.equal(r.code, 2, r.both);
  const m = r.both.match(OTHERS);
  assert.ok(m, 'the refusal does not say the report here is another agent\'s:\n' + r.both);
  assert.equal(m[1], OLD, 'the refusal named a day other than the newest earlier one');
  assert.deepEqual(reports(h.data), [OLDER + '.md', OLD + '.md', today + '.md'], 'something was saved');
  assert.equal(fs.readFileSync(path.join(fbDir(h.data), today + '.md'), 'utf8').includes('Nothing new'), false, 'their report today was changed');
});

test('kosmos#8269 (Mac): a report of your own, even older, is still pointed back to; another agent\'s newer one is not', async () => {
  const h = makeHome();
  put(h.data, OLDER, 'my own report\n');   // no marker: the unnamed section, this writer's
  put(h.data, OLD, other('their newer report'));
  const r = await run(['feedback', 'write', '--unchanged'], h);
  assert.equal(r.code, 0, r.both);
  const today = reports(h.data).filter((n) => n !== OLD + '.md' && n !== OLDER + '.md');
  assert.equal(today.length, 1, 'no report saved for today: ' + JSON.stringify(reports(h.data)));
  const body = fs.readFileSync(path.join(fbDir(h.data), today[0]), 'utf8');
  assert.match(body, new RegExp('Nothing new since my report of ' + OLDER + '\\.\\n$'), JSON.stringify(body));
});

test('kosmos#8269 (Mac): with no report here at all, the refusal is the plain one and names no day', async () => {
  const h = makeHome();
  const r = await run(['feedback', 'write', '--unchanged'], h);
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /no earlier report of yours to point back to, so nothing was saved/);
  assert.doesNotMatch(r.both, OTHERS, 'a day was named with no report here');
});

test('kosmos#8269 (Windows): the refusal names another agent\'s newest day when the engine gives one', async () => {
  let u = { ok: false, why: 'none', newest: OLD };
  const engine = { feedback: { write: () => { throw new Error('nothing may be saved'); }, writer: () => null, unchanged: () => u } };
  const go = async () => {
    const err = [];
    const code = await cli.main(['feedback', 'write', '--unchanged'], { env: {}, engine, readStdin: () => { throw new Error('stdin was read'); },
      out: () => {}, err: (s) => err.push(s), fetch: async () => { throw new Error('no board call expected'); } });
    return { code, err: err.join('\n') };
  };
  const named = await go();
  assert.equal(named.code, 2);
  assert.equal((named.err.match(OTHERS) || [])[1], OLD, named.err);
  u = { ok: false, why: 'none', newest: null };
  const plain = await go();
  assert.equal(plain.code, 2);
  assert.match(plain.err, /no earlier report of yours to point back to, so nothing was saved/);
  assert.doesNotMatch(plain.err, OTHERS);
});

test('kosmos#8269: the daily ask and the Project Manager line say the report to compare with is your own', () => {
  const ask = require('./engine/feedbacknudge').nudgeText();
  assert.match(ask, /since your own last report/);
  assert.match(ask, /another agent's report does not count/);
  const roles = fs.readFileSync(path.join(__dirname, 'engine', 'roles.js'), 'utf8');
  assert.match(roles, /since your own last report/);
});
