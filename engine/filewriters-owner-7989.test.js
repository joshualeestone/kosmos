'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#7989: a project file's owner (the agent recorded writing it when it had no record) is noticed, in the project's
 * room, when another agent writes it: a notice, not a lock, at most once per file and writer per hour.
 *   node --test engine/filewriters-owner-7989.test.js */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileowner-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const fw = require('./filewriters');
const messages = require('./messages');
const store = require('./store');

test('sandbox: the store root is inside this test\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(fs.realpathSync(SB)) || path.resolve(store.ROOT).startsWith(SB), store.ROOT);
});

const real = fs.realpathSync(SB);
const folder = path.join(real, 'projects', 'deck');
fs.mkdirSync(folder, { recursive: true });
const PROJECTS = [{ id: 'deck', folder }];
const file = (n) => path.join(folder, n);
const notes = () => {
  let raw = '';
  try { raw = fs.readFileSync(messages.LOG, 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'note' && r.project === 'deck');
};
const record = () => JSON.parse(fs.readFileSync(fw.fileFor('deck'), 'utf8'));
const HOUR = 60 * 60 * 1000;

test('kosmos#7989: the first recorded writer is the owner, and a later write by another agent keeps it', () => {
  const t = Date.parse('2026-11-04T10:00:00Z');
  assert.equal(fw.noteWrite(file('plan.md'), 'mona', { now: t, projects: PROJECTS }), true);
  assert.equal(record()['plan.md'].first, 'mona');
  assert.equal(fw.noteWrite(file('plan.md'), 'kitty', { now: t + 60000, projects: PROJECTS }), true);
  assert.equal(record()['plan.md'].agent, 'kitty', 'CONTROL: the last writer moves');
  assert.equal(record()['plan.md'].first, 'mona', 'a later write moved the owner');
});

test('kosmos#7989: another agent\'s write leaves one note in the room for the agents, naming the file, the writer and the owner', () => {
  const before = notes().length;
  const t = Date.parse('2026-11-04T11:00:00Z');
  fw.noteWrite(file('brief.md'), 'mona', { now: t, projects: PROJECTS });
  assert.equal(notes().length, before, 'the owner\'s own first write made a note');
  fw.noteWrite(file('brief.md'), 'kitty', { now: t + 60000, projects: PROJECTS });
  const made = notes().slice(before);
  assert.equal(made.length, 1, 'another agent\'s write made ' + made.length + ' notes');
  assert.equal(made[0].text, fw.ownerNoticeText({ name: 'brief.md', owner: 'mona', writer: 'kitty' }));
  assert.match(made[0].text, /^kitty is changing brief\.md, a file mona first wrote here\. A notice, not a lock: /);
  assert.equal(made[0].audience, messages.NOTE_AUDIENCE_AGENTS, 'the note is not kept to the agents');
});

test('kosmos#7989: the same writer is noticed at most once an hour per file; the owner\'s own writes never are', () => {
  const t = Date.parse('2026-11-04T12:00:00Z');
  fw.noteWrite(file('copy.md'), 'mona', { now: t, projects: PROJECTS });
  const before = notes().length;
  fw.noteWrite(file('copy.md'), 'kitty', { now: t + 60000, projects: PROJECTS });
  fw.noteWrite(file('copy.md'), 'kitty', { now: t + 30 * 60000, projects: PROJECTS });
  assert.equal(notes().length - before, 1, 'a second write within the hour made another note');
  fw.noteWrite(file('copy.md'), 'mona', { now: t + 40 * 60000, projects: PROJECTS });
  assert.equal(notes().length - before, 1, 'the owner\'s own write made a note');
  fw.noteWrite(file('copy.md'), 'kitty', { now: t + 60000 + HOUR, projects: PROJECTS });
  assert.equal(notes().length - before, 2, 'CONTROL: after the hour the same writer is noticed again');
  fw.noteWrite(file('copy.md'), 'april', { now: t + 60000 + HOUR + 60000, projects: PROJECTS });
  assert.equal(notes().length - before, 3, 'a different writer within the hour was not noticed');
});

test('kosmos#7989: a file recorded before owners were kept has no owner, and no note is made for it', () => {
  const t = Date.parse('2026-11-04T13:00:00Z');
  const rec = record();
  rec['old.md'] = { agent: 'mona', at: new Date(t).toISOString() };   // the shape before this change
  fs.writeFileSync(fw.fileFor('deck'), JSON.stringify(rec));
  const before = notes().length;
  fw.noteWrite(file('old.md'), 'kitty', { now: t + 60000, projects: PROJECTS });
  assert.equal(notes().length, before, 'a guessed owner was noticed');
  assert.equal('first' in record()['old.md'], false, 'an owner was invented for an old record');
});
