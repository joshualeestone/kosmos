'use strict';
/* kosmos#8919: the Windows `kosmos feedback write` says when it replaced notes, as install/kosmos does
   (cli.feedback-writenotes-8919.test.js). The harness is tools.windows-kosmos-cli-feedback-note-8896's. */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const CLI_FILE = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js');
function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-fbwn-'));
  const env = Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: root, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
    KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' });
  delete env.KOSMOS_WORLD;
  return (args) => {
    const r = cp.spawnSync(process.execPath, [CLI_FILE, ...args], { env, input: '', encoding: 'utf8', timeout: 60000 });
    return { code: r.status, out: String(r.stdout).replace(/\r?\n$/, ''), err: String(r.stderr).replace(/\r?\n$/, '') };
  };
}
test('a write after a note says the note went with the old report; CONTROL: a write with no note says nothing of it', () => {
  const cli = home();
  const first = cli(['feedback', 'write', 'first']);
  assert.equal(first.code, 0, first.err);
  assert.doesNotMatch(first.out, /replaced your earlier report/);
  assert.equal(cli(['feedback', 'note', 'a later line']).code, 0);
  const again = cli(['feedback', 'write', 'rewritten']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /This replaced your earlier report for that day, and with it the note added to it later\. If it still applies, add it again with kosmos feedback note\.$/, again.out);
  assert.doesNotMatch(cli(['feedback', 'write', 'third']).out, /replaced your earlier report/, 'CONTROL');
});
