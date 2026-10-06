'use strict';
/*
 * #5393: engine/worldview.js, the one view across worlds. Pure counting, the per-world reader, and the provider
 * summary from cards.
 *
 *   node --test engine/worldview-5393.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandboxed before anything requires the store, so nothing here can reach the real one.
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldview-data-'));

const worldview = require('./worldview');

const open = (n, extra) => ({ number: n, sentence: 't' + n, ...extra });
const given = (n, who) => ({ number: n, sentence: 't' + n, parts: [{ id: 'p' + n, sentence: 't' + n, who }] });

test('#5393 unassignedIn counts open tasks nobody is on, by the Assigner rule', () => {
  const records = [
    { id: 'a', tasks: [
      open(1),                                   // waiting
      open(2, { closedAt: '2026-10-01T00:00:00Z' }), // closed: not counted
      given(3, 'alice'),                         // somebody is on it: not counted
      open(4, { builtAt: '2026-10-01T00:00:00Z' }),  // marked built: not counted
      open(5, { onHold: true }),                 // held
      open(6, { dueDate: '2026-10-09' }),        // waiting
    ] },
    { id: 'b', paused: true, tasks: [open(1), given(2, 'bob')] },   // paused project: held
    { id: 'c', archived: true, tasks: [open(1), open(2)] },         // archived: left out
  ];
  assert.deepEqual(worldview.unassignedIn(records), { waiting: 2, held: 2 });
  assert.deepEqual(worldview.unassignedIn([]), { waiting: 0, held: 0 });
  assert.deepEqual(worldview.unassignedIn(null), { waiting: 0, held: 0 });
});

test('#5393 readProjectsAt: absent is a real zero, unreadable and damaged are said', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldview-read-'));
  assert.deepEqual(worldview.readProjectsAt(dir), { ok: true, records: [] }, 'no projects.json: none yet');

  fs.writeFileSync(path.join(dir, worldview.PROJECTS_FILE), JSON.stringify([{ id: 'x', tasks: [open(1)] }]));
  const ok = worldview.readProjectsAt(dir);
  assert.equal(ok.ok, true);
  assert.equal(ok.records.length, 1);

  fs.writeFileSync(path.join(dir, worldview.PROJECTS_FILE), '{not json');
  const bad = worldview.readProjectsAt(dir);
  assert.equal(bad.ok, false);
  assert.match(bad.because, /cannot make sense of it/);

  fs.writeFileSync(path.join(dir, worldview.PROJECTS_FILE), JSON.stringify({ not: 'a list' }));
  assert.equal(worldview.readProjectsAt(dir).ok, false, 'an object is not a list of projects');

  // A projects.json that is a FOLDER cannot be read: said, never a zero.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldview-read2-'));
  fs.mkdirSync(path.join(dir2, worldview.PROJECTS_FILE));
  const unread = worldview.readProjectsAt(dir2);
  assert.equal(unread.ok, false);
  assert.match(unread.because, /cannot read the projects/);
});

test('#5393 providersFrom groups the cards by runner; paused only from rate_limited, until only when stated', () => {
  const rows = worldview.providersFrom([
    { runner: 'claude', state: 'working' },
    { runner: 'claude', state: 'idle' },
    { runner: 'codex', state: 'rate_limited' },
    { runner: 'antigravity', state: 'rate_limited', quotaUntil: '2026-10-06T15:00:00.000Z' },
    { runner: 'antigravity', state: 'rate_limited', poolUntil: '2026-10-06T16:30:00.000Z' },
    { runner: 'antigravity', state: 'rate_limited', quotaUntil: 'not a time' },
    { runner: 'gemini', state: 'rate_limited' },
    { runner: 'gemini', state: 'working' },
    { paneless: true, state: 'stopped' },          // no runner: left out
    { runner: '', state: 'idle' },                 // no runner: left out
  ]);
  assert.deepEqual(rows, [
    { provider: 'antigravity', agents: 3, paused: 3, until: '2026-10-06T16:30:00.000Z', state: 'paused' },
    { provider: 'claude', agents: 2, paused: 0, until: null, state: 'not_paused' },
    { provider: 'codex', agents: 1, paused: 1, until: null, state: 'paused' },
    { provider: 'gemini', agents: 2, paused: 1, until: null, state: 'some_paused' },
  ]);
  for (const r of rows) assert.ok(!('quota' in r) && !('remaining' in r), 'no quota figure is ever reported');
});

test('#5393 overview: the running world has providers, the others say why not; a bad world never stops the rest', () => {
  const worlds = require('./worlds');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldview-base-'));
  const second = worlds.createWorld(base, 'Second');
  const third = worlds.createWorld(base, 'Third');
  fs.writeFileSync(path.join(base, worldview.PROJECTS_FILE), JSON.stringify([{ id: 'd', tasks: [open(1), open(2)] }]));
  fs.writeFileSync(path.join(worlds.worldStoreRoot(base, second), worldview.PROJECTS_FILE), JSON.stringify([{ id: 's', tasks: [open(1, { onHold: true })] }]));
  fs.writeFileSync(path.join(worlds.worldStoreRoot(base, third), worldview.PROJECTS_FILE), 'garbage');

  const view = worldview.overview({ base, runningId: second.id, cards: [{ runner: 'codex', state: 'rate_limited' }] });
  const by = Object.fromEntries(view.map((w) => [w.name, w]));
  assert.equal(view.length, 3);

  assert.deepEqual(by.Second.unassigned, { waiting: 0, held: 1 });
  assert.equal(by.Second.running, true);
  assert.deepEqual(by.Second.providers.map((p) => [p.provider, p.state]), [['codex', 'paused']]);
  assert.equal(by.Second.providersBecause, null);

  const def = view.find((w) => w.id === worlds.DEFAULT_ID);
  assert.deepEqual(def.unassigned, { waiting: 2, held: 0 }, 'the default world reads the base root');
  assert.equal(def.running, false);
  assert.equal(def.providers, null);
  assert.match(def.providersBecause, /only while this Kosmos is open/);

  assert.equal(by.Third.unassigned, null, 'a damaged file is never a zero');
  assert.match(by.Third.unassignedBecause, /cannot make sense of it/);

  const blind = worldview.overview({ base, runningId: second.id, cards: null });
  const s2 = blind.find((w) => w.id === second.id);
  assert.equal(s2.providers, null, 'unreadable cards are not "no providers"');
  assert.match(s2.providersBecause, /cannot read the agents/);
});

test('#5393 overview: a task the counter cannot read is said on its own world, never a 500 for every world', () => {
  const worlds = require('./worlds');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worldview-part-'));
  const broken = worlds.createWorld(base, 'Broken');
  fs.writeFileSync(path.join(base, worldview.PROJECTS_FILE), JSON.stringify([{ id: 'd', tasks: [open(1)] }]));
  // A hand-damaged part: parses as JSON, then throws inside the count.
  fs.writeFileSync(path.join(worlds.worldStoreRoot(base, broken), worldview.PROJECTS_FILE),
    JSON.stringify([{ id: 'b', tasks: [{ number: 1, sentence: 't1', parts: [null] }] }]));
  assert.throws(() => worldview.unassignedIn([{ id: 'b', tasks: [{ number: 1, parts: [null] }] }]), 'CONTROL: the count itself throws on it');

  const view = worldview.overview({ base, runningId: worlds.DEFAULT_ID, cards: [] });
  const by = Object.fromEntries(view.map((w) => [w.id, w]));
  assert.equal(by[broken.id].unassigned, null, 'never a zero');
  assert.match(by[broken.id].unassignedBecause, /cannot read the projects/);
  assert.deepEqual(by[worlds.DEFAULT_ID].unassigned, { waiting: 1, held: 0 }, 'the healthy world still counts');
});

test('#5393 unassignedIn is wider than the Assigner: webhook and unnumbered tasks nobody is on count as waiting', () => {
  const records = [{ id: 'a', tasks: [
    open(1, { addedVia: 'webhook' }),    // the Assigner never hands this out; nobody is on it
    { sentence: 'no number' },           // the Assigner skips a task with no number
  ] }];
  assert.deepEqual(worldview.unassignedIn(records), { waiting: 2, held: 0 });
});
