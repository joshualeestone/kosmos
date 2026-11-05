'use strict';
/**
 * kosmos#7992 item 2 (feedback: an agent's follows clustered on one topic, its Following feed saturated for weeks, and
 * honest engagement drifted to votes only): at most once a day, a Following read ends with one line in Kosmos's own
 * words suggesting an agent the reader does not follow, from a channel its Following feed has none of
 * (communityfollow.suggestOutside). Driven with a fake public feed and follow list; the reader's identity and its
 * board's agents are stubbed.
 *
 *   node --test engine/communityfollow-broaden-7992.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-broaden-7992-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cr = require('./communityread');
const cf = require('./communityfollow');
const self = require('./communityself');

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const HERE = id(1); const FOLLOWED = id(2); const BYNAME = id(3); const ME = id(4); const PERSON = id(5); const PICK = id(6); const LATER = id(7);
const post = (n, name, channel, agentId, kind = 'agent') => ({ id: id(100 + n), title: 't' + n, body: 'b', channel, created_at: '2026-11-04T10:00:00Z', agent: { id: agentId, name, kind } });

let feed; let follows; let asked;
const realStored = self.stored; const realHere = self.hereIds;
test.before(() => {
  self.stored = () => ({ name: 'Mara' });
  self.hereIds = () => new Set([HERE]);
  cr.setFetcher(async (url) => {
    asked.push(url.replace(/^https?:\/\/[^/]+/, ''));
    if (/\/posts\/feed\?limit=\d+$/.test(url)) return feed === null ? { status: 503, json: null } : { status: 200, json: { posts: feed, next_cursor: null } };
    if (/\/agents\/by-name\/Mara\/following\?limit=\d+$/.test(url)) return follows === null ? { status: 503, json: null } : { status: 200, json: { agents: follows.agents, next_cursor: follows.partial ? 'more' : null } };
    return { status: 404, json: null };
  });
});
test.after(() => { self.stored = realStored; self.hereIds = realHere; cr.setFetcher(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const reset = (agent) => { fs.rmSync(path.join(process.env.AGENT_WORKFORCE_DATA), { recursive: true, force: true }); asked = []; return agent; };

/* The reader's Following feed holds only "operations". In the public feed, newest first: a sibling on this board, an
   agent it follows (by id), one it follows by name, itself, a person, and only then an eligible agent in "research";
   the one after it (also eligible) must NOT be picked: the newest eligible one is. One in "operations" is skipped too. */
const SHOWN = [{ where: 'operations/infra' }];
function standardFeed() {
  return [
    post(1, 'Sib', 'research', HERE),
    post(2, 'Followed', 'research', FOLLOWED),
    post(3, 'Named', 'research', BYNAME),
    post(4, 'Mara', 'research', ME),
    post(5, 'A Person', 'research', PERSON, 'person'),
    post(6, 'Same Channel', 'operations', id(8)),
    post(7, 'Picked One', 'research', PICK),
    post(8, 'Later One', 'marketing', LATER),
  ];
}
const FOLLOWS = { agents: [{ id: FOLLOWED, name: 'Followed' }, { name: 'Named' }], partial: false };

test('#7992 item 2: the newest eligible agent from a channel the Following feed lacks, in Kosmos\'s words, once a day', async () => {
  reset(); feed = standardFeed(); follows = FOLLOWS;
  const now = Date.parse('2026-11-04T18:00:00Z');
  const line = await cf.suggestOutside('mara-key', SHOWN, { now });
  assert.equal(line, 'Kosmos suggests, once a day, from outside who you follow: the agent "Picked One" posts in research. '
    + 'Read that channel first: kosmos community read --channel research. Follow them only if their work interests you: kosmos community follow "Picked One".');
  assert.ok(asked.some((u) => u.startsWith('/posts/feed?limit=')) && asked.some((u) => u.startsWith('/agents/by-name/Mara/following')), JSON.stringify(asked));
  assert.equal(await cf.suggestOutside('mara-key', SHOWN, { now: now + 3600 * 1000 }), '', 'once a day: the same day says nothing');
  assert.equal(await cf.suggestOutside('other-key', SHOWN, { now: now + 3600 * 1000 }) !== '', true, 'the day is per agent');
  assert.notEqual(await cf.suggestOutside('mara-key', SHOWN, { now: now + cf.SUGGEST_EVERY_MS + 1 }), '', 'a day later it may suggest again');
});

test('#7992 item 2: nothing when anything is unknown, and an empty read does not use up the day', async () => {
  const now = Date.parse('2026-11-05T09:00:00Z');
  reset(); feed = standardFeed(); follows = { ...FOLLOWS, partial: true };
  assert.equal(await cf.suggestOutside('mara-key', SHOWN, { now }), '', 'a partial follow list could already hold the pick');
  reset(); feed = null; follows = FOLLOWS;
  assert.equal(await cf.suggestOutside('mara-key', SHOWN, { now }), '', 'the public feed unread');
  reset(); feed = standardFeed(); follows = null;
  assert.equal(await cf.suggestOutside('mara-key', SHOWN, { now }), '', 'the follow list unread');
  reset(); feed = standardFeed(); follows = FOLLOWS;
  assert.equal(await cf.suggestOutside('mara-key', [{ where: 'research' }, { where: 'marketing/x' }, { where: 'operations' }], { now }), '',
    'every eligible author is in a channel the Following feed already has');
  // Control: the same agent, the same day, with a channel to broaden into, gets its line: the empty reads used nothing.
  assert.notEqual(await cf.suggestOutside('mara-key', SHOWN, { now }), '');
});
