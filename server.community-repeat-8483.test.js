'use strict';
/*
 * kosmos#8483: a comment or post sent again after a cut answer ("it may have been taken") must not become a second
 * public copy. The board sends each row at most once and the community service keeps every repeat (measured on the
 * card), so the board's intake answers the same words for the same place with the row it already holds, and stores
 * nothing. Every "it is a repeat" below has a control beside it that differs in one thing and IS stored, so a route that
 * refused everything, or matched on too little, fails here.
 *
 *   node --test server.community-repeat-8483.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-repeat-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-repeat-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-repeat-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-repeat-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-repeat-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
require('./engine/communitynudge').nudge = async () => null;   // the after-comment line is its own test's subject
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communitystore = require('./engine/communitystore');
const communitysend = require('./engine/communitysend');
const communityswitch = require('./engine/communityswitch');

test.before(async () => { await start(0); communityswitch.setOn(true); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const POST_A = '1b2c3d4e-0000-4000-8000-0000000000a1';
const POST_B = '1b2c3d4e-0000-4000-8000-0000000000b2';
const PARENT = '1b2c3d4e-0000-4000-8000-0000000000c3';
const LEAK = 'mail me at leaky@example.com';
const send = (route, tok, body) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
  body: JSON.stringify(body),
});
const comment = async (tok, body, extra = {}) => {
  const r = await send('/api/community/service-comment', tok, { kind: 'community_post', servicePostId: POST_A, body, at: new Date().toISOString(), ...extra });
  return { status: r.status, j: await r.json() };
};
const post = async (tok, body, extra = {}) => {
  const r = await send('/api/community/post', tok, { kind: 'community_post', topic: 'A title', body, at: new Date().toISOString(), channel: 'engineering', ...extra });
  return { status: r.status, j: await r.json() };
};
const comments = () => (fs.existsSync(communitystore._paths.commentsFile()) ? JSON.parse(fs.readFileSync(communitystore._paths.commentsFile(), 'utf8')) : []);
const posts = () => (fs.existsSync(communitystore._paths.postsFile()) ? JSON.parse(fs.readFileSync(communitystore._paths.postsFile(), 'utf8')) : []);
const mine = (rows, agent, body) => rows.filter((r) => r.agent === agent && r.body === body);
const writeJson = (file, data) => {
  assert.ok(file.startsWith(SANDBOX + path.sep), 'refusing to write a record outside this test\'s sandbox');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
};
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
// One agent per test: the hourly valve and the 24-hour window are per agent, so tests cannot answer for each other.
const agentFor = (t, name) => {
  const b = fleet.install([fleet.agent(name, { state: 'idle' })]);
  t.after(() => b.restore());
  return sendertoken.mint(name).token;
};

test('kosmos#8483: the same comment sent again (its first answer lost) is answered with the first, and only one is stored', async (t) => {
  const tok = agentFor(t, 'Resender');
  const first = await comment(tok, 'Tuesdays work for us too.');
  assert.equal(first.status, 200, JSON.stringify(first.j));
  assert.equal(first.j.status, 'published');
  assert.equal('repeat' in first.j, false, 'control: the first send is not a repeat');
  // The agent never saw that answer (a cut reply, exit 3) and sends the same words again.
  const again = await comment(tok, 'Tuesdays work for us too.');
  assert.equal(again.status, 200, JSON.stringify(again.j));
  assert.equal(again.j.repeat, true);
  assert.equal(again.j.id, first.j.id, 'the repeat must name the comment already held');
  assert.equal(again.j.status, 'published');
  assert.equal(mine(comments(), 'Resender', 'Tuesdays work for us too.').length, 1, 'a second row was stored, which the sweep would send as a second public copy');
});

test('kosmos#8483 CONTROL: other words, another post, a reply, or another agent is a new comment, stored', async (t) => {
  const tok = agentFor(t, 'Varied');
  const base = await comment(tok, 'The same idea.');
  assert.equal(base.j.status, 'published');
  for (const [why, body, extra] of [
    ['other words', 'The same idea, again.', {}],
    ['another post', 'The same idea.', { servicePostId: POST_B }],
    ['a reply to a comment', 'The same idea.', { serviceParentId: PARENT }],
  ]) {
    const r = await comment(tok, body, extra);
    assert.equal(r.status, 200, why + ': ' + JSON.stringify(r.j));
    assert.equal('repeat' in r.j, false, why + ' was taken as a repeat');
    assert.notEqual(r.j.id, base.j.id, why + ' was answered with the first comment');
  }
  // And the reply, sent again, IS a repeat of the reply (the parent is part of the place).
  const reply = await comment(tok, 'The same idea.', { serviceParentId: PARENT });
  assert.equal(reply.status, 200, JSON.stringify(reply.j));
  assert.equal(reply.j.repeat, true, 'a reply sent twice was stored twice');
  // Last: installing another agent's roster ends this one's (the fleet helper installs one roster at a time).
  const other = await comment(agentFor(t, 'Bystander'), 'The same idea.');
  assert.equal(other.status, 200, JSON.stringify(other.j));
  assert.equal('repeat' in other.j, false, 'another agent\'s same words were taken as this agent\'s repeat');
});

test('kosmos#8483: a held comment sent again is the held one (it waits for the person); a leak is not re-scanned into a second row', async (t) => {
  const tok = agentFor(t, 'Leaky');
  const first = await comment(tok, LEAK);
  assert.equal(first.j.status, 'held');
  const again = await comment(tok, LEAK);
  assert.equal(again.j.repeat, true);
  assert.equal(again.j.status, 'held', 'quarantined reads as held to the agent, a repeat included');
  assert.equal(again.j.id, first.j.id);
  assert.equal(comments().filter((c) => c.agent === 'Leaky').length, 1);
});

test('kosmos#8483: a comment taken back, refused, withheld or marked never to go does not stand, so the same words are stored again', async (t) => {
  // One agent per case: the board's hourly valve (10 writes an hour) must never be what answers.
  const roster = ['TakesBack', 'Refused', 'Withheld', 'NotSent', 'Deleted', 'Sent', 'Unconfirmed', 'Tried'];
  const b = fleet.install(roster.map((n) => fleet.agent(n, { state: 'idle' })));
  t.after(() => b.restore());
  const tokOf = (n) => sendertoken.mint(n).token;
  const words = 'Words I may have sent.';
  // Taken back: its removal request is recorded.
  const a = await comment(tokOf('TakesBack'), words);
  writeJson(communitysend._paths.commentDeletesFile(), { ...readJson(communitysend._paths.commentDeletesFile()), [a.j.id]: { at: new Date().toISOString() } });
  const ra = await comment(tokOf('TakesBack'), words);
  assert.equal(ra.status, 200, JSON.stringify(ra.j));
  assert.equal('repeat' in ra.j, false, 'a comment taken back was answered as still standing');
  const record = (id, agent, rec) => writeJson(communitysend._paths.commentsSentFile(), { ...readJson(communitysend._paths.commentsSentFile()), [id]: { ...rec, agent, post: POST_A } });
  // Refused, withheld, never-to-go, removed: their send records say so.
  for (const [agent, state] of [['Refused', 'refused'], ['Withheld', 'withheld'], ['NotSent', 'not_sent'], ['Deleted', 'deleted']]) {
    const c = await comment(tokOf(agent), words);
    record(c.j.id, agent, { state });
    const r = await comment(tokOf(agent), words);
    assert.equal(r.status, 200, state + ': ' + JSON.stringify(r.j));
    assert.equal('repeat' in r.j, false, `a comment whose record says ${state} was answered as still standing`);
    assert.equal(mine(comments(), agent, words).length, 2, `${state}: the new words were not stored`);
  }
  // CONTROL: sent, unconfirmed, and pending-but-tried all stand.
  for (const [agent, rec] of [['Sent', { state: 'sent' }], ['Unconfirmed', { state: 'unconfirmed' }], ['Tried', { state: 'pending', attempted: true }]]) {
    const c = await comment(tokOf(agent), words);
    record(c.j.id, agent, rec);
    const r = await comment(tokOf(agent), words);
    assert.equal(r.status, 200, JSON.stringify(rec) + ': ' + JSON.stringify(r.j));
    assert.equal(r.j.repeat, true, `a comment whose record says ${JSON.stringify(rec)} was stored again`);
    assert.equal(mine(comments(), agent, words).length, 1);
  }
});

test('kosmos#8483: a comment told "it will not go" (made while Community was off) does not stand once Community is on again', async (t) => {
  const tok = agentFor(t, 'WhileOff');
  communitystore.grantTrust('WhileOff');
  communityswitch.setOn(false);
  let off;
  try { off = await comment(tok, 'Said while off.'); } finally { communityswitch.setOn(true); }
  assert.equal(off.j.sends, false, 'control: it was told it will not go');
  const on = await comment(tok, 'Said while off.');
  assert.equal('repeat' in on.j, false, 'the same words, now that it would go, were answered with the one that never will');
  assert.equal(on.j.sends, true);
});

test('kosmos#8483: a comment row marked never to go (the mark alone, with no send record) does not stand', async (t) => {
  // The row's mark is the authoritative one (its send record is best effort, and #4994 marks only rows), so it must
  // decide by itself.
  const tok = agentFor(t, 'MarkedRow');
  const c = await comment(tok, 'Marked on the row only.');
  assert.equal(communitystore.markServiceCommentNotSent(c.j.id), true);
  assert.equal(c.j.id in readJson(communitysend._paths.commentsSentFile()), false, 'control: no send record says it will not go');
  const r = await comment(tok, 'Marked on the row only.');
  assert.equal('repeat' in r.j, false, 'answered with a comment marked never to go');
  // CONTROL: the same arrangement without the mark is a repeat.
  await comment(tok, 'Not marked.');
  assert.equal((await comment(tok, 'Not marked.')).j.repeat, true);
});

test('kosmos#8483: a published comment never tried, from an ON period that has ended, does not stand', async (t) => {
  const tok = agentFor(t, 'OldPeriod');
  const c = await comment(tok, 'From an earlier period.');
  assert.equal(c.j.sends, true);
  // The period it was made in ended and a new one began after it (an OFF and ON); the sweep never sends it now.
  const st = communitysend._paths.stateFile();
  const had = fs.readFileSync(st);
  try {
    writeJson(st, { ...JSON.parse(had), since: new Date(Date.now() + 1000).toISOString() });
    assert.equal('repeat' in (await comment(tok, 'From an earlier period.')).j, false, 'answered with a comment the sweep will never send');
  } finally { fs.writeFileSync(st, had); }
  // CONTROL: inside the running period, the same words are a repeat.
  assert.equal((await comment(tok, 'From an earlier period, inside it.')).j.repeat, undefined);
  assert.equal((await comment(tok, 'From an earlier period, inside it.')).j.repeat, true);
});

test('kosmos#8483: an earlier comment more than a day old is not matched', async (t) => {
  const tok = agentFor(t, 'NextDay');
  const first = await comment(tok, 'Good morning.');
  const file = communitystore._paths.commentsFile();
  const rows = comments();
  rows.find((r) => r.id === first.j.id).receivedAt = new Date(Date.now() - communitysend.REPEAT_WINDOW_MS - 60 * 1000).toISOString();
  writeJson(file, rows);
  // Its send record says sent, so the age is the only thing that makes it not a repeat.
  writeJson(communitysend._paths.commentsSentFile(), { ...readJson(communitysend._paths.commentsSentFile()), [first.j.id]: { state: 'sent', agent: 'NextDay', post: POST_A } });
  assert.equal('repeat' in (await comment(tok, 'Good morning.')).j, false, 'a day-old comment was taken as this one');
});

test('kosmos#8483: when the record that decides it cannot be read, nothing is stored and the agent is asked to try again', async (t) => {
  const tok = agentFor(t, 'Unread');
  await comment(tok, 'Read me.');
  const file = communitysend._paths.commentsSentFile();
  const had = fs.existsSync(file) ? fs.readFileSync(file) : null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    const before = comments().length;
    const r = await comment(tok, 'Read me.');
    assert.equal(r.status, 503, JSON.stringify(r.j));
    assert.match(r.j.error, /could not tell whether it already has this one/);
    assert.equal(comments().length, before, 'a comment was stored while the board could not tell whether it was a repeat');
    // CONTROL: words it has never seen are not a question of repeats, so the unreadable record does not stop them here.
    assert.equal((await comment(tok, 'Brand new words.')).status, 200);
  } finally { if (had) fs.writeFileSync(file, had); else fs.rmSync(file, { force: true }); }
});

test('kosmos#8483: the same post sent again is answered with the first; another channel or title is a new post', async (t) => {
  const tok = agentFor(t, 'Poster');
  const first = await post(tok, 'What I learned today, at length.');
  assert.equal(first.status, 200, JSON.stringify(first.j));
  assert.equal(first.j.status, 'published');
  assert.equal('repeat' in first.j, false);
  const again = await post(tok, 'What I learned today, at length.');
  assert.equal(again.j.repeat, true);
  assert.equal(again.j.id, first.j.id);
  assert.equal(mine(posts(), 'Poster', 'What I learned today, at length.').length, 1, 'a second post was stored');
  for (const [why, extra] of [['another channel', { channel: 'research' }], ['another title', { topic: 'Another title' }]]) {
    const r = await post(tok, 'What I learned today, at length.', extra);
    assert.equal(r.status, 200, why + ': ' + JSON.stringify(r.j));
    assert.equal('repeat' in r.j, false, why + ' was taken as a repeat');
  }
});

test('kosmos#8483: a post taken back does not stand, so the same words are posted again', async (t) => {
  const tok = agentFor(t, 'PostBack');
  const first = await post(tok, 'A post I took back.');
  writeJson(communitysend._paths.deletesFile(), { ...readJson(communitysend._paths.deletesFile()), [first.j.id]: { at: new Date().toISOString() } });
  const again = await post(tok, 'A post I took back.');
  assert.equal('repeat' in again.j, false, 'a post taken back was answered as still standing');
  assert.equal(mine(posts(), 'PostBack', 'A post I took back.').length, 2);
});

test('kosmos#8483: a held post sent again is the held one; the post route also refuses (503, nothing stored) when its records cannot be read', async (t) => {
  const tok = agentFor(t, 'HeldPoster');
  const held = await post(tok, LEAK);
  assert.equal(held.j.status, 'held');
  const again = await post(tok, LEAK);
  assert.equal(again.j.repeat, true);
  assert.equal(again.j.status, 'held');
  assert.equal(again.j.id, held.j.id);
  const pub = await post(tok, 'A published post to read back.');
  for (const file of [communitysend._paths.sentFile(), communitysend._paths.deletesFile()]) {
    const had = fs.existsSync(file) ? fs.readFileSync(file) : null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{not json');
      const before = posts().length;
      const r = await post(tok, 'A published post to read back.');
      assert.equal(r.status, 503, path.basename(file) + ': ' + JSON.stringify(r.j));
      assert.match(r.j.error, /could not tell whether it already has this one/);
      assert.equal(posts().length, before, path.basename(file) + ': a post was stored while the board could not tell');
    } finally { if (had) fs.writeFileSync(file, had); else fs.rmSync(file, { force: true }); }
  }
  assert.equal((await post(tok, 'A published post to read back.')).j.id, pub.j.id, 'control: readable again, it is the repeat');
});

test('kosmos#8483: the store matches a community and a company exactly (a company post or comment is never another company\'s or the public one)', () => {
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const at = new Date().toISOString();
  const cfile = communitystore._paths.commentsFile();
  const pfile = communitystore._paths.postsFile();
  const keepC = fs.existsSync(cfile) ? fs.readFileSync(cfile) : null;
  const keepP = fs.existsSync(pfile) ? fs.readFileSync(pfile) : null;
  try {
    const crow = { id: 'c-org1', remotePostId: POST_A, remoteParentId: null, status: 'published', agent: 'Spaced', body: 'Words.', receivedAt: at, space: 'company', org: 'org-1' };
    writeJson(cfile, [crow]);
    const want = { agent: 'Spaced', remotePostId: POST_A, body: 'Words.' };
    assert.equal(communitystore.repeatServiceComment({ ...want, space: 'company', org: 'org-1' }, since).id, 'c-org1', 'control: the same company matches');
    assert.equal(communitystore.repeatServiceComment({ ...want, space: 'company', org: 'org-2' }, since), null, 'another company matched');
    assert.equal(communitystore.repeatServiceComment(want, since), null, 'the public community matched a company comment');
    const prow = { id: 'p-org1', status: 'published', agent: 'Spaced', author: { type: 'agent', name: 'Spaced' }, topic: 'T', body: 'Words.', board: 'engineering', receivedAt: at, space: 'company', org: 'org-1' };
    writeJson(pfile, [prow]);
    const pwant = { agent: 'Spaced', topic: 'T', body: 'Words.', board: 'engineering' };
    assert.equal(communitystore.repeatAgentPost({ ...pwant, space: 'company', org: 'org-1' }, since).id, 'p-org1', 'control: the same company matches');
    assert.equal(communitystore.repeatAgentPost({ ...pwant, space: 'company', org: 'org-2' }, since), null, 'another company matched');
    assert.equal(communitystore.repeatAgentPost(pwant, since), null, 'the public community matched a company post');
    assert.equal(communitystore.repeatAgentPost({ ...pwant, space: 'company', org: 'org-1', links: ['https://example.com/a'] }, since), null, 'other links matched');
  } finally {
    if (keepC) fs.writeFileSync(cfile, keepC); else fs.rmSync(cfile, { force: true });
    if (keepP) fs.writeFileSync(pfile, keepP); else fs.rmSync(pfile, { force: true });
  }
});
