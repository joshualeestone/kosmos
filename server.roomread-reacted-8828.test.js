'use strict';
/**
 * kosmos#8828 item 1: a reaction does not answer a post addressed to the reader (engine/defaults.js), so on
 * `kosmos room <id> --unanswered` such a post stays listed, and a line under the list names the ones the reader reacted
 * to and says why, so the reaction is not read as lost. Follows #4926 and #7848.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reacted-8828-'));
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
const CLAIMER = 'claimseat';
const BYSTANDER = 'otherseat';
const POSTER = 'askerseat';
function newRoom(name) {
  const p = projects.create({ name });
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  for (const n of [ME, CLAIMER, BYSTANDER, POSTER]) projects.addAgent(p.id, n, roster);
  return p.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, CLAIMER, BYSTANDER, POSTER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
let clock = Date.now() - 60 * 60000;
const append = (row) => { fs.mkdirSync(path.dirname(messages.LOG), { recursive: true }); fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n'); };
function post(project, fields) {
  const id = 'm' + (88280 + (++seq));
  clock += 1000;
  append(Object.assign({ id, kind: 'post', from: POSTER, to: [ME, CLAIMER], project, text: 'row ' + id, at: new Date(clock).toISOString(), outcomes: {} }, fields));
  return id;
}
/* A claim, as react() writes one (`claim: true` is what makes a 🙋 a claim). */
function claim(project, of, from, op) {
  clock += 1000;
  append({ kind: 'reaction', project, of, at: new Date(clock).toISOString(), emoji: '\u{1F64B}', op: op || 'add', from, ...(op === 'remove' ? {} : { claim: true }) });
}
const room = async (project, who, query) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, { headers: who ? { 'x-kosmos-agent-token': sendertoken.mint(who).token } : {} });
  return { status: res.status, text: await res.text() };
};
const listed = (text, id) => text.split('\n').some((l) => l.includes('[' + id + '] ' + POSTER));

function react(project, of, from, emoji, op) {
  clock += 1000;
  append({ kind: 'reaction', project, of, at: new Date(clock).toISOString(), emoji, op: op || 'add', from });
}

const REACTED = '[kosmos] You reacted to ';
const reactedLine = (text) => text.split('\n').find((l) => l.startsWith(REACTED)) || '';

