'use strict';
/**
 * #4939: an agent's own community items and where each stands (`kosmos community status`), from the board's records
 * only. Sandboxed data root before the require; posts go through the real publish path (feedpublish), and send
 * records are written in the shapes the sweep writes (as communitymine.test.js does).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communitystatus-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const status = require('./communitystatus');

let switchOn = true;
cs.setSwitch(() => ({ ok: true, on: switchOn }));
test.after(() => { cs.setSwitch(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.beforeEach(() => { switchOn = true; fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true }); });

function post(agent, topic, { body } = {}) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic, body: body || topic + ' body.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); }

test('a post not yet met by the send layer is queued; one it sent is in the community; only this agent\'s are listed', () => {
  const a = post('ava', 'Queued one');
  const b = post('ava', 'Sent one');
  post('bob', 'Not ava\'s');
  writeJson(cs._paths.sentFile(), { [b.id]: { state: 'sent', agent: 'ava', remoteId: 'r1', sentAt: '2026-10-01T20:00:00Z' } });
  const items = status.itemsFor('ava');
  assert.deepEqual(items.map((x) => [x.title, x.state]).sort(), [['Queued one', 'queued'], ['Sent one', 'sent']]);
  assert.ok(!items.some((x) => x.id === a.id && x.state !== 'queued'));
  const t = status.statusText('ava').text;
  assert.match(t, /"Queued one".*queued: Kosmos sends it on its next pass/);
  assert.match(t, /"Sent one".*in the community/);
  assert.doesNotMatch(t, /Not ava/, 'another agent\'s post was listed');
  assert.equal(status.waitingPosts('ava'), 1);
});

test('a held post (the scrub stopped it for the person) is listed as held, and counts as waiting', () => {
  // An email address in a post is what the safety check stops (feedguard), as a real agent's post would be.
  const r = post('newbie', 'Held one', { body: 'Write to me at someone@example.com about it.' });
  assert.notEqual(r.status, 'published', 'fixture: the safety check did not stop it: ' + JSON.stringify(r));
  const items = status.itemsFor('newbie');
  assert.deepEqual(items.map((x) => x.state), ['held']);
  assert.match(status.statusText('newbie').text, /held for your person/);
  assert.equal(status.waitingPosts('newbie'), 1);
});

test('with the community switched off, an unsent post says it waits for the switch; one made before the ON period says it will not go', () => {
  post('ava', 'Made while off');
  switchOn = false;
  assert.match(status.statusText('ava').text, /switched off on this board/);
  switchOn = true;
  writeJson(cs._paths.stateFile(), { since: '2999-01-01T00:00:00Z' });
  assert.match(status.statusText('ava').text, /not sent: it was made while the community was switched off/);
});

test('nothing posted: a plain sentence; another name, even one that keys alike, sees nothing of ava\'s', () => {
  assert.equal(status.statusText('ava').text, 'You have not posted or commented in the Kosmos+ community yet.');
  post('ava', 'Mine');
  assert.equal(status.itemsFor('Ava').length, 0, 'matched by a name that only keys alike');
});

test('every state the send layer writes has words (a new state would read "unknown")', () => {
  for (const st of ['queued', 'sent', 'unconfirmed', 'withheld', 'refused', 'deleted', 'not_sent', 'held', 'before_on', 'off']) {
    assert.ok(status.POST_WORDS[st], 'no words for post state ' + st);
    assert.ok(status.COMMENT_WORDS[st], 'no words for comment state ' + st);
  }
  assert.ok(status.COMMENT_WORDS.sending);
});

test('--replies with only a queued post says it is waiting to go out, not "no posts" (every family read that as lost)', async () => {
  const communityread = require('./communityread');
  const none = await communityread.readReplies('ava');
  assert.match(none.text, /you have no posts in the community yet/, 'CONTROL: nothing posted');
  post('ava', 'On its way');
  const r = await communityread.readReplies('ava');
  assert.equal(r.ok, true);
  assert.match(r.text, /none of your posts is in the community yet: 1 waiting to go out\. See where each stands with: kosmos community status/);
});
