'use strict';
/* kosmos#5842: after a task message is sent, the task page says which assignees it did NOT reach (not told, kept for
 * later, or not confirmed), from the route's `delivered` list. A send that reached everyone adds nothing. Runs the
 * page's own tkSayPost against a stub DOM and fetch, as web.task-composer-768.test.js does.
 *   node --test web.task-say-outcome-5842.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  if (SCRIPT.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

/* Send one message whose answer carries `delivered`; return what the line under the box says. */
async function send(delivered, { ok = true, agents = [] } = {}) {
  const input = { value: 'the price moved' };
  const msg = { textContent: 'left over from before' };
  const go = { disabled: false };
  const els = { 'tk-say': input, 'tk-say-msg': msg, 'tk-say-go': go };
  const project = { id: 'p1', agents };
  let painted = 0;
  globalThis.TK_OPEN = 7;
  const body = ok ? { ok: true, delivered, summary: 'for agents' } : { error: 'refused' };
  const tkSayPost = new Function(
    'document', 'pjById', 'PJ_CURRENT', 'fetch', 'paintTaskActivity', 'encodeURIComponent',
    fnSource('tkMemberName') + '\n' + fnSource('quotaResetWords') + '\n' + fnSource('tkSayPost') + '\n; return tkSayPost;',
  )({ getElementById: (id) => els[id] || null }, () => project, project.id,
    async () => ({ ok, json: async () => body }), () => { painted += 1; }, encodeURIComponent);
  await tkSayPost();
  return { said: msg.textContent, input, go, painted };
}

test('#5842: a message every assignee was told says nothing more (the activity shows it)', async () => {
  const r = await send([{ agent: 'mara', state: 'placed' }, { agent: 'casey', state: 'placed' }]);
  assert.equal(r.said, '', 'a fully told send left a line, or kept the old one');
  assert.equal(r.input.value, '', 'CONTROL: the send succeeded (the box cleared)');
  assert.equal(r.painted, 1);
});

test('#5842: an assignee switched off in the project is named with the board\'s own reason', async () => {
  const r = await send([
    { agent: 'mara', state: 'placed' },
    { agent: 'casey', state: 'could_not', because: 'casey is switched off in this project. Switch it on in the project\'s members to send it work here.' },
  ]);
  assert.equal(r.said, 'casey is switched off in this project. Switch it on in the project\'s members to send it work here.');
  assert.doesNotMatch(r.said, /mara/, 'an agent that was told is listed');
});

test('#5842: a reason that does not name the agent gets the name in front', async () => {
  const r = await send([{ agent: 'casey', state: 'could_not', because: 'its window is scrolled back right now' }]);
  assert.equal(r.said, 'casey was not told: its window is scrolled back right now.');
  const bare = await send([{ agent: 'casey', state: 'could_not' }]);
  assert.equal(bare.said, 'casey was not told.');
});

test('#5842: a message kept for an agent out of usage says when, in local time, never the board\'s UTC stamp', async () => {
  // The route's real shape on limittask-5805: state 'held', heldUntil an ISO time, because carrying that same raw time.
  const until = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const r = await send([{ agent: 'casey', state: 'held', heldUntil: until, because: 'held: casey is out of usage until ' + until + '; Kosmos types it after the reset' }]);
  assert.match(r.said, /^casey is out of usage until .+\. Kosmos sends it your message then\.$/);
  assert.ok(!r.said.includes(until) && !/\dT\d/.test(r.said), 'the raw UTC time reached the screen: ' + r.said);
  const behind = await send([{ agent: 'casey', state: 'held', heldUntil: null, because: 'held: casey still has messages kept from while it was out of usage; Kosmos types this one after them' }]);
  assert.equal(behind.said, 'casey gets your message after the ones already waiting for it.');
  const noTime = await send([{ agent: 'casey', state: 'held', heldUntil: null, because: 'held: casey is out of usage; Kosmos types it after the reset' }]);
  assert.equal(noTime.said, 'casey is out of usage. Kosmos sends it your message after the reset.');
  assert.doesNotMatch(r.said + behind.said + noTime.said, /not told|Do not send/, 'a kept message reads as a failure or carries the agents\' instruction');
});

test('#5842: a delivery Kosmos could not confirm is never claimed either way', async () => {
  const r = await send([{ agent: 'casey', state: 'unconfirmed' }, { agent: 'dana' }]);
  assert.equal(r.said, 'Kosmos could not confirm that casey got it. Kosmos could not confirm that dana got it.');
  const why = await send([{ agent: 'casey', state: 'unconfirmed', because: 'part of it reached its window before the send failed, so it may be sitting there half-typed' }]);
  assert.equal(why.said, 'Kosmos could not confirm that casey got it: part of it reached its window before the send failed, so it may be sitting there half-typed.');
});

test('#5842: an agent listed twice gets one line, the worst outcome', async () => {
  const r = await send([{ agent: 'casey', state: 'placed' }, { agent: 'casey', state: 'could_not', because: 'casey is not on this project any more, so it was not told' }]);
  assert.equal(r.said, 'casey is not on this project any more, so it was not told.');
});

test('#5842: the page names an agent by its card name, as the activity does, also inside the board\'s reason', async () => {
  const agents = [{ sessionName: 'casey-bot', name: 'Casey Rivera' }];
  const r = await send([{ agent: 'casey-bot', state: 'could_not', because: 'casey-bot is not on this project any more, so it was not told' }], { agents });
  assert.equal(r.said, 'Casey Rivera is not on this project any more, so it was not told.');
  const other = await send([{ agent: 'casey-bot', state: 'could_not', because: 'its window is scrolled back right now' }], { agents });
  assert.equal(other.said, 'Casey Rivera was not told: its window is scrolled back right now.');
});

test('#5842: a task with no agent on it says nobody was told', async () => {
  const r = await send([]);
  assert.equal(r.said, 'No agent is on this task, so nobody was told.');
});

test('#5842: CONTROL: no delivered list (an older board) and a refused send behave as before', async () => {
  const old = await send(undefined);
  assert.equal(old.said, '', 'an answer with no delivered list left a line');
  const refused = await send([{ agent: 'casey', state: 'could_not' }], { ok: false });
  assert.equal(refused.said, 'refused', 'a refusal no longer shows its error');
  assert.equal(refused.input.value, 'the price moved', 'a refusal cleared the draft');
});