test('kosmos#8828: a post I reacted to stays listed, and the list says why', async () => {
  const pid = newRoom('Reacted8828a');
  const confirm = post(pid, { text: '@readerseat noted, I take the deposit clause and you keep the rent clause.', mentioned: [ME] });
  const plain = post(pid, { text: '@readerseat the lease is in the folder.', mentioned: [ME] });
  let r = await room(pid, ME, '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  assert.equal(reactedLine(r.text), '', 'CONTROL: no reaction yet, no line:\n' + r.text);
  react(pid, confirm, ME, '\u{1F44D}');
  r = await room(pid, ME, '&unanswered=1');
  assert.ok(listed(r.text, confirm) && listed(r.text, plain), 'a reaction answered a post addressed to me:\n' + r.text);
  const line = reactedLine(r.text);
  assert.ok(line.includes('[' + confirm + ']') && !line.includes('[' + plain + ']'), 'the line does not name exactly the post I reacted to:\n' + r.text);
  assert.match(line, /a reaction does not take a post off this list/);
  assert.ok(line.includes('kosmos post --in-reply-to ' + confirm + ' ' + pid + ' <your answer>.'), 'the command is not runnable as printed:\n' + line);
  assert.match(line, /If it was only confirming something already settled, your reaction answered that/, 'a confirmation is told to post "agreed":\n' + line);
  assert.ok(!/days/.test(line), 'the line claims how long the post stays listed (wrong under --all):\n' + line);
  const plainRead = await room(pid, ME, '');
  assert.equal(plainRead.status, 200, plainRead.text);
  assert.equal(reactedLine(plainRead.text), '', 'a plain read carries the line:\n' + plainRead.text);
});

test('kosmos#8828: several emojis, one removed, still named; two posts get the placeholder; a post cut by -n is not named', async () => {
  const pid = newRoom('Reacted8828d');
  const cut = post(pid, { text: '@readerseat the inspection is booked.', mentioned: [ME] });
  const multi = post(pid, { text: '@readerseat the deposit is paid.', mentioned: [ME] });
  const second = post(pid, { text: '@readerseat the utilities are in your name.', mentioned: [ME] });
  react(pid, cut, ME, '\u{1F44D}');
  react(pid, multi, ME, '\u{1F440}');
  react(pid, multi, ME, '\u{1F44D}');
  react(pid, multi, ME, '\u{1F44D}', 'remove');
  react(pid, second, ME, '\u{2705}');
  let r = await room(pid, ME, '&unanswered=1');
  let line = reactedLine(r.text);
  assert.ok([cut, multi, second].every((x) => line.includes('[' + x + ']')), 'a post with a live reaction is not named:\n' + r.text);
  assert.ok(line.includes('kosmos post --in-reply-to <its id> ' + pid + ' <your answer>. If one was only confirming'), 'several posts: the command is not the placeholder form:\n' + line);
  r = await room(pid, ME, '&unanswered=1&n=1');
  assert.ok(listed(r.text, second) && !listed(r.text, cut), 'fixture: -n 1 lists only the newest:\n' + r.text);
  line = reactedLine(r.text);
  assert.ok(line.includes('[' + second + ']') && !line.includes('[' + cut + ']') && !line.includes('[' + multi + ']'), 'a post cut by -n is named:\n' + r.text);
});

test('kosmos#8828: a claim, a reaction taken back, another agent\'s, or one in another room is not named', async () => {
  const pid = newRoom('Reacted8828b');
  const other = newRoom('Reacted8828c');
  const claimed = post(pid, { text: '@readerseat the lease draft is in the shared folder.', mentioned: [ME] });
  const takenBack = post(pid, { text: '@readerseat the signing is moved to Monday.', mentioned: [ME] });
  const others = post(pid, { text: '@readerseat the landlord agreed to the date.', mentioned: [ME] });
  const elsewhere = post(pid, { text: '@readerseat the keys are at the office.', mentioned: [ME] });
  const oldHand = post(pid, { text: '@readerseat the parking pass is ready.', mentioned: [ME] });
  const toneHand = post(pid, { text: '@readerseat the mail is forwarded.', mentioned: [ME] });
  claim(pid, claimed, ME);
  react(pid, oldHand, ME, '\u{1F64B}');   // a raised hand from before claims were marked (no claim: true)
  react(pid, toneHand, ME, '\u{1F64B}\u{1F3FD}');   // a skin-tone raised hand, unmarked
  react(pid, takenBack, ME, '\u{1F44D}');
  react(pid, takenBack, ME, '\u{1F44D}', 'remove');
  react(pid, others, BYSTANDER, '\u{1F44D}');
  react(other, elsewhere, ME, '\u{1F44D}');
  const r = await room(pid, ME, '&unanswered=1');
  assert.equal(reactedLine(r.text), '', 'one of these was named as my reaction:\n' + r.text);
  assert.ok([claimed, takenBack, others, elsewhere].every((x) => listed(r.text, x)), 'fixture: these stay listed:\n' + r.text);
});

test('kosmos#8828 review 4: the person\'s post I reacted to is named, but never as answered by the reaction', async () => {
  const pid = newRoom('Reacted8828e');
  clock += 1000;
  const mine = 'm' + (88280 + (++seq));
  append({ id: mine, kind: 'post', from: 'you', operator: true, to: [ME], project: pid, text: '@readerseat thanks, that is settled.', mentioned: [ME], at: new Date(clock).toISOString(), outcomes: { [ME]: 'typed' } });
  react(pid, mine, ME, '\u{1F44D}');
  const r = await room(pid, ME, '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  const line = reactedLine(r.text);
  assert.ok(line.includes('[' + mine + ']'), 'fixture: the person\'s post I reacted to is named:\n' + r.text);
  assert.ok(line.startsWith(REACTED + 'the person\'s [' + mine + '], but a reaction never answers the person'), 'the person\'s line:\n' + line);
  assert.ok(line.endsWith('Answer with a post that cites it: kosmos post --in-reply-to ' + mine + ' ' + pid + ' <your answer>'), 'no way to answer it:\n' + line);
  assert.ok(!/\bIf\b|reaction answered|nothing more is needed|confirming/.test(line), 'the person\'s post reads as maybe answered by a reaction:\n' + line);
  const colleagues = r.text.split('\n').filter((l) => l.startsWith(REACTED));
  assert.equal(colleagues.length, 1, 'CONTROL: only the person\'s line, no colleague line:\n' + r.text);
});

test('kosmos#8828 review 6: the person\'s post and a colleague\'s, both reacted to, get one line each', async () => {
  const pid = newRoom('Reacted8828f');
  const colleague = post(pid, { text: '@readerseat noted, the rent clause is yours.', mentioned: [ME] });
  clock += 1000;
  const persons = 'm' + (88280 + (++seq));
  append({ id: persons, kind: 'post', from: 'you', operator: true, to: [ME], project: pid, text: '@readerseat thanks, settled.', mentioned: [ME], at: new Date(clock).toISOString(), outcomes: { [ME]: 'typed' } });
  react(pid, colleague, ME, '\u{1F44D}');
  react(pid, persons, ME, '\u{1F44D}');
  const r = await room(pid, ME, '&unanswered=1');
  const lines = r.text.split('\n').filter((l) => l.startsWith(REACTED));
  assert.equal(lines.length, 2, r.text);
  assert.ok(lines[0].includes('the person\'s [' + persons + ']') && !lines[0].includes(colleague), lines[0]);
  assert.ok(lines[1].includes('[' + colleague + ']') && !lines[1].includes(persons) && /only confirming/.test(lines[1]), lines[1]);
});

test('kosmos#8828 review 7: a post I claimed and also reacted to is not told nothing more is needed', async () => {
  const pid = newRoom('Reacted8828g');
  const mine = post(pid, { text: '@readerseat can you redo the deposit figures?', mentioned: [ME] });
  const plain = post(pid, { text: '@readerseat noted, the rent clause is yours.', mentioned: [ME] });
  claim(pid, mine, ME);
  react(pid, mine, ME, '\u{1F440}');
  react(pid, plain, ME, '\u{1F44D}');
  let r = await room(pid, ME, '&unanswered=1');
  let line = reactedLine(r.text);
  assert.ok(line.includes('[' + plain + ']') && !line.includes('[' + mine + ']'), 'a post I claimed is named on the reaction line:\n' + r.text);
  claim(pid, mine, ME, 'remove');
  r = await room(pid, ME, '&unanswered=1');
  line = reactedLine(r.text);
  assert.ok(line.includes('[' + mine + ']'), 'CONTROL: once the hand is down, the reaction names it again:\n' + r.text);
});
