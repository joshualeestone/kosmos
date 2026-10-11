'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5812: engine/filewriters.js, the record of which agent last wrote a project file.
 *   node --test engine/filewriters-5812.test.js */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filewriters-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const fw = require('./filewriters');
const undo = require('./undo');
const store = require('./store');

test('sandbox: the store root is inside this test\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(fs.realpathSync(SB)) || path.resolve(store.ROOT).startsWith(SB), store.ROOT);
});

const real = fs.realpathSync(SB);
const folder = path.join(real, 'projects', 'lease');
fs.mkdirSync(path.join(folder, 'drafts'), { recursive: true });
const link = path.join(real, 'linked-projects');
fs.symlinkSync(path.join(real, 'projects'), link);
const PROJECTS = [{ id: 'lease', folder: path.join(link, 'lease') }, { id: 'other', folder: path.join(real, 'projects', 'other') }];
const iso = (ms) => new Date(ms).toISOString();

test('#5812: a write inside a project folder is recorded under its project-relative name (through a linked folder); outside, nothing', () => {
  const now = Date.now();
  assert.equal(fw.noteWrite(path.join(folder, 'drafts', 'terms.md'), 'uri', { now, projects: PROJECTS }), true);
  assert.equal(fw.noteWrite(path.join(real, 'elsewhere.md'), 'uri', { now, projects: PROJECTS }), false);
  assert.equal(fw.noteWrite('relative.md', 'uri', { now, projects: PROJECTS }), false);
  assert.equal(fw.noteWrite(path.join(folder, 'x.md'), '', { now, projects: PROJECTS }), false);
  const rows = fw.annotate('lease', [{ name: 'drafts/terms.md', modified: iso(now + 1000) }, { name: 'drafts/other.md', modified: iso(now + 1000) }]);
  assert.equal(rows[0].changedBy, 'uri');
  assert.equal('changedBy' in rows[1], false, 'a file with no record got a writer');
});

test('#5812: the window: named just after the record, nobody long after it or before it', () => {
  const at = Date.parse('2026-10-10T20:00:00Z');
  const e = { agent: 'uri', at: iso(at) };
  assert.equal(fw.writerOf(e, iso(at + 3000)), 'uri');
  assert.equal(fw.writerOf(e, iso(at + fw.WRITE_WINDOW_MS)), 'uri', 'the window\'s edge');
  assert.equal(fw.writerOf(e, iso(at + fw.WRITE_WINDOW_MS + 1)), null, 'past the window');
  assert.equal(fw.writerOf(e, iso(at - fw.SLACK_MS)), 'uri', 'within the clock slack');
  assert.equal(fw.writerOf(e, iso(at - fw.SLACK_MS - 1)), null, 'a change before the record');
  assert.equal(fw.writerOf(null, iso(at)), null);
  assert.equal(fw.writerOf(e, 'garbage'), null);
});

test('#5812: a later write by another agent replaces the writer; the display name comes from nameOf', () => {
  const now = Date.now();
  const f = path.join(folder, 'shared.md');
  fw.noteWrite(f, 'uri', { now, projects: PROJECTS });
  fw.noteWrite(f, 'mona', { now: now + 5000, projects: PROJECTS });
  const [row] = fw.annotate('lease', [{ name: 'shared.md', modified: iso(now + 6000) }], (s) => (s === 'mona' ? 'Mona Lisa' : s));
  assert.equal(row.changedBy, 'Mona Lisa');
});

test('#5812: entries older than KEEP_MS are pruned on the next write', () => {
  const now = Date.now();
  fw.noteWrite(path.join(folder, 'old.md'), 'uri', { now: now - fw.KEEP_MS - 60e3, projects: PROJECTS });
  fw.noteWrite(path.join(folder, 'new.md'), 'uri', { now, projects: PROJECTS });
  const rec = JSON.parse(fs.readFileSync(fw.fileFor('lease'), 'utf8'));
  assert.equal('old.md' in rec, false, 'an entry past KEEP_MS survived');
  assert.equal('new.md' in rec, true);
});

test('#5812: undo.ownedBy, the token-only narrowing the keep route applies to the writer note too', () => {
  assert.equal(undo.ownedBy(null, 'uri'), true, 'a board-token caller is not narrowed');
  assert.equal(undo.ownedBy({ name: 'uri' }, 'uri'), true);
  assert.equal(undo.ownedBy({ name: 'mona' }, 'uri'), false, 'a token-only agent noted another agent\'s write');
  assert.equal(undo.ownedBy({ byKey: true, key: store.safeKey('uri') }, 'uri'), true);
});

test('#5812 review 1: the deepest project folder wins; the agent lookup runs only for a project file', () => {
  const now = Date.now();
  const inner = path.join(folder, 'drafts');
  const nested = [{ id: 'lease', folder }, { id: 'drafts-p', folder: inner }];
  assert.equal(fw.noteWrite(path.join(inner, 'n.md'), 'uri', { now, projects: nested }), true);
  const [row] = fw.annotate('drafts-p', [{ name: 'n.md', modified: iso(now + 500) }]);
  assert.equal(row.changedBy, 'uri', 'the inner project did not get the record');
  let asked = 0;
  assert.equal(fw.noteWrite(path.join(real, 'elsewhere.md'), () => { asked += 1; return 'uri'; }, { now, projects: PROJECTS }), false);
  assert.equal(asked, 0, 'the agent was looked up for a file in no project');
  assert.equal(fw.noteWrite(path.join(folder, 'lazy.md'), () => { asked += 1; return 'uri'; }, { now, projects: PROJECTS }), true);
  assert.equal(asked, 1);
  assert.equal(fw.noteWrite(path.join(folder, 'nobody.md'), () => null, { now, projects: PROJECTS }), false, 'a lookup that found nobody was recorded');
});
