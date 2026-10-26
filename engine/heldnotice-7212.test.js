'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 slice 2: the person is told when Kosmos's messages to an agent have waited half an hour behind its input
 * box. The minute sweep records it (engine/heldinput.js), the status row carries it (heldInput), both "needs the person"
 * rules count it, and the card says how long, what the box reads and what to do. Slice 1 (heldwarn-7212.test.js) is the
 * log line.
 *
 *   node --test engine/heldnotice-7212.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-heldnotice-7212-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const limitqueue = require('./limitqueue');
const heldinput = require('./heldinput');
const { needsPerson } = require('./status');
const page = require('../test-support/page');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT, limitqueue.dir()]);

const MIN = 60 * 1000;
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
const agentNeedsAttention = new Function(page.lift(SCRIPT, 'agentNeedsAttention') + '\nreturn agentNeedsAttention;')();
const reasonOf = (a) => new Function('a', `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, {});`)(a);
const ago = (m) => new Date(Date.now() - m * MIN).toISOString();

test('#7212 s2: the sweep\'s reading is what the rows see; each minute replaces the last', () => {
  heldinput.resetForTests();
  heldinput.setAll([{ name: 'dario', since: ago(40), count: 3, box: 'unread' }, { name: '', count: 1 }, null]);
  const got = heldinput.peek('dario');
  assert.equal(got.count, 3);
  assert.equal(got.box, 'unread');
  got.count = 99;
  assert.equal(heldinput.peek('dario').count, 3, 'a reader could change the stored reading');
  assert.equal(heldinput.peek(''), null, 'a nameless row was kept');
  heldinput.setAll([]);
  assert.equal(heldinput.peek('dario'), null, 'a stretch that ended still shows');
});

test('#7212 s2: both "needs the person" rules count a held stretch, and agree', () => {
  const rows = [
    { state: 'idle', heldInput: { since: ago(40), count: 2, box: 'unread' } },
    { state: 'idle', heldInput: { since: ago(40), count: 0, box: 'empty' } },
    { state: 'idle', heldInput: null },
    { state: 'idle' },   // a bare snapshot row without the field (needsPerson is guarded on presence)
    { state: 'working', heldInput: { since: ago(90), count: 1, box: 'text' } },
  ];
  const want = [true, false, false, false, true];
  rows.forEach((r, i) => {
    assert.equal(needsPerson(r), want[i], 'needsPerson row ' + i);
    assert.equal(agentNeedsAttention(r), want[i], 'agentNeedsAttention row ' + i);
  });
});

test('#7212 s2: the card says how long, what the box reads, and what to do', () => {
  const unread = reasonOf({ state: 'idle', heldInput: { since: ago(45), count: 3, box: 'unread' } });
  assert.match(unread, /^Kosmos has held 3 messages to it for about 45 minutes behind its input box\. /);
  assert.match(unread, /cannot read the box.*restart it there/);
  const text = reasonOf({ state: 'idle', heldInput: { since: ago(45), count: 1, box: 'text' } });
  assert.match(text, /held 1 message to it/);
  assert.match(text, /press Enter/);
  assert.match(reasonOf({ state: 'idle', heldInput: { since: ago(45), count: 2, box: 'empty' } }), /reads empty now/);
  // The seven-day case reads as days, a few hours as hours.
  assert.match(reasonOf({ state: 'idle', heldInput: { since: ago(7 * 1440), count: 2, box: 'unread' } }), /for about 7 days/);
  assert.match(reasonOf({ state: 'working', heldInput: { since: ago(300), count: 2, box: 'unread' } }), /for about 5 hours/);
  // It comes before #6249's sentence, which says nothing when the box cannot be read.
  const both = reasonOf({ state: 'idle', unsentInput: { since: ago(50) }, heldInput: { since: ago(45), count: 1, box: 'text' } });
  assert.match(both, /^Kosmos has held/);
});

test('#7212 s2: a more urgent sentence keeps its place', () => {
  const held = { since: ago(45), count: 2, box: 'unread' };
  assert.match(reasonOf({ state: 'idle', crashLoop: { looping: true, count: 3 }, heldInput: held }), /restarted it 3 times/);
  assert.doesNotMatch(reasonOf({ state: 'auth_failed', heldInput: held }), /Kosmos has held/);
  assert.doesNotMatch(reasonOf({ state: 'restarting', heldInput: held }), /Kosmos has held/);
  // CONTROL: the same row idle does say it.
  assert.match(reasonOf({ state: 'idle', heldInput: held }), /Kosmos has held/);
});

test('#7212 s2: the first saying of a stretch is marked, so the phone is told once per stretch', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const at = new Date(now - 40 * MIN).toISOString();
  assert.ok(limitqueue.add('phoned', { id: 'p1', from: 'x', envelope: 'e', at, reset: at, input: true }));
  const said = new Map();
  const say = (t) => limitqueue.heldInputToSay(t, limitqueue.HELD_INPUT_SAY_MS, said).filter((h) => h.name === 'phoned');
  assert.deepEqual(say(now).map((h) => h.first), [true]);
  assert.deepEqual(say(now + limitqueue.HELD_INPUT_RESAY_MS).map((h) => h.first), [false], 'the daily line told the phone again');
});
