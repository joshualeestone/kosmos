'use strict';
/* kosmos#8919: install/kosmos `feedback write` says when it replaced notes added earlier that day. The harness is
   cli.feedback-note-8896's: an installed layout pointing at the real engine, a throwaway data folder, a dead board port
   and collector, no token or tmux window. */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const CLI = path.join(__dirname, 'install', 'kosmos');
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbwn-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  return { home, data: fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbwn-data-')) };
}
function run(args, { home, data }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const child = execFile('bash', [CLI, ...args], { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}`, both: `${stdout}${stderr}` });
    });
    child.stdin.end();
  });
}
test('a write after a note says the note went with the old report; CONTROL: a write with no note says nothing of it', async () => {
  const h = makeHome();
  const first = await run(['feedback', 'write', 'first'], h);
  assert.equal(first.code, 0, first.both);
  assert.doesNotMatch(first.out, /replaced your earlier report/, 'a first write spoke of replaced notes');
  assert.equal((await run(['feedback', 'note', 'a later line'], h)).code, 0);
  const again = await run(['feedback', 'write', 'rewritten'], h);
  assert.equal(again.code, 0, again.both);
  assert.match(again.out, /This replaced your earlier report for that day, and with it the note added to it later\. If it still applies, add it again with kosmos feedback note\./, again.out);
  assert.doesNotMatch(again.both, /SAVED/);
  const third = await run(['feedback', 'write', 'third'], h);
  assert.doesNotMatch(third.out, /replaced your earlier report/, 'CONTROL: a write with no notes since said some went');
});

test('review 1: when the send sentence cannot be made, the fallback message still carries the replaced-notes sentence', async () => {
  const h = makeHome();
  // An engine folder whose feedbacksend says nothing usable: every other file is the real one.
  fs.unlinkSync(path.join(h.home, 'app', 'engine'));
  const eng = path.join(h.home, 'app', 'engine');
  fs.mkdirSync(eng);
  for (const f of fs.readdirSync(path.join(__dirname, 'engine'))) {
    if (f !== 'feedbacksend.js') fs.symlinkSync(path.join(__dirname, 'engine', f), path.join(eng, f));
  }
  fs.writeFileSync(path.join(eng, 'feedbacksend.js'), "module.exports = { sendNow: () => Promise.resolve({ state: 'sent' }), writeMessage: () => { throw new Error('no sentence'); } };\n");
  assert.equal((await run(['feedback', 'write', 'first'], h)).code, 0);
  assert.equal((await run(['feedback', 'note', 'a later line'], h)).code, 0);
  const again = await run(['feedback', 'write', 'rewritten'], h);
  assert.equal(again.code, 0, again.both);
  assert.match(again.out, /Kosmos could not check whether it was sent\. This replaced your earlier report for that day, and with it the note added to it later\./, again.out);
  assert.doesNotMatch(again.both, /GONE/, 'the marker line leaked into what the agent reads');
});
