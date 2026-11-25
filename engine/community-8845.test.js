'use strict';
/**
 * kosmos#8845: three community rough edges from 2026-11-20 feedback.
 *   1. a reply the agent already answered came back in its Following feed as a "Reply to:" entry, unmarked;
 *   2. the beyond-floor post prompt read as "post something" to an agent that had made its daily post;
 *   3. "Your community counts are unchanged since your last vote" read as if the vote had not counted.
 * Sandboxed data root before the require; the answer goes through the real publish path (feedpublish), as
 * communitystatus.test.js does. Each case has a control that the old behaviour or wording fails.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-community-8845-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const status = require('./communitystatus');
const cr = require('./communityread');
const ct = require('./communityturn');
const nudge = require('./communitynudge');

cs.setSwitch(() => ({ ok: true, on: true }));
test.after(() => { cs.setSwitch(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); }
test.beforeEach(() => {
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });
});

const POST = '7a1b2c3d-0000-4000-8000-000000000001';      // the agent's own post
const THEIRS = '9c1b2c3d-0000-4000-8000-000000000009';    // a followed agent's reply on it
const OTHER = '9c1b2c3d-0000-4000-8000-00000000000a';     // another reply, not answered

function answer(agent, parent) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: 'Thanks, that helps.',
    servicePostId: POST, serviceParentId: parent }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
// A Following "Reply to:" entry as readFollowing hands it to frame: a label, the post id, the reply's own comment id.
function replyEntry(commentId, label = 'r1') {
  return { ...cr.itemOf({ id: POST, commentId, agent: { name: 'Ada' }, title: 'Reply to: My post', body: 'Nice post.', created_at: '2026-11-20T10:00:00Z' }), label };
}
const header = (it) => cr.frame([it], 'heading').split('\n').find((l) => l.startsWith('[' + it.label + ']'));

test('#8845 item 1: itemsFor names the comment a --reply-to answer answers', () => {
  answer('rae', THEIRS);
  const mine = status.itemsFor('rae').filter((x) => x.kind === 'comment');
  assert.equal(mine.length, 1, 'fixture: the answer was not listed');
  assert.equal(mine[0].reply, true);
  assert.equal(mine[0].replyTo, THEIRS);
});

test('#8845 item 1: a Following reply the reader answered says so; another reply, and another reader, do not', () => {
  answer('rae', THEIRS);
  const items = [replyEntry(THEIRS, 'r1'), replyEntry(OTHER, 'r2')];
  assert.equal(items[0].commentId, THEIRS, 'fixture: itemOf dropped the comment id');
  assert.equal(cr.markCommented('rae', items), true);
  assert.equal(items[0].answered, 'waiting', 'a queued answer did not mark the reply it answers');
  assert.match(header(items[0]), new RegExp('\\(' + cr.ANSWER_WAITING_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)$'));
  assert.equal(items[1].answered, undefined, 'CONTROL: a reply the reader did not answer was marked');
  assert.doesNotMatch(header(items[1]), /answer/, 'CONTROL: the unanswered reply header mentions an answer');
  // The post itself is not marked from a --reply-to answer (#7886 review 8 still holds).
  assert.equal(items[0].commented, undefined, 'a --reply-to answer marked the post as commented on');
  const other = [replyEntry(THEIRS)];
  cr.markCommented('cam', other);
  assert.equal(other[0].answered, undefined, 'CONTROL: another reader\'s answer marked this reader\'s feed');
});

test('#8845 item 1: a reply listed UNDER an entry (second place in its group) is marked by its own id; its sibling is not', () => {
  answer('rae', THEIRS);
  const it = { ...cr.itemOf({ id: POST, agent: { name: 'Ada' }, title: 'My post', body: 'b', created_at: '2026-11-20T10:00:00Z' }),
    replies: [{ author: 'Bo', at: '', id: OTHER, body: 'first' }, { author: 'Ada', at: '', id: THEIRS, body: 'second' }] };
  cr.markCommented('rae', [it]);
  assert.equal(it.replies[1].answered, 'waiting', 'the answered reply in second place was not marked');
  assert.equal(it.replies[0].answered, undefined, 'CONTROL: the unanswered sibling was marked');
  const lines = cr.frame([it], 'heading').split('\n');
  assert.ok(lines.find((l) => l.startsWith('    [1.2]')).endsWith('(' + cr.ANSWER_WAITING_MARK + ')'), 'the nested header does not carry the mark');
  assert.doesNotMatch(lines.find((l) => l.startsWith('    [1.1]')), /answer/, 'CONTROL: the sibling header mentions an answer');
  assert.equal(it.commented, undefined, 'a --reply-to answer marked the post');
});

test('#8845 item 1: unreadable records with only replies listed say replies are not marked either', () => {
  const only = [replyEntry(THEIRS)];
  assert.match(cr.commentNote(false, only), /no reply is marked as one you answered\.$/);
  assert.doesNotMatch(cr.commentNote(false, only), /no post is marked/, 'a list of replies alone named posts');
  const both = [cr.itemOf({ id: POST, agent: { name: 'Ada' }, title: 't', body: 'b', created_at: '2026-11-20T10:00:00Z' }), replyEntry(THEIRS)];
  assert.match(cr.commentNote(false, both), /no post is marked as one you commented on and no reply is marked as one you answered\.$/);
  assert.equal(cr.commentNote(true, only), null, 'CONTROL: readable records add no note');
});

test('#8845 item 1: a sent answer reads "you answered this reply"; a refused one marks nothing', () => {
  const r = answer('rae', THEIRS);
  const id = String(r.id || (r.comment && r.comment.id) || '');
  assert.ok(id, 'fixture: no stored comment id in ' + JSON.stringify(r));
  writeJson(cs._paths.commentsSentFile(), { [id]: { state: 'sent', remoteId: '5e1b2c3d-0000-4000-8000-000000000005', at: new Date().toISOString() } });
  let items = [replyEntry(THEIRS)];
  cr.markCommented('rae', items);
  assert.equal(items[0].answered, 'there', 'a sent answer: ' + JSON.stringify(status.itemsFor('rae')));
  assert.ok(header(items[0]).endsWith('(' + cr.ANSWERED_MARK + ')'));
  writeJson(cs._paths.commentsSentFile(), { [id]: { state: 'refused', at: new Date().toISOString() } });
  items = [replyEntry(THEIRS)];
  cr.markCommented('rae', items);
  assert.equal(items[0].answered, undefined, 'CONTROL: a refused answer is not there and will not be, so it marks nothing');
});

test('#8845 item 2: the beyond-floor prompt says the last post is within the day, makes "optional" depend on it having gone out, and keeps its rules', () => {
  assert.match(ct.TURN_TEXT, new RegExp('^Kosmos here: your last post to the Kosmos\\+ community was ' + (ct.TURN_GAP_MS / 3600e3)
    + ' hours ago or more, within the last 24 hours\\. Check it with kosmos community status\\. '));
  // Round 8: the opt-out may only follow "went out", never the refused case, which owes the post (#5315's rule).
  const t = ct.TURN_TEXT;
  const refused = t.indexOf('If it was refused'); const held = t.indexOf('If it is held'); const out = t.indexOf('If it went out');
  assert.ok(refused > 0 && refused < held && held < out, 'the three cases are not in order: ' + t);
  assert.doesNotMatch(t.slice(refused, out), /do nothing|optional/, 'the refused or held case carries an opt-out');
  assert.match(t.slice(out), /another one is optional/);
  assert.match(t.slice(out), /do nothing/, 'the opt-out left the went-out case');
  assert.match(t.slice(held, out), /with your person and nothing more is needed/);
  // postedToday counts a post in any state (held, refused), so a refused one is said to leave the day's post owed.
  assert.match(ct.TURN_TEXT, /If it was refused, your post for the day is still owed: post now with /);
  // "Your post for the day" is one post: if the floor is ever raised, this fails and the wording must change with it.
  assert.equal(require('./communityblock').FLOORS.postsPerDayMin, 1, 'the floor changed: reword "your post for the day" in TURN_TEXT');
  assert.doesNotMatch(ct.TURN_TEXT, /If you have not posted in the last day/, 'a sentence that can never be true for this prompt\'s reader');
  assert.match(ct.TURN_TEXT, /do nothing/);
  assert.match(ct.TURN_TEXT, /Never invent/);
  assert.match(ct.TURN_TEXT, new RegExp((ct.TURN_GAP_MS / 3600e3) + ' hours ago or more'));
  // The below-floor prompt is untouched by this branch; checked so a later edit cannot copy the opt-out into it.
  assert.doesNotMatch(ct.FLOOR_TEXT, /post for the day is done|optional|do nothing/);
  assert.ok(![0x2014, 0x2013].some((c) => ct.TURN_TEXT.includes(String.fromCharCode(c))), 'a dash in product copy');
});

test('#8845 item 3: the unchanged-counts line names the counts it holds (no vote line carries it since kosmos#9015)', () => {
  const u = nudge.COUNTS_UNCHANGED;
  assert.match(u, /^Your community counts for the last 24 hours are the same as when Kosmos last showed them /);
  assert.doesNotMatch(u, /vote/);
  assert.match(u, /kosmos community home/);
  assert.ok(![0x2014, 0x2013].some((c) => u.includes(String.fromCharCode(c))), 'a dash in product copy');
});
