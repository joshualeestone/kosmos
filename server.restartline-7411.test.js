'use strict';
/* kosmos#7411 step 4: the restart line's routes, and the start-up call that records the version and its first start.
   engine/restartline-7411.test.js covers the rule; this covers the wiring the page depends on. */
require('./test-support/tmpscope');   // first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartline-' + p + '-'));
process.env.HOME = tmp('home');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = tmp('data');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('proj');
process.env.AGENT_WORKFORCE_WORKERS = tmp('work');
process.env.AGENT_WORKFORCE_LAUNCH = tmp('launch');

const { version } = require('./package.json');
const rl = require('./engine/restartline');
const st = require('./engine/status');
const notes = require('./engine/releasenotes');
const fleet = require('./test-support/fleet');
const store = require('./engine/store');
const RECORD = path.join(store.ROOT, 'version-start.json');

// An update a minute ago, from the version before this one.
const AT = Date.now() - 60000;
fs.mkdirSync(path.dirname(RECORD), { recursive: true });
fs.writeFileSync(RECORD, JSON.stringify({ version, previous: '0.0.1', at: AT }));

/* The roster through the real producers (test-support/fleet), and the session starts through status's own seam, as
   tmux's list-sessions answers (seconds). Only the notes are replaced: the repo's pool marks no fix yet. */
const sessions = (pairs) => pairs.map(([s, ms]) => s + '\t' + Math.floor(ms / 1000)).join('\n');
let sessionText = '';
st.setSessionSource(() => sessionText);
notes.readNotes = () => ({ version, notes: [{ version, title: 'Hooks fix', line: 'x', restart: 'agents' }] });

const { start, server } = require('./server');

test('#7411: start keeps this version\'s first start; the line names running agents on old sessions; Not now hides it', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const line = async () => (await (await fetch(`${base}/api/restart-line`)).json()).line;

  assert.equal(rl.read().at, AT, 'starting the board again on the same version moved its first start');

  const world = fleet.install([
    fleet.agent('claudebot'),         // named by its name (readIdentity: Splinter)
    fleet.agent('fresh'),             // started after the update
    fleet.stranger('stranger'),       // not one of ours
    fleet.agent('unread'),            // its start could not be read
  ]);
  t.after(() => world.restore());
  sessionText = sessions([['claudebot-discord', AT - 3600000], ['fresh-discord', AT + 30000], ['stranger', AT - 3600000]]);
  assert.deepEqual(await line(), {
    version,
    notes: [{ version, title: 'Hooks fix' }],
    agents: [{ name: 'claudebot', label: 'Splinter' }],
  });

  // tmux could not be read: no line, never a guessed one.
  st.setSessionSource(() => null);
  assert.equal(await line(), null);
  st.setSessionSource(() => sessionText);
  // CONTROL for the arm above: the same world read again names Splinter, so null there was the unread tmux.
  assert.equal((await line()).agents.length, 1);

  const stale = await fetch(`${base}/api/restart-line/not-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: '0.0.1' }) });
  assert.equal(stale.status, 409, 'an old page hid the line for a newer update');
  await stale.text();
  assert.equal((await fetch(`${base}/api/restart-line/not-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);

  const ok = await fetch(`${base}/api/restart-line/not-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { hidden: true });
  assert.equal(await line(), null, 'the line was served after Not now');
});
