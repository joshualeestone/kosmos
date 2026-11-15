/**
 * kosmos#8530: a Muse Code agent's conversation is backed up: engine/backupsessions.js finds <data home>/muse/sessions/
 * <yyyy>/<mm>/<dd>/<the agent's session id>/ and takes only that folder's files. Controls: another agent's session, the
 * index of every session, the view cache, and a session folder that is a link never come back.
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bs = require('./backupsessions');

const MINE = '29f7b64b-2083-4aed-970d-03b3deed054c';
const THEIRS = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function world() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kbmuse-')));
  const agent = path.join(base, 'work', 'workers', 'mikey');
  const other = path.join(base, 'work', 'workers', 'leo');
  const data = path.join(base, '.local', 'share');
  const sessions = path.join(data, 'muse', 'sessions');
  const w = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  w(path.join(agent, '.kosmos', 'muse-session'), MINE + '\n');
  w(path.join(other, '.kosmos', 'muse-session'), THEIRS + '\n');
  // The agent's conversation, resumed on a second day; the other agent's; the index of all; the view cache.
  w(path.join(sessions, '2026', '11', '14', MINE, 'session.jsonl'), '{"m":"mikey day one"}\n');
  w(path.join(sessions, '2026', '11', '15', MINE, 'session.jsonl'), '{"m":"mikey day two"}\n');
  w(path.join(sessions, '2026', '11', '14', THEIRS, 'session.jsonl'), '{"m":"leo"}\n');
  w(path.join(sessions, '.msp-view-g12', MINE, 'journal-00000000.bin'), 'view');
  w(path.join(sessions, '2026', '11', '14', MINE, 'prompt_context.json'), '{"other":"file"}');   // review 3: not the conversation
  w(path.join(data, 'muse', 'session-index.db'), 'every session');
  return { base, agent, other, data, sessions };
}
const opts = (s, extra = {}) => Object.assign({ id: 'mikey', claudeRoots: [], museData: s.data }, extra);
const museOf = (roots) => roots.find((r) => r.name === 'sessions/mikey/muse');

test('kosmos#8530: the agent\'s own Muse session folders are taken, every day it was resumed, and nothing else', () => {
  const s = world();
  const r = museOf(bs.sessionsFor(s.agent, opts(s)));
  assert.ok(r, 'no Muse root for an agent with a Muse session');
  assert.equal(r.path, fs.realpathSync(s.sessions));
  assert.deepEqual(r.only, [`2026/11/14/${MINE}/session.jsonl`, `2026/11/15/${MINE}/session.jsonl`]);
  const all = JSON.stringify(r);
  for (const not of [THEIRS, 'session-index.db', '.msp-view-g12']) assert.ok(!all.includes(not), 'took ' + not + ': ' + all);
  // CONTROL: the other agent gets its own session, not this one.
  const leo = bs.sessionsFor(s.other, opts(s, { id: 'leo' })).find((x) => x.name === 'sessions/leo/muse');
  assert.deepEqual(leo.only, [`2026/11/14/${THEIRS}/session.jsonl`]);
});

test('kosmos#8530: no session id, or one that is not a Muse id, gives no Muse root', () => {
  const s = world();
  fs.rmSync(path.join(s.agent, '.kosmos', 'muse-session'));
  assert.equal(museOf(bs.sessionsFor(s.agent, opts(s))), undefined);
  fs.writeFileSync(path.join(s.agent, '.kosmos', 'muse-session'), '../../leo\n');
  assert.equal(museOf(bs.sessionsFor(s.agent, opts(s))), undefined);
  // And no data home given: nothing.
  fs.writeFileSync(path.join(s.agent, '.kosmos', 'muse-session'), MINE + '\n');
  assert.equal(museOf(bs.sessionsFor(s.agent, opts(s, { museData: undefined }))), undefined);
  assert.ok(museOf(bs.sessionsFor(s.agent, opts(s))), 'CONTROL: the same agent with its id and data home has a root');
});

test('kosmos#8530: a session folder that is a link is not followed, and a linked sessions folder is refused', () => {
  const s = world();
  // A dated folder for this id that links to the other agent's session: not taken.
  const linked = path.join(s.sessions, '2026', '11', '16', MINE);
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(path.join(s.sessions, '2026', '11', '14', THEIRS), linked);
  const r = museOf(bs.sessionsFor(s.agent, opts(s)));
  assert.ok(!r.only.some((f) => f.startsWith('2026/11/16/')), 'a linked session folder was followed: ' + JSON.stringify(r.only));
  // The whole sessions folder a link: refused and said so.
  const real = path.join(s.base, 'elsewhere');
  fs.renameSync(s.sessions, real);
  fs.symlinkSync(real, s.sessions);
  const refused = museOf(bs.sessionsFor(s.agent, opts(s)));
  assert.equal(refused.refused, 'a session folder that is a link (not followed)');
  assert.equal(refused.path, undefined);
});

test('kosmos#8530 review 1: a muse-session that is a link, or a .kosmos folder that is one, lends no id', () => {
  const s = world();
  const mine = path.join(s.agent, '.kosmos', 'muse-session');
  fs.rmSync(mine);
  fs.symlinkSync(path.join(s.other, '.kosmos', 'muse-session'), mine);
  assert.equal(museOf(bs.sessionsFor(s.agent, opts(s))), undefined, 'a linked muse-session lent the other agent its id');
  fs.rmSync(path.join(s.agent, '.kosmos'), { recursive: true });
  fs.symlinkSync(path.join(s.other, '.kosmos'), path.join(s.agent, '.kosmos'));
  assert.equal(museOf(bs.sessionsFor(s.agent, opts(s))), undefined, 'a linked .kosmos folder lent the other agent its id');
});
