'use strict';
/**
 * kosmos#7211: Settings shows a summary of what the agents have in the community (counts, and each agent's own page on
 * the community) instead of every post and comment. communitymine.summary() counts only what is out there now, and
 * names an agent's community page only from the board's own registration record.
 *
 * Fixtures use the shapes production writes, as communitymine.test.js and communitycommentmine-4801.test.js do: posts
 * and comments through feedpublish, records in the sweep's own forms, keys.json as register writes it.
 *
 *   node --test engine/communitymine-summary-7211.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-commindex-7211-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const mine = require('./communitymine');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
test.beforeEach(() => fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true }));

const POST = crypto.randomUUID();
function agentPost(agent, topic) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic, body: topic + ' body.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function comment(agent, text) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: POST }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}
const SENT = (agent) => ({ state: 'sent', agent, remoteId: 'r-' + agent + crypto.randomUUID(), sentAt: '2026-10-26T08:00:00Z' });
const CSENT = (agent) => ({ state: 'sent', agent, post: POST, remoteId: 'rc-' + crypto.randomUUID(), sentAt: '2026-10-26T08:00:00Z' });

test('#7211: nothing sent yet: zero counts and no agents, not an error', () => {
  assert.deepEqual(mine.summary(), { posts: 0, comments: 0, agents: [] });
});

test('#7211: counts only what is in the community now, per agent, with its registered community name', () => {
  const p = {};
  for (const t of ['out1', 'out2', 'down', 'deleting', 'pending', 'refused']) p[t] = agentPost('ava', t).id;
  const bo = agentPost('bo', 'bo out').id;
  const c1 = comment('ava', 'a comment that is out');
  const c2 = comment('ava', 'a comment being removed');
  const c3 = comment('bo', 'bo comment out');
  writeJson(cs._paths.sentFile(), {
    [p.out1]: SENT('ava'), [p.out2]: SENT('ava'),
    [p.down]: { ...SENT('ava'), takenDown: true, takeDownReason: 'spam' },
    [p.deleting]: SENT('ava'),
    [p.pending]: { state: 'pending', agent: 'ava' },
    [p.refused]: { state: 'refused', agent: 'ava', reasons: ['email'] },
    [bo]: SENT('bo'),
  });
  writeJson(cs._paths.commentsSentFile(), { [c1.id]: { ...CSENT('ava'), agentId: 'ra' }, [c2.id]: { ...CSENT('ava'), agentId: 'ra' }, [c3.id]: CSENT('bo') });
  // keys.json as register writes it: ava is registered; bo is still registering (no key, so no settled name).
  writeJson(cs._paths.keysFile(), {
    ava: { remoteId: 'ra', name: 'Ava-the-Ops', apiKey: 'kc_x', token: 't' },
    bo: { registering: { name: 'Bo', at: '2026-10-26T08:00:00Z' } },
  });
  // A delete is asked the only way production asks one (deletes.json and comment-deletes.json are its own writes),
  // after keys.json, since a delete needs the agent's key.
  const d1 = cs.requestDelete(p.deleting); assert.equal(d1.ok, true, JSON.stringify(d1));
  const d2 = cs.requestDelete(c2.id); assert.equal(d2.ok, true, JSON.stringify(d2));
  const s = mine.summary();
  assert.equal(s.posts, 3, 'out1, out2 and bo out; not the taken-down, deleting, pending or refused ones');
  assert.equal(s.comments, 2, 'not the comment being removed');
  assert.deepEqual(s.agents, [
    { agent: 'ava', name: 'Ava-the-Ops', posts: 2, comments: 1 },
    { agent: 'bo', name: null, posts: 1, comments: 1 },
  ]);
  // Control: the full list still has every row, so the summary is what leaves them out.
  assert.equal(mine.mine().length, 7);
  assert.equal(mine.mineComments().length, 3);
});

test('#7211: the community name comes from the registration, never from the display name', () => {
  const id = agentPost('ava', 'out').id;
  writeJson(cs._paths.sentFile(), { [id]: SENT('ava') });
  writeJson(cs._paths.keysFile(), { ava: { remoteId: 'ra', name: 'ava-2f3c', apiKey: 'kc_x', token: 't' } });
  assert.equal(mine.summary().agents[0].name, 'ava-2f3c');
});

test('#7211: unreadable records are unknown, never zero: comments null, names null', () => {
  const id = agentPost('ava', 'out').id;
  writeJson(cs._paths.sentFile(), { [id]: SENT('ava') });
  fs.mkdirSync(path.dirname(cs._paths.commentsSentFile()), { recursive: true });
  fs.writeFileSync(cs._paths.commentsSentFile(), '{not json');
  fs.writeFileSync(cs._paths.keysFile(), '{not json');
  const s = mine.summary();
  assert.equal(s.posts, 1);
  assert.equal(s.comments, null);
  assert.deepEqual(s.agents, [{ agent: 'ava', name: null, posts: 1, comments: null }]);
  assert.equal(cs.communityNames(), null);
});

test('#7211: a post whose board copy is gone counts in the total, under no agent (its status names none)', () => {
  writeJson(cs._paths.sentFile(), { 'gone-post-id': SENT('ava') });
  const s = mine.summary();
  assert.equal(s.posts, 1);
  assert.deepEqual(s.agents, []);
});

test('#7211: a deleted agent\'s posts are not counted as in the community (its record follows a retired account)', () => {
  const id = agentPost('ava', 'out').id;
  writeJson(cs._paths.sentFile(), { [id]: { ...SENT('retired:ava:2026-10-26T08:00:00.000Z') } });
  const rows = mine.mine();
  assert.equal(rows.length, 1, 'control: the row itself is still listed');
  assert.match(rows[0].agent, /deleted agent/);
  assert.equal(mine.summary().posts, 0);
});

test('#7211: mineAll answers the same rows and summary as the separate reads', () => {
  const id = agentPost('ava', 'out').id;
  const c = comment('ava', 'a comment');
  writeJson(cs._paths.sentFile(), { [id]: SENT('ava') });
  writeJson(cs._paths.commentsSentFile(), { [c.id]: CSENT('ava') });
  writeJson(cs._paths.keysFile(), { ava: { remoteId: 'ra', name: 'Ava-the-Ops', apiKey: 'kc_x', token: 't' } });
  assert.deepEqual(mine.mineAll(), { posts: mine.mine(), comments: mine.mineComments(), summary: mine.summary() });
});
