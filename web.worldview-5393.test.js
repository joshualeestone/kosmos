'use strict';
// kosmos#5393 slice 2: the words of "At a glance" (wvProviderLine, wvTasksLine, wvWorldHtml, wvListHtml), lifted from
// web/index.html and run on the shapes GET /api/worlds/overview returns (engine/worldview.js, slice 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);

function bundle() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftConst(SCRIPT, 'WV_PROVIDER') + '\n'
    + lift('esc') + '\n'
    + lift('wvCount') + '\n'
    + lift('wvTime') + '\n'
    + lift('wvProviderLine') + '\n'
    + lift('wvTasksLine') + '\n'
    + lift('wvWorldHtml') + '\n'
    + lift('wvListHtml') + '\n'
    + 'return { wvProviderLine, wvTasksLine, wvWorldHtml, wvListHtml, wvTime };',
  )();
}
const B = bundle();
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const row = (o) => ({ provider: 'claude', agents: 2, stopped: 0, paused: 0, signInFailed: 0, until: null, state: 'not_paused', ...o });

test('provider rows say only what the cards know: never "Working", and a stated time when every paused agent gave one', () => {
  assert.equal(B.wvProviderLine(row({})), 'Claude: Not paused');
  assert.doesNotMatch(B.wvProviderLine(row({})), /working/i);
  const until = new Date(Date.now() + 3600e3).toISOString();
  assert.equal(B.wvProviderLine(row({ state: 'paused', paused: 2, until })), 'Claude: Paused until ' + B.wvTime(until));
  assert.equal(B.wvProviderLine(row({ state: 'paused', paused: 2, until: null })), 'Claude: Paused');
  // A time on another day names the day; today's is the time alone.
  const now = new Date(2026, 9, 7, 20, 0);
  assert.doesNotMatch(B.wvTime(new Date(2026, 9, 7, 21, 30).toISOString(), now), /[A-Za-z]{3} /);
  const soon = B.wvTime(new Date(2026, 9, 9, 3, 0).toISOString(), now);
  const week = B.wvTime(new Date(2026, 9, 14, 3, 0).toISOString(), now);
  assert.match(soon, /^\S+ /, 'another day names its day (in any language)');
  assert.ok(week.length > soon.length, 'six days or more away also names the date: ' + week + ' vs ' + soon);
  assert.equal(B.wvProviderLine(row({ provider: 'codex', state: 'some_paused', paused: 1, agents: 3 })), 'OpenAI Codex: 1 of 3 agents paused');
  assert.equal(B.wvProviderLine(row({ provider: 'gemini', state: 'stopped', agents: 0, stopped: 2 })), 'Gemini: Stopped');
  assert.equal(B.wvProviderLine(row({ signInFailed: 1 })), 'Claude: Not paused. 1 agent could not sign in');
  // An unknown runner is shown by its own name, not dropped.
  assert.equal(B.wvProviderLine(row({ provider: 'newrunner' })), 'newrunner: Not paused');
});

test('tasks nobody is on: counts, on hold, none, and an unreadable list said rather than shown as 0', () => {
  assert.equal(B.wvTasksLine({ unassigned: { waiting: 3, held: 0 } }), '3 tasks waiting for someone');
  assert.equal(B.wvTasksLine({ unassigned: { waiting: 1, held: 2 } }), '1 task waiting for someone, and 2 on hold');
  assert.equal(B.wvTasksLine({ unassigned: { waiting: 0, held: 0 } }), 'No tasks waiting for someone');
  assert.equal(B.wvTasksLine({ unassigned: { waiting: 0, held: 1 } }), '1 task on hold, none waiting for someone');
  assert.equal(B.wvTasksLine({ unassigned: {} }), 'No tasks waiting for someone', 'missing fields are 0, never "undefined"');
  const unread = B.wvTasksLine({ unassigned: null, unassignedBecause: 'we cannot read the projects in this Kosmos right now' });
  assert.equal(unread, 'Tasks: we cannot read the projects in this Kosmos right now');
  assert.doesNotMatch(unread, /\b0\b/);
});

test('a world: the open one lists its providers; another says its providers are known only while it is open', () => {
  const open = text(B.wvWorldHtml({ id: 'default', name: 'Home <&>', running: true,
    providers: [row({}), row({ provider: 'grok', state: 'stopped', agents: 0, stopped: 1 })], agentsWithoutProvider: 2,
    unassigned: { waiting: 2, held: 0 }, providersBecause: null }));
  assert.match(open, /^Home <&> \(open now\)/, 'the name is escaped and the open one is marked');
  assert.match(open, /Claude: Not paused/);
  assert.match(open, /Grok: Stopped/);
  assert.match(open, /2 agents with no AI provider shown here/);
  assert.doesNotMatch(open, /another computer/, 'a paneless agent can run on this computer (Windows)');
  assert.match(open, /2 tasks waiting for someone/);
  const other = text(B.wvWorldHtml({ id: 'w2', name: 'Client work', running: false, providers: null, agentsWithoutProvider: null,
    unassigned: { waiting: 0, held: 1 }, providersBecause: 'known only while this Kosmos is open' }));
  assert.match(other, /AI providers: known only while this Kosmos is open/);
  assert.doesNotMatch(other, /open now/);
  // CONTROL: the open world with no agents at all says so, rather than showing nothing.
  const empty = text(B.wvWorldHtml({ name: 'Empty', running: true, providers: [], agentsWithoutProvider: 0, unassigned: { waiting: 0, held: 0 } }));
  assert.match(empty, /No agents running an AI provider/);
});

test('no quota figure anywhere, and a failed read says so', () => {
  const html = B.wvListHtml({ worlds: [{ name: 'A', running: true, providers: [row({ state: 'paused', paused: 2 })], agentsWithoutProvider: 0, unassigned: { waiting: 1, held: 0 } }] });
  assert.doesNotMatch(text(html), /quota|remaining|%/i);
  assert.equal(text(B.wvListHtml(null)), 'Kosmos could not read your Kosmoses just now.');
  assert.equal(text(B.wvListHtml({ worlds: [] })), 'No Kosmoses found on this computer.', 'an empty answer is said, not a blank sheet');
  assert.equal(text(B.wvListHtml({ because: 'the world registry is not readable on this machine' })), 'the world registry is not readable on this machine');
});
