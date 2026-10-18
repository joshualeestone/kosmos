'use strict';
/**
 * kosmos#6406 step 2: openTicket asks the tunnel for a ticket that opens another of this account's computers in this
 * app window with no sign-in. Every tunnel call goes to a FAKE binary through AGENT_WORKFORCE_TUNNEL_BIN; nothing
 * reaches a network.
 *  - it runs `open-ticket --state-dir <dir> --to https://<address>`, local only (no --coordinator);
 *  - it hands back only a ticket of the tunnel's shape (base64url), and refuses anything else;
 *  - a tunnel from before open-ticket says so in words; before the sign-up is finished nothing is spawned.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openticket-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const DATA_ROOT = require('./store').ROOT;
const FAKE_BIN = nodePath.join(SANDBOX, 'fake-kosmos-tunnel');
const RECORD = nodePath.join(SANDBOX, 'fake-record.jsonl');
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;
process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';

/* The fake prints what kosmos-relay's `open-ticket` prints (main.rs: {"ticket": "<base64url>"}); FAKE_TICKET picks
   another answer. */
fs.writeFileSync(FAKE_BIN, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(args) + '\\n');
const mode = process.env.FAKE_TICKET || '';
if (args[0] === 'open-ticket') {
  if (mode === 'old') { process.stderr.write("error: unrecognized subcommand 'open-ticket'\\n"); process.exit(2); }
  if (mode === 'odd') { console.log(JSON.stringify({ ticket: 'not a ticket <b>' })); process.exit(0); }
  if (mode === 'none') { console.log(JSON.stringify({})); process.exit(0); }
  console.log(JSON.stringify({ ticket: 'eyJ2IjoxLCJ0byI6Imh0dHBzOi8vdG1udC5rb3Ntb3NwbHVzLmNvbSJ9' }));
  process.exit(0);
}
process.stderr.write('fake: unexpected ' + args.join(' ') + '\\n');
process.exit(9);
`, { mode: 0o755 });

const remote = require('./remote');

function enrol() {
  const dir = nodePath.join(DATA_ROOT, 'remote');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(dir, f), 'fake');
  return dir;
}
function unenrol() { fs.rmSync(nodePath.join(DATA_ROOT, 'remote'), { recursive: true, force: true }); }
function recorded() {
  try { return fs.readFileSync(RECORD, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
}
test.beforeEach(() => { fs.rmSync(RECORD, { force: true }); delete process.env.FAKE_TICKET; });
test.afterEach(() => { remote.resetForTests(); unenrol(); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#6406: openTicket runs open-ticket locally for the other computer and hands back its ticket', async () => {
  const dir = enrol();
  const got = await remote.openTicket('tmnt.kosmosplus.com');
  assert.deepEqual(got, { ok: true, because: null, data: { ticket: 'eyJ2IjoxLCJ0byI6Imh0dHBzOi8vdG1udC5rb3Ntb3NwbHVzLmNvbSJ9' } });
  const call = recorded().find((a) => a[0] === 'open-ticket');
  assert.ok(call, JSON.stringify(recorded()));
  assert.equal(call[call.indexOf('--to') + 1], 'https://tmnt.kosmosplus.com');
  assert.equal(call[call.indexOf('--state-dir') + 1], dir);
  assert.ok(!call.includes('--coordinator'), 'a ticket is made here, with no call to Kosmos+');
});

test('#6406: only a ticket of the tunnel\'s shape is handed back', async () => {
  enrol();
  for (const mode of ['odd', 'none']) {
    process.env.FAKE_TICKET = mode;
    assert.deepEqual(await remote.openTicket('tmnt.kosmosplus.com'), { ok: false, because: 'that did not go through' }, mode);
  }
});

test('#6406: a tunnel from before open-ticket says so; before the sign-up nothing is spawned', async () => {
  enrol();
  process.env.FAKE_TICKET = 'old';
  assert.equal((await remote.openTicket('tmnt.kosmosplus.com')).because, 'this version of Kosmos cannot open another computer directly yet');
  unenrol();
  fs.rmSync(RECORD, { force: true });
  assert.deepEqual(await remote.openTicket('tmnt.kosmosplus.com'), { ok: false, because: 'finish the Plus sign-up first' });
  assert.equal(recorded().length, 0);
});
