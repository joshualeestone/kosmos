'use strict';
/**
 * #4939: an agent's own community items and where each stands (`kosmos community status`), from the board's records
 * only. Sandboxed data root before the require; posts go through the real publish path (feedpublish), and send
 * records are written in the shapes the sweep writes (as communitymine.test.js does). The ON period's start is
 * recorded before each post, as the post route does (willSend).
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
const communitysite = require('./communitysite');
const cs = require('./communitysend');
const status = require('./communitystatus');

let switchOn = true;
cs.setSwitch(() => ({ ok: true, on: switchOn }));
test.after(() => { cs.setSwitch(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.beforeEach(() => {
  switchOn = true;
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });   // an ON period that began before every post
});

function post(agent, topic, { body } = {}) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic, body: body || topic + ' body.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function comment(agent, text) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: '7a1b2c3d-0000-4000-8000-000000000001' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); }
const stateOfTitle = (agent, title) => (status.itemsFor(agent).find((x) => x.title === title) || {}).state;

test('a post not yet met by the send layer is queued; one it sent is in the community; only this agent\'s are listed', () => {
  post('ava', 'Queued one');
  const b = post('ava', 'Sent one');
  post('bob', 'Not ava\'s');
  writeJson(cs._paths.sentFile(), { [b.id]: { state: 'sent', agent: 'ava', remoteId: 'r1', sentAt: '2026-10-01T20:00:00Z' } });
  const items = status.itemsFor('ava');
  assert.deepEqual(items.map((x) => [x.title, x.state]).sort(), [['Queued one', 'queued'], ['Sent one', 'sent']]);
  const t = status.statusText('ava').text;
  assert.match(t, /"Queued one".*queued: Kosmos sends it on its next pass/);
  assert.match(t, /"Sent one".*: in the community$/m);
  assert.doesNotMatch(t, /Not ava/, 'another agent\'s post was listed');
  assert.equal(status.waitingPosts('ava'), 1);
});

test('a held post (the scrub stopped it for the person) is held until they release it, and counts as waiting', () => {
  // An email address in a post is what the safety check stops (feedguard), as a real agent's post would be.
  const r = post('newbie', 'Held one', { body: 'Write to me at someone@example.com about it.' });
  assert.notEqual(r.status, 'published', 'fixture: the safety check did not stop it: ' + JSON.stringify(r));
  assert.deepEqual(status.itemsFor('newbie').map((x) => x.state), ['held']);
  assert.match(status.statusText('newbie').text, /held for your person to look at; it goes out only if they release it/);
  assert.equal(status.waitingPosts('newbie'), 1);
});

test('review 1: switched off, an unsent post is NOT "waiting" (OFF ends the ON period, so it never goes); nor one made before the ON period', () => {
  post('ava', 'Made then switched off');
  assert.equal(stateOfTitle('ava', 'Made then switched off'), 'queued', 'CONTROL: on, inside the ON period');
  switchOn = false;
  cs.endOnPeriodNow();   // what switching OFF does (communityswitch): the ON period ends at once
  assert.equal(stateOfTitle('ava', 'Made then switched off'), 'before_on');
  assert.match(status.statusText('ava').text, /not sent, and it will not be: the community was switched off before it went out\. If you have not posted it again since, you can/);
  assert.equal(status.waitingPosts('ava'), 0, 'a post that will never go counted as waiting');
  switchOn = true;
  writeJson(cs._paths.stateFile(), { since: '2999-01-01T00:00:00Z' });
  assert.equal(stateOfTitle('ava', 'Made then switched off'), 'before_on');
  // A pending record left from an earlier ON period is not sent either (the sweep filters by the period's start).
  const sentRec = status.itemsFor('ava')[0];
  writeJson(cs._paths.sentFile(), { [sentRec.id]: { state: 'pending', agent: 'ava' } });
  assert.equal(stateOfTitle('ava', 'Made then switched off'), 'before_on', 'a pending record from an earlier period read queued');
});

test('review 1: a refused agent: an unsent post is not sent, a SENT one is still in the community (and says so)', () => {
  const a = post('ava', 'Went before');
  post('ava', 'After refusal');
  writeJson(cs._paths.sentFile(), { [a.id]: { state: 'sent', agent: 'ava', remoteId: 'r1', sentAt: '2026-10-01T20:00:00Z' } });
  assert.equal(stateOfTitle('ava', 'Went before'), 'sent', 'CONTROL: not refused');
  writeJson(cs._paths.keysFile(), { ava: { refused: true } });
  assert.equal(stateOfTitle('ava', 'Went before'), 'sent_refused');
  assert.equal(stateOfTitle('ava', 'After refusal'), 'agent_refused');
  const t = status.statusText('ava').text;
  assert.match(t, /"Went before".*: in the community; the community has since refused this agent/);
  assert.match(t, /"After refusal".*: not sent: the community has refused this agent/);
});

test('review 1: a post the community\'s moderators took down says so', () => {
  const a = post('ava', 'Taken');
  writeJson(cs._paths.sentFile(), { [a.id]: { state: 'sent', agent: 'ava', remoteId: 'r1', takenDown: true, takeDownReason: 'spam' } });
  assert.equal(stateOfTitle('ava', 'Taken'), 'taken_down');
  assert.match(status.statusText('ava').text, /"Taken".*taken down by the community's moderators/);
});

test('review 1/2: a corrupt send record is "cannot say", never every sent post read as queued; per half; a MISSING one is empty', () => {
  const a = post('ava', 'Sent one');
  comment('ava', 'A comment');
  assert.equal(stateOfTitle('ava', 'Sent one'), 'queued', 'CONTROL: no send records yet reads as empty, not unreadable');
  writeJson(cs._paths.sentFile(), { [a.id]: { state: 'sent', agent: 'ava', remoteId: 'r1' } });
  assert.equal(stateOfTitle('ava', 'Sent one'), 'sent');
  const cases = [[cs._paths.sentFile(), 'unreadable', 'unreadable'], [cs._paths.commentsSentFile(), 'sent', 'unreadable'],
    [cs._paths.keysFile(), 'unreadable', 'unreadable'], [cs._paths.stateFile(), 'unreadable', 'unreadable']];
  for (const [f, postState, commentState] of cases) {
    const before = fs.existsSync(f) ? fs.readFileSync(f) : null;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{corrupt');
    assert.deepEqual([stateOfTitle('ava', 'Sent one'), stateOfTitle('ava', 'A comment')], [postState, commentState], path.basename(f));
    if (before) fs.writeFileSync(f, before); else fs.rmSync(f);
  }
  fs.writeFileSync(cs._paths.sentFile(), '{corrupt');
  assert.match(status.statusText('ava').text, /"Sent one".*cannot read its send records just now.*do not send it again/);
  fs.writeFileSync(cs._paths.sentFile(), JSON.stringify({ [a.id]: { state: 'sent', agent: 'ava', remoteId: 'r1' } }));
  assert.equal(stateOfTitle('ava', 'Sent one'), 'sent', 'CONTROL: restored, it answers again');
});

test('review 2: switched off with the ON period still recorded (ending it is best effort), an unsent post waits; it is never "post it again"', () => {
  post('ava', 'Paused');
  writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });
  switchOn = false;
  assert.equal(stateOfTitle('ava', 'Paused'), 'paused');
  assert.match(status.statusText('ava').text, /waiting: Kosmos is not sending to the community right now; do not send it again/);
  writeJson(cs._paths.stateFile(), {});
  assert.equal(stateOfTitle('ava', 'Paused'), 'before_on', 'CONTROL: the period ended, it never goes');
});

test('review 2: a community name held with no key reads it, before the sweep has met the post, and for comments', () => {
  post('ava', 'Unmet post');
  comment('ava', 'Unmet comment');
  writeJson(cs._paths.keysFile(), { ava: { registering: { taken: true } } });
  assert.deepEqual([stateOfTitle('ava', 'Unmet post'), stateOfTitle('ava', 'Unmet comment')], ['name_unclaimed', 'name_unclaimed']);
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'k', registering: { taken: true } } });
  assert.equal(stateOfTitle('ava', 'Unmet post'), 'queued', 'CONTROL: with a key it goes');
});

test('review 2: an address the sweep will not send to reads so, not "queued"', (t) => {
  const was = process.env.AGENT_WORKFORCE_COMMUNITY_URL;
  t.after(() => { if (was === undefined) delete process.env.AGENT_WORKFORCE_COMMUNITY_URL; else process.env.AGENT_WORKFORCE_COMMUNITY_URL = was; });
  post('ava', 'Insecure');
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://community.example.com';
  writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });
  assert.equal(stateOfTitle('ava', 'Insecure'), 'address_refused');
  assert.equal(status.waitingPosts('ava'), 1, 'review 9: a post worded "waiting" was not counted as waiting for --replies');
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:9';
  writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });
  assert.equal(stateOfTitle('ava', 'Insecure'), 'queued', 'CONTROL: a local address is sent to');
});

test('review 2: an empty post Kosmos itself refused says so; a held comment on the board\'s own post is not listed', () => {
  const a = post('ava', 'Empty');
  writeJson(cs._paths.sentFile(), { [a.id]: { state: 'refused', agent: 'ava', reasons: ['empty'] } });
  assert.equal(stateOfTitle('ava', 'Empty'), 'refused_empty');
  const rows = [{ id: 'lc', kind: 'community_post', agent: 'ava', author: { type: 'agent', name: 'ava' }, body: 'on a board post', postId: 'p1', status: 'held', receivedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'rc', kind: 'community_post', agent: 'ava', author: { type: 'agent', name: 'ava' }, body: 'on a community post', remotePostId: '7a1b2c3d-0000-4000-8000-000000000001', status: 'held', receivedAt: '2026-09-01T00:00:01.000Z' }];
  writeJson(communitystore._paths.commentsFile(), rows);
  const held = status.itemsFor('ava').filter((x) => x.kind === 'comment').map((x) => x.id);
  assert.deepEqual(held, ['rc']);
});

test('review 2: willSend for a post ignores the comment records (a broken comment file does not stop posts)', () => {
  writeJson(cs._paths.commentsSentFile(), {});
  assert.equal(cs.willSend('ava', Date.now(), 'post').sends, true, 'CONTROL');
  fs.writeFileSync(cs._paths.commentsSentFile(), '{corrupt');
  assert.equal(cs.willSend('ava', Date.now(), 'post').sends, true, 'a corrupt comment record stopped a post');
  assert.equal(cs.willSend('ava').sends, false, 'a comment still needs its records');
  fs.writeFileSync(cs._paths.sentFile(), '{corrupt');
  assert.equal(cs.willSend('ava', Date.now(), 'post').sends, false, 'a corrupt post record still stops a post');
});

test('review 1: past the daily cap a queued post or comment says it waits for the cap, not "within a few minutes"', () => {
  post('ava', 'Capped post');
  comment('ava', 'Capped comment text');
  const future = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'k', retryAt: past, commentRetryAt: past } });
  assert.equal(stateOfTitle('ava', 'Capped post'), 'queued', 'CONTROL: a cap that has lifted');
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'k', retryAt: future } });
  assert.equal(stateOfTitle('ava', 'Capped post'), 'capped');
  assert.equal(stateOfTitle('ava', 'Capped comment text'), 'queued', 'the post cap held a comment back (they are counted apart)');
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'k', commentRetryAt: future } });
  assert.equal(stateOfTitle('ava', 'Capped comment text'), 'capped');
  assert.match(status.statusText('ava').text, /daily limit for this agent is reached/);
});

test('review 1: an agent whose community name is held with no key says it waits, not "within a few minutes"', () => {
  const a = post('ava', 'Unclaimed');
  writeJson(cs._paths.keysFile(), { ava: { registering: { taken: true } } });
  writeJson(cs._paths.sentFile(), { [a.id]: { state: 'pending', agent: 'ava' } });
  assert.equal(stateOfTitle('ava', 'Unclaimed'), 'name_unclaimed');
});

test('review 1: a person\'s own site post under the same name is not the agent\'s (the sweep never sends it)', () => {
  const h = communitysite.publishHumanPost({ authorName: 'ava', body: 'Written by the person on the site.' });
  assert.equal(h.ok, true, JSON.stringify(h));
  post('ava', 'Agent post');
  assert.deepEqual(status.itemsFor('ava').map((x) => x.title), ['Agent post']);
});

test('review 1: a comment the route marked never to send reads not sent, even with no send record', () => {
  const c = comment('ava', 'Never going');
  assert.equal(stateOfTitle('ava', 'Never going'), 'queued', 'CONTROL: unmarked');
  assert.equal(communitystore.markServiceCommentNotSent(c.id), true);
  assert.equal(stateOfTitle('ava', 'Never going'), 'not_sent');
});

test('review 1: held rows are read for this agent from every row, not a page of the oldest across all agents', () => {
  const rows = [];
  for (let i = 0; i < 1100; i++) rows.push({ id: 'h' + i, kind: 'community_post', agent: 'bob', author: { type: 'agent', name: 'bob' }, topic: 'Bob ' + i, body: 'x', status: 'held', receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
  rows.push({ id: 'mine', kind: 'community_post', agent: 'ava', author: { type: 'agent', name: 'ava' }, topic: 'Ava held', body: 'x', status: 'held', receivedAt: '2026-09-01T00:00:00.000Z' });
  writeJson(communitystore._paths.postsFile(), rows);
  assert.deepEqual(status.itemsFor('ava').map((x) => [x.title, x.state]), [['Ava held', 'held']]);
});

test('nothing posted: a plain sentence; another name, even one that keys alike, sees nothing of ava\'s', () => {
  assert.equal(status.statusText('ava').text, 'You have not posted or commented in the Kosmos+ community yet.');
  post('ava', 'Mine');
  assert.equal(status.itemsFor('Ava').length, 0, 'matched by a name that only keys alike');
});

test('every state this module or the send layer can produce has words (read from the source, so a new one is seen)', () => {
  const own = fs.readFileSync(path.join(__dirname, 'communitystatus.js'), 'utf8');
  const send = fs.readFileSync(path.join(__dirname, 'communitysend.js'), 'utf8');
  // Review 5: every quoted word in stateOf, so a state returned from a ternary is seen too. The words it only compares
  // against (item kinds, the layer's 'pending', a typeof, a refusal reason) are not states it returns.
  const NOT_STATES = new Set(['comment', 'post', 'pending', 'string', 'empty']);
  const fromStateOf = [...own.slice(own.indexOf('function stateOf'), own.indexOf('function itemsFor')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    .filter((w) => !NOT_STATES.has(w));
  const fromSend = [...send.matchAll(/state(?:: | = )'([a-z_]+)'/g)].map((m) => m[1]).filter((s) => s !== 'pending');
  assert.ok(fromStateOf.length >= 8, 'CONTROL: the stateOf scan found too few states: ' + fromStateOf);
  assert.ok(fromSend.includes('sent') && fromSend.includes('unconfirmed'), 'CONTROL: the send-layer scan found ' + fromSend);
  for (const st of new Set([...fromStateOf, ...fromSend, 'held', 'sending'])) {
    assert.ok(status.COMMENT_WORDS[st], 'no words for comment state ' + st);
    if (st !== 'sending') assert.ok(status.POST_WORDS[st], 'no words for post state ' + st);
  }
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

/* #5415: an item in the community prints where it can be seen; nothing else does. */
const RID = '5f0e8c1a-1111-4222-8333-444455556666';
test('#5415: a sent post prints its public link on its own line; a queued one prints none', () => {
  post('ava', 'Queued one');
  const b = post('ava', 'Sent one');
  writeJson(cs._paths.sentFile(), { [b.id]: { state: 'sent', agent: 'ava', remoteId: RID, sentAt: '2026-10-01T20:00:00Z' } });
  const items = status.itemsFor('ava');
  assert.equal(items.find((x) => x.title === 'Sent one').link, 'https://community.kosmosplus.com/post/' + RID);
  assert.equal(items.find((x) => x.title === 'Queued one').link, undefined, 'a queued post was given a link');
  const t = status.statusText('ava').text;
  assert.match(t, /"Sent one".*: in the community\n  see it at https:\/\/community\.kosmosplus\.com\/post\/5f0e8c1a-1111-4222-8333-444455556666$/m);
  assert.equal((t.match(/see it at /g) || []).length, 1, 'more than the one sent post was linked:\n' + t);
});

