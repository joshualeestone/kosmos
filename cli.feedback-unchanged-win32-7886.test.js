'use strict';
/*
 * kosmos#7886 item 6: `kosmos feedback write --unchanged` through the WINDOWS CLI's own handler and the REAL engine, on a
 * throwaway store. "win32" in the name puts it in tools/windows-tests.js, so it runs on the Windows runner as well as
 * here. The store's folder is read when the engine is first required, and sending goes to a dead loopback.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbunch-win-'));
process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'http://127.0.0.1:9/api/feedback';
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const fb = require('./engine/feedback');

const OLD = '2020-01-02';
async function go(argv) {
  const out = []; const err = [];
  const code = await cli.main(argv, { env: {}, readStdin: () => { throw new Error('stdin was read'); },
    out: (s) => out.push(s), err: (s) => err.push(s), fetch: async () => { throw new Error('no board call'); } });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const todays = () => fb.readBody(fb.today());

test('CONTROL: the engine the CLI uses writes into the throwaway store', () => {
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

test('Windows, real engine: refused with no earlier report, then points back, then refuses a different note', async () => {
  fs.rmSync(fb.dir(), { recursive: true, force: true });
  const none = await go(['feedback', 'write', '--unchanged']);
  assert.equal(none.code, 2, none.err);
  assert.match(none.err, /no earlier report of yours to point back to, so nothing was saved/);
  assert.equal(todays(), null, 'a report was saved that points back to nothing');

  fb.write('the earlier report', { from: null, date: OLD });
  const ok = await go(['feedback', 'write', 'one', 'thing', '--unchanged']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(String(todays()).trim(), 'Nothing new since my report of ' + OLD + ', except: one thing');

  const same = await go(['feedback', 'write', '--unchanged', 'one', 'thing']);
  assert.equal(same.code, 0, 'retrying the same --unchanged was refused: ' + same.err);
  const other = await go(['feedback', 'write', '--unchanged', 'something', 'else']);
  assert.equal(other.code, 2);
  assert.match(other.err, /You already saved a report today, so nothing was changed/);
  assert.equal(String(todays()).trim(), 'Nothing new since my report of ' + OLD + ', except: one thing', 'today\'s report was replaced');
});
