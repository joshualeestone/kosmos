'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4423 (follow-up to #4421): a recommender room note named the stuck agent and the peers it asked INSIDE its stored
 * sentence, so after a rename the room showed their old names for good. The note now keeps its facts by session
 * (engine/messages.js roomNote `rec`), and the room route re-words it with the names as they are when it is read.
 * Through the REAL room route (both the page's JSON and `kosmos room`'s text), the REAL rename route, and real
 * fleet panes. A note without facts (every other note, and any written before this) is served as it was stored.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rename-followups-4423-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.HOME = mk('home');
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const projects = require('./engine/projects');
const messages = require('./engine/messages');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

let base;
let board = null;
let room = null;
test.before(async () => {
  board = fleet.install([
    fleet.agent('stuck-a', { state: 'idle', displayName: 'Alpha' }),
    fleet.agent('peer-b', { state: 'idle', displayName: 'Bravo' }),
  ]);
  room = projects.create({ name: 'Recommender room', folder: mk('room'), agents: ['stuck-a', 'peer-b'], roster: board.agents });
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } if (board) board.restore(); });

const notes = async () => {
  const res = await fetch(`${base}/api/project/${room.id}/room`);
  assert.equal(res.status, 200);
  return ((await res.json()).rows || []).filter((m) => m && m.kind === 'note').map((m) => m.text);
};
const asText = async () => (await fetch(`${base}/api/project/${room.id}/room?as=text`)).text();

test('#4423: a recommender note names the agents as they are called when the room is read, after a rename too', async () => {
  messages.roomNote(room.id, 'Recommender: Alpha is stuck. (as written)', {
    recommender: { stuck: 'stuck-a', asked: ['peer-b'], because: 'which layout to ship' },
  });
  messages.roomNote(room.id, 'A plain note, with no facts kept.');
  const before = await notes();
  const rec = before.find((t) => /which layout to ship/.test(t));
  assert.ok(rec, 'fixture: the recommender note is not in the room: ' + JSON.stringify(before));
  assert.match(rec, /Alpha is stuck/);
  assert.match(rec, /asked Bravo for one reply/);
  assert.ok(before.includes('A plain note, with no facts kept.'), 'a note without facts was not served as stored');

  const res = await fetch(`${base}/api/agent/peer-b/profile`, {
    method: 'PUT', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ displayName: 'Bravo Renamed' }),
  });
  assert.equal(res.status, 200, 'fixture: the rename route refused');
  const after = (await notes()).find((t) => /which layout to ship/.test(t));
  assert.match(after, /asked Bravo Renamed for one reply/, 'the room kept the name the note was written with');
  assert.match(await asText(), /asked Bravo Renamed for one reply/, '`kosmos room` (the text view) kept the old name');
});

test('#4423: the note keeps only its facts in the known shape, and the sentence as written stays in the log', () => {
  messages.roomNote(room.id, 'odd', { recommender: { stuck: '', asked: 'x', because: 1 } });
  const rows = messages.record().rows.filter((m) => m.kind === 'note' && m.project === room.id);
  const odd = rows.find((m) => m.text === 'odd');
  assert.ok(odd && !('rec' in odd), 'a malformed recommender field was stored');
  const kept = rows.find((m) => m.rec);
  assert.equal(kept.text, 'Recommender: Alpha is stuck. (as written)', 'the stored sentence was changed');
  assert.deepEqual(kept.rec, { stuck: 'stuck-a', asked: ['peer-b'], because: 'which layout to ship' });
});

test('#4423: a note whose agent would show only as a bare id keeps the sentence it was written with', async () => {
  // 'ghost-z' has no record and no instructions file: readIdentity can only give back the id.
  messages.roomNote(room.id, 'Recommender: Alpha is stuck. Kosmos asked Zed for one reply each here (as written).', {
    recommender: { stuck: 'stuck-a', asked: ['ghost-z'], because: 'a question about ghosts' },
  });
  const t = (await notes()).find((x) => /ghosts|as written\)\.$/.test(x));
  assert.equal(t, 'Recommender: Alpha is stuck. Kosmos asked Zed for one reply each here (as written).',
    'the note swapped a name it was written with for the bare id');
});

test('#4423: the recommender sweep passes the note\'s facts through to messages.roomNote (the wiring)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /roomNote: \(projectId, text, opts\) => messages\.roomNote\(projectId, text, opts\)/,
    'the server drops the recommender note\'s facts, so its names can never follow a rename');
});