test('#5415: a sent comment links to the post it is on; an unsent comment does not', () => {
  const c = comment('ava', 'A sent comment.');
  comment('ava', 'A queued comment.');
  writeJson(cs._paths.commentsSentFile(), { [c.id]: { state: 'sent', agent: 'ava', remoteId: 'c-remote-1', post: '7a1b2c3d-0000-4000-8000-000000000001' } });
  const t = status.statusText('ava').text;
  assert.match(t, /"A sent comment\.".*: in the community\n  on the post at https:\/\/community\.kosmosplus\.com\/post\/7a1b2c3d-0000-4000-8000-000000000001$/m);
  assert.doesNotMatch(t, /"A queued comment\.".*\n  on the post at/, 'a queued comment was given a link');
  assert.equal((t.match(/on the post at /g) || []).length, 1);
});

test('#5415: a refused agent\'s sent post still links; taken down, unconfirmed and refused do not', () => {
  const a = post('ava', 'Sent then refused');
  const b = post('ava', 'Taken down');
  const c = post('ava', 'Unconfirmed');
  const d = post('ava', 'Refused');
  writeJson(cs._paths.keysFile(), { ava: { refused: true } });
  writeJson(cs._paths.sentFile(), {
    [a.id]: { state: 'sent', agent: 'ava', remoteId: RID },
    [b.id]: { state: 'sent', agent: 'ava', remoteId: RID.replace('5f', '6f'), takenDown: true },
    [c.id]: { state: 'pending', agent: 'ava', attempted: true },
    [d.id]: { state: 'refused', agent: 'ava', remoteId: RID.replace('5f', '7f') },
  });
  const by = Object.fromEntries(status.itemsFor('ava').map((x) => [x.title, x]));
  assert.equal(by['Sent then refused'].state, 'sent_refused', 'fixture');
  assert.ok(by['Sent then refused'].link, 'CONTROL: a post that is in the community lost its link');
  for (const t of ['Taken down', 'Unconfirmed', 'Refused']) assert.equal(by[t].link, undefined, t + ' was given a link (state ' + by[t].state + ')');
});

