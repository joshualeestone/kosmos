'use strict';
/**
 * kosmos#8734 item 4 (feedback 11-19): a person's room post reaches every member, so one that @-names only OTHER agents
 * was listed in every reader's `kosmos room <id> --unanswered` as if it asked them. It is listed only for the agents it
 * names. A person's post to the whole room (no name) and one naming the reader stay listed. Follows #4926 and #7848.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-others-8734-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');

let base;
let roster;
const ME = 'readerseat';
const OTHER = 'otherseat';

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, OTHER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function newRoom(name) {
  const p = projects.create({ name });
  // Older than the rows below: a room leaves out rows from before it was made (as server.roomread-aged-7969.test.js).
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  for (const n of [ME, OTHER]) projects.addAgent(p.id, n, roster);
  return p.id;
}
let seq = 0;
const append = (row) => { fs.mkdirSync(path.dirname(messages.LOG), { recursive: true }); fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n'); };
/* A person's post as the room writes it: it reaches every member (`to`), and `mentioned` is who it @-names. */
function personPost(project, text, mentioned) {
  const id = 'm' + (87340 + (++seq));
  append({ id, kind: 'post', operator: true, from: 'operator', to: [ME, OTHER], project, text, ...(mentioned.length ? { mentioned } : {}),
    at: new Date(Date.now() - 60 * 1000).toISOString(), outcomes: { [ME]: 'placed', [OTHER]: 'placed' } });
  return id;
}
const unanswered = async (project, who = ME) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text&unanswered=1`, { headers: { 'x-kosmos-agent-token': sendertoken.mint(who).token } });
  assert.equal(res.status, 200);
  return res.text();
};
// A listed post's own line, never a [kosmos] note about it (those start with a time, then [kosmos]).
const listed = (text, id) => text.split('\n').some((l) => l.includes('[' + id + ']') && !/^\S*\s*\[kosmos\]/.test(l) && !/\s\[kosmos\]\s/.test(l.slice(0, 40)));

test('kosmos#8734 item 4: a person\'s post naming only another agent is not on the reader\'s unanswered list, and is on theirs', async () => {
  const pid = newRoom('Others');
  const toOther = personPost(pid, '@otherseat can you look at the build', [OTHER]);
  const toMe = personPost(pid, '@readerseat and @otherseat, both of you please', [ME, OTHER]);
  const toRoom = personPost(pid, 'anyone free to look at this?', []);
  const mine = await unanswered(pid);
  assert.equal(listed(mine, toOther), false, 'an ask naming only someone else is listed for the reader:\n' + mine);
  // CONTROLS: one naming the reader too, and one to the whole room, stay listed; the named agent still sees its own.
  assert.equal(listed(mine, toMe), true, mine);
  assert.equal(listed(mine, toRoom), true, mine);
  const theirs = await unanswered(pid, OTHER);
  assert.equal(listed(theirs, toOther), true, theirs);
});

test('kosmos#8734 item 4: a person\'s post naming others but also @all, or an @-word it could not place, stays listed', async () => {
  const pid = newRoom('Others2');
  const withAll = personPost(pid, '@all and @otherseat please both look', [OTHER]);
  const unsure = 'm' + (87340 + (++seq));   // an @-word that matched two members is kept apart from the names
  append({ id: unsure, kind: 'post', operator: true, from: 'operator', to: [ME, OTHER], project: pid,
    text: '@seat and @otherseat, have a look', mentioned: [OTHER], ambiguousMentions: ['seat'], at: new Date(Date.now() - 60 * 1000).toISOString(),
    outcomes: { [ME]: 'placed', [OTHER]: 'placed' } });
  const quoted = personPost(pid, 'the `@all` tag is for @otherseat only', [OTHER]);   // CONTROL: @all in a code span is not a broadcast
  // Review 5: named, but asking the room in words (the claim guard's own example): anyone may take it, so it stays listed.
  const roomAsk = personPost(pid, '@otherseat is swamped so somebody else please grab it', [OTHER]);
  const mine = await unanswered(pid);
  assert.equal(listed(mine, withAll), true, '@all was ignored:\n' + mine);
  assert.equal(listed(mine, unsure), true, 'an @-word that may have meant me was ignored:\n' + mine);
  assert.equal(listed(mine, quoted), false, mine);
  assert.equal(listed(mine, roomAsk), true, 'a named post that asks the room in words was hidden:\n' + mine);
  // Review 6: one naming only an agent no longer in the room asks nobody here (the claim guard's reading), so it stays.
  const gone = personPost(pid, '@goneseat can you finish this', ['goneseat']);
  assert.equal(listed(await unanswered(pid), gone), true, 'an ask to an agent that left was hidden from the room');
});
