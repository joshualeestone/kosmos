'use strict';
/**
 * kosmos#9033: the daily feedback ask skips an agent with no day of its own (feedback 11-24: a brand-new agent was asked
 * for a full report with nothing behind it). A day is a word with its person in Kosmos, a task it changed, or a room post
 * or message it sent, today (feedbackday.hadDay); anything unreadable counts as a day (asked as before).
 *
 *   node --test engine/feedbacknudge-9033.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbacknudge-9033-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const feedback = require('./feedback');
const feedbackday = require('./feedbackday');
const nudge = require('./feedbacknudge');
const chat = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const EVENING = new Date(2026, 9, 27, 18, 0, 0);
const TODAY = feedback.dateKey(EVENING);
const at = (h) => new Date(2026, 9, 27, h, 0, 0).toISOString();
const yesterday = new Date(2026, 9, 26, 12, 0, 0).toISOString();
const none = { readThread: () => [], listTaskFiles: () => [], readTask: () => [], readLog: () => ({ ok: true, rows: [] }), replyChannel: () => null };
const day = (extra) => feedbackday.hadDay({ names: ['mara-discord', 'mara'], date: TODAY, ...none, ...extra });

test('#9033 an empty day is no day; each kind of activity today is one', () => {
  assert.equal(day({}), false, 'nothing at all');
  assert.equal(day({ readThread: () => [{ text: 'hi', at: at(9) }] }), true, 'the person wrote to it');
  assert.equal(day({ readThread: () => [{ text: 'done', from: 'mara-discord', at: at(9) }] }), true, 'it wrote to its person');
  assert.equal(day({ listTaskFiles: () => ['proj.task-3.jsonl'], readTask: () => [{ kind: 'built', by: 'mara', at: at(10) }] }), true, 'a task it changed');
  assert.equal(day({ readLog: () => ({ ok: true, rows: [{ kind: 'post', from: 'mara', at: at(11), project: 'p' }] }) }), true, 'a room post');
  assert.equal(day({ readLog: () => ({ ok: true, rows: [{ kind: 'message', from: 'mara-discord', at: at(11) }] }) }), true, 'a message to another agent');
  /* CONTROLS: yesterday, another agent, Kosmos's own lines, and the person marking a task are not this agent's day. */
  assert.equal(day({ readThread: () => [{ text: 'hi', at: yesterday }] }), false, 'yesterday');
  assert.equal(day({ readLog: () => ({ ok: true, rows: [{ kind: 'post', from: 'ada', at: at(11) }, { kind: 'post', from: 'mara', at: yesterday }] }) }), false, 'another agent today, or itself yesterday');
  assert.equal(day({ readThread: () => [{ text: 'hello', at: at(9), automatic: true }, { text: 'note', at: at(9), kosmos: true }] }), false, 'the wake hello and Kosmos\'s own line');
  assert.equal(day({ listTaskFiles: () => ['proj.task-3.jsonl'], readTask: () => [{ kind: 'built', by: 'mara', person: true, at: at(10) }] }), false, 'a mark the person made');
  assert.equal(day({ readLog: () => ({ ok: true, rows: [{ kind: 'reaction', from: 'mara', at: at(11) }] }) }), false, 'a reaction is not a post');
});

test('#9033 it fails open: anything unreadable, or an agent that answers its person elsewhere, has a day', () => {
  const boom = () => { throw new Error('unreadable'); };
  assert.equal(day({ readThread: boom }), true);
  assert.equal(day({ listTaskFiles: boom }), true);
  assert.equal(day({ readLog: boom }), true);
  assert.equal(day({ readLog: () => ({ ok: false, rows: [] }) }), true, 'a log it could not read');
  assert.equal(day({ replyChannel: () => 'Slack' }), true, '#8141: its conversation is where Kosmos cannot see');
  assert.equal(feedbackday.hadDay({ names: [], date: TODAY, ...none }), true, 'no name to read under');
});

test('#9033 the planner asks only an agent with a day; one with none is passed over, and with nobody left nobody is asked', () => {
  const cards = fleet.install([fleet.agent('ada'), fleet.agent('bo')]).agents
    .map((c) => ({ ...c, lastWorked: { at: at(11), why: null } }));
  const base = { roster: cards, send: { on: true, ok: true }, today: TODAY, hour: 18, hasReport: false, askedDate: null, labels: [],
    dateKey: feedback.dateKey, isGuide: () => false, workedOn: TODAY, workers: cards.map((c) => c.sessionName) };
  const only = (name) => (c) => c.sessionName.startsWith(name);
  const asked = nudge.plan({ ...base, hasDay: only('bo') });
  assert.equal(asked.act, 'nudge');
  assert.deepEqual(asked.cards.map((c) => c.sessionName.slice(0, 2)), ['bo'], 'ada had no day');
  const nobody = nudge.plan({ ...base, hasDay: () => false });
  assert.equal(nobody.act, 'none');
  assert.match(nobody.because, /has a day of their own to report on/);
  assert.equal(nudge.plan({ ...base, hasDay: () => { throw new Error('x'); } }).act, 'nudge', 'a check that throws counts as a day');
  assert.equal(nudge.plan({ ...base }).act, 'nudge', 'CONTROL: no check given, as before');
});

test('#9033 the board\'s own tick reads the real day: an agent with nothing is not asked; once its person writes, it is', () => {
  const cards = fleet.install([fleet.agent('cy')]).agents.map((c) => ({ ...c, lastWorked: { at: at(11), why: null } }));
  let sent = 0;
  const memAsked = () => { let d = null; let w = TODAY; let ws = cards.map((c) => c.sessionName);
    return { get: () => d, set: (date) => { d = date; return true; }, workedOn: () => w, workers: () => ws, markWorked: (date, x) => { w = date; ws = x; return true; } }; };
  const deps = () => ({ allowed: () => true, env: {}, roster: () => cards, book: new Map(), now: () => EVENING,
    send: () => ({ on: true, ok: true }), hasReport: () => false, asked: memAsked(), labels: [], isGuide: () => false,
    deliver: () => { sent += 1; return { state: 'placed' }; }, DELIVERY: { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' } });
  const first = nudge.makeTick(deps())();
  assert.equal(sent, 0, 'a brand-new agent with an empty day was asked: ' + JSON.stringify(first));
  assert.match(first.result.because, /has a day of their own/);
  chat.appendMessage(chat.DIRECT, cards[0].sessionName, { text: 'can you look at the invoice?', at: at(15), delivery: { state: 'placed' } });
  nudge.makeTick(deps())();
  assert.equal(sent, 1, 'CONTROL: with a word from its person today, it is asked');
});
