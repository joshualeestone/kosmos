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

// An update a minute ago, from the version before this one.
const AT = Date.now() - 60000;
fs.mkdirSync(path.dirname(rl._file()), { recursive: true });
fs.writeFileSync(rl._file(), JSON.stringify({ version, previous: '0.0.1', at: AT }));

// The roster, the session starts and the notes, as the board would read them. server.js calls each through its module
// object, so replacing them here is what the route reads.
let roster = [];
let starts = new Map();
st.paneRosterAsync = async () => roster;
st.sessionStartsAsync = async () => starts;
notes.readNotes = () => ({ version, notes: [{ version, title: 'Hooks fix', line: 'x', restart: 'agents' }] });

const { start, server } = require('./server');

test('#7411: start keeps this version\'s first start; the line names running agents on old sessions; Not now hides it', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const line = async () => (await (await fetch(`${base}/api/restart-line`)).json()).line;

  assert.equal(rl.read().at, AT, 'starting the board again on the same version moved its first start');

  const card = (name, session, extra = {}) => ({ sessionName: name, session, isNamedOurs: true, ...extra });
  roster = [
    card('claudebot', 'claudebot-discord'),                              // named by its name (readIdentity: Splinter)
    card('fresh', 'fresh-discord'),                                      // started after the update
    card('paused', 'paused-discord', { swarm: { active: false } }),      // not running
    { sessionName: 'stranger', session: 'stranger', isNamedOurs: false },   // not one of ours
    card('unread', 'unread-discord'),                                    // its start could not be read
  ];
  starts = new Map([['claudebot-discord', AT - 3600000], ['fresh-discord', AT + 30000], ['paused-discord', AT - 3600000], ['stranger', AT - 3600000]]);
  assert.deepEqual(await line(), {
    version,
    notes: [{ version, title: 'Hooks fix' }],
    agents: [{ name: 'claudebot', label: 'Splinter' }],
  });

  // tmux could not be read: no line, never a guessed one.
  starts = null;
  assert.equal(await line(), null);
  starts = new Map([['claudebot-discord', AT - 3600000]]);

  const stale = await fetch(`${base}/api/restart-line/not-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: '0.0.1' }) });
  assert.equal(stale.status, 409, 'an old page hid the line for a newer update');
  await stale.text();
  assert.equal((await fetch(`${base}/api/restart-line/not-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);

  const ok = await fetch(`${base}/api/restart-line/not-now`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { hidden: true });
  assert.equal(await line(), null, 'the line was served after Not now');
});