test('#5415: an id that is not a plain id is never printed', () => {
  const b = post('ava', 'Odd id');
  writeJson(cs._paths.sentFile(), { [b.id]: { state: 'sent', agent: 'ava', remoteId: 'x\u001b[2J/../evil' } });
  assert.equal(status.itemsFor('ava')[0].state, 'sent', 'fixture');
  assert.equal(status.itemsFor('ava')[0].link, undefined);
  assert.doesNotMatch(status.statusText('ava').text, /see it at|evil/);
});

test('#5415: the link uses the address this board sends to, not a fixed production one', (t) => {
  const was = process.env.AGENT_WORKFORCE_COMMUNITY_URL;
  t.after(() => { if (was === undefined) delete process.env.AGENT_WORKFORCE_COMMUNITY_URL; else process.env.AGENT_WORKFORCE_COMMUNITY_URL = was; });
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'https://staging-community.example.test/';
  const b = post('ava', 'Staging');
  writeJson(cs._paths.sentFile(), { [b.id]: { state: 'sent', agent: 'ava', remoteId: RID } });
  assert.equal(status.itemsFor('ava')[0].link, 'https://staging-community.example.test/post/' + RID);
});

test('#5415 review 1: no link when the address Kosmos sends to is not a plain https site (a local API, or one with a path)', (t) => {
  const was = process.env.AGENT_WORKFORCE_COMMUNITY_URL;
  t.after(() => { if (was === undefined) delete process.env.AGENT_WORKFORCE_COMMUNITY_URL; else process.env.AGENT_WORKFORCE_COMMUNITY_URL = was; });
  const b = post('ava', 'Somewhere');
  // The send records live in a folder per address, so each address gets its own records, as a board on it would have.
  const linkAt = (addr) => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = addr;
    writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });
    writeJson(cs._paths.sentFile(), { [b.id]: { state: 'sent', agent: 'ava', remoteId: RID } });
    const it = status.itemsFor('ava').find((x) => x.title === 'Somewhere');
    assert.equal(it.state, 'sent', 'fixture at ' + addr + ': ' + it.state);
    return it;
  };
  assert.equal(linkAt('https://community.kosmosplus.com').link, 'https://community.kosmosplus.com/post/' + RID, 'CONTROL: the real site links');
  for (const addr of ['http://127.0.0.1:8000', 'http://localhost:8000', 'https://example.test/api', 'not a url']) {
    const it = linkAt(addr);
    assert.equal(it.link, undefined, addr + ' gave a link: ' + it.link);
  }
});

test('#5415 review 1: a comment on a post id that is not a plain id is refused at publish, so it never reaches a link', () => {
  communitystore.grantTrust('ava');
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), body: 'Odd parent.', servicePostId: 'not/a plain id' }, { agentId: 'ava' });
  assert.equal(r.ok, false, 'an odd parent id was stored: ' + JSON.stringify(r));
  assert.equal(status.itemsFor('ava').length, 0);
});
