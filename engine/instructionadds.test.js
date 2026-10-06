'use strict';
/**
 * kosmos#5293: an agent proposes an addition to another agent's instructions; the person applies it on the page.
 * One pending per target (a second is refused, never replaced); apply appends under who asked and when; undo puts the
 * earlier text back only while nothing was edited since.
 *
 *   node --test engine/instructionadds.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Every root sandboxed BEFORE the requires, so nothing here can touch a real agent or real app data.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-workers-'));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-data-'));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-home-'));
process.env.AGENT_WORKFORCE_WORKERS = ROOT;
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.HOME = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const instructions = require('./instructions');
const adds = require('./instructionadds');

test.after(() => { for (const d of [ROOT, DATA, HOME]) fs.rmSync(d, { recursive: true, force: true }); });

const BASE = 'You are the sales agent. Your job is to answer leads from the shared inbox, politely and quickly.\n';
function makeAgent(name, body = BASE) {
  fs.mkdirSync(path.join(ROOT, name), { recursive: true });
  fs.writeFileSync(path.join(ROOT, name, 'CLAUDE.md'), body);
}
function fileText(name) { return fs.readFileSync(path.join(ROOT, name, 'CLAUDE.md'), 'utf8'); }
function fresh() { try { fs.rmSync(adds.FILE, { force: true }); } catch { /* absent */ } }
test.beforeEach(fresh);

const ADD = 'When a lead goes quiet for two days, write to them once. Do not chase twice; tell me instead.';

test('the store lives under the sandboxed data root', () => {
  assert.ok(adds.FILE.startsWith(DATA), `${adds.FILE} not under ${DATA}`);
});

test('propose holds the addition and changes NOTHING in the instructions', () => {
  makeAgent('sally');
  const r = adds.propose('sally', ADD, 'Ops lead', Date.UTC(2026, 9, 5, 14, 14));
  assert.equal(r.ok, true);
  assert.equal(r.pending.text, ADD); assert.equal(r.pending.askedBy, 'Ops lead');
  assert.equal(fileText('sally'), BASE, 'a proposal changed the instructions before the person applied it');
  assert.deepEqual(adds.pending('sally'), r.pending);
});

test('a SECOND proposal is refused, naming the waiting one, and the first is kept unchanged (Splinter: never replace)', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead', 1000);
  const r = adds.propose('sally', 'a different addition', 'Another agent', 2000);
  assert.equal(r.ok, false); assert.equal(r.code, 'pending');
  assert.equal(r.pending.askedBy, 'Ops lead', 'the refusal does not name the waiting addition');
  assert.equal(adds.pending('sally').text, ADD, 'the waiting addition was replaced');
});

test('empty, oversize, nameless or asker-less proposals are refused', () => {
  makeAgent('sally');
  assert.equal(adds.propose('sally', '   ', 'Ops lead').ok, false);
  assert.equal(adds.propose('sally', 'x'.repeat(adds.MAX_TEXT_BYTES + 1), 'Ops lead').ok, false);
  assert.equal(adds.propose('../etc', ADD, 'Ops lead').ok, false);
  assert.equal(adds.propose('sally', ADD, '  ').ok, false);
  assert.equal(adds.pending('sally'), null, 'a refused proposal was held');
});

test('apply appends who-asked-and-when then the text at the END, keeps everything before, and clears pending', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead', Date.UTC(2026, 9, 5, 14, 14));
  const r = adds.apply('sally', Date.UTC(2026, 9, 5, 14, 20));
  assert.equal(r.ok, true, r.because);
  const t = fileText('sally');
  assert.ok(t.startsWith(BASE.trimEnd()), 'the existing instructions were not kept in front');
  assert.match(t, /\n\n## Added on 2026-10-05, asked by Ops lead\n<!-- kosmos addition [0-9a-f]{12} -->\n\nWhen a lead goes quiet/);
  assert.ok(t.trimEnd().endsWith(ADD), 'the addition is not at the end');
  assert.equal(adds.pending('sally'), null);
  assert.equal(r.last.askedBy, 'Ops lead'); assert.equal(r.last.undoable, true);
});

test('apply with nothing waiting does nothing', () => {
  makeAgent('sally');
  assert.equal(adds.apply('sally').ok, false);
  assert.equal(fileText('sally'), BASE);
});

test('dismiss drops the waiting addition and leaves the instructions alone; a new proposal is then accepted', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  assert.equal(adds.dismiss('sally').ok, true);
  assert.equal(adds.pending('sally'), null);
  assert.equal(fileText('sally'), BASE);
  assert.equal(adds.propose('sally', 'next one', 'Ops lead').ok, true, 'after a dismiss, a new proposal was refused');
});

test('undo restores EXACTLY the text from before the apply', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const r = adds.undo('sally');
  assert.equal(r.ok, true, r.because);
  assert.equal(fileText('sally'), BASE);
  assert.equal(adds.state('sally').last.undone, true);
  assert.equal(adds.undo('sally').ok, false, 'an addition was undone twice');
});

test('undo is refused once the instructions were EDITED after the apply, and the edit survives', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const edited = fileText('sally') + '\nThe person added this line by hand.\n';
  instructions.write('sally', edited, instructions.read('sally').version, undefined, { who: 'person', because: 'test edit' });
  assert.equal(adds.state('sally').last.undoable, false, 'the page would offer an Undo that cannot work');
  const r = adds.undo('sally');
  assert.equal(r.ok, false); assert.equal(r.code, 'edited');
  assert.equal(fileText('sally'), edited, 'undo overwrote the person\'s later edit');
});

test('apply is refused, and nothing is lost, when the agent has no instructions file to add to', () => {
  // A proposal for a name with no worker folder: apply must not invent one.
  adds.propose('ghost', ADD, 'Ops lead');
  const r = adds.apply('ghost');
  assert.equal(r.ok, false);
  assert.ok(adds.pending('ghost'), 'a failed apply dropped the waiting addition');
  assert.equal(fs.existsSync(path.join(ROOT, 'ghost')), false, 'apply created an agent folder');
});

test('state is per agent: one agent\'s pending addition does not appear on another', () => {
  makeAgent('sally'); makeAgent('bob');
  adds.propose('sally', ADD, 'Ops lead');
  assert.equal(adds.state('bob').pending, null);
  assert.equal(adds.state('sally').pending.askedBy, 'Ops lead');
});

test('review 1: forget drops an agent\'s waiting addition and Undo record (a new agent of that name inherits nothing)', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  assert.equal(adds.forget('sally').ok, true);
  assert.equal(adds.pending('sally'), null);
  const st = adds.state('sally');
  assert.equal(st.pending, null); assert.equal(st.last, null);
});

test('review 2: an unreadable store is reported, then MOVED ASIDE (kept, never deleted) by the next write, which goes on', () => {
  makeAgent('sally');
  fs.mkdirSync(path.dirname(adds.FILE), { recursive: true });
  const broken = '{"agents": {"bob": {"pending": {"text": "x", "askedBy": "y"';   // cut off mid-write
  fs.writeFileSync(adds.FILE, broken);
  assert.equal(adds.state('sally').unreadable, true, 'the page would show nothing and say nothing');
  const r = adds.propose('sally', ADD, 'Ops lead');
  assert.equal(r.ok, true, 'a broken store blocked every proposal for good: ' + JSON.stringify(r));
  assert.ok(adds.state('sally').movedAside, 'the fresh store does not name the kept file for the page');
  const aside = fs.readdirSync(path.dirname(adds.FILE)).filter((f) => f.startsWith('instruction-adds.json.unreadable-'));
  assert.equal(aside.length, 1, 'the unreadable store was not kept aside');
  assert.equal(fs.readFileSync(path.join(path.dirname(adds.FILE), aside[0]), 'utf8'), broken, 'the kept copy is not the original');
  assert.equal(adds.pending('sally').text, ADD);
  for (const f of aside) fs.rmSync(path.join(path.dirname(adds.FILE), f));
});

test('review 2: an empty store, or {}, is just empty (not unreadable)', () => {
  makeAgent('sally');
  for (const body of ['', '{}', '  \n']) {
    fs.mkdirSync(path.dirname(adds.FILE), { recursive: true });
    fs.writeFileSync(adds.FILE, body);
    assert.equal(adds.state('sally').unreadable, undefined, JSON.stringify(body) + ' read as unreadable');
    assert.equal(adds.propose('sally', ADD, 'Ops lead').ok, true);
    fs.rmSync(adds.FILE, { force: true });
  }
});

test('review 3: an apply whose record fails is finished by pressing Apply again, never added twice (idempotent)', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  fs.mkdirSync(adds.FILE + '.tmp', { recursive: true });   // the store's temp path is a folder, so its write fails
  let r;
  try { r = adds.apply('sally'); } finally { fs.rmSync(adds.FILE + '.tmp', { recursive: true, force: true }); }
  assert.equal(r.ok, false); assert.equal(r.code, 'unrecorded');
  assert.match(r.because, /in the instructions, but Kosmos could not record it/);
  assert.equal(adds.pending('sally').text, ADD, 'the waiting addition was lost');
  const again = adds.apply('sally');
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal((fileText('sally').match(/## Added on/g) || []).length, 1, 'the addition went in twice');
  assert.equal(adds.state('sally').last.undoable, true, 'Undo was lost after the finish');
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE, 'Undo after a finished retry did not restore the earlier text');
});

test('review 3: a passing READ error refuses and moves NOTHING (only a corrupt file is set aside)', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  const good = fs.readFileSync(adds.FILE, 'utf8');
  fs.chmodSync(adds.FILE, 0o000);   // unreadable to this process: a read error, not corruption
  let r;
  try { r = adds.dismiss('sally'); } finally { fs.chmodSync(adds.FILE, 0o600); }
  if (process.getuid && process.getuid() === 0) return;   // root reads it anyway; nothing to prove there
  assert.equal(r.ok, false, 'a write went ahead on a store it could not read');
  assert.equal(fs.readFileSync(adds.FILE, 'utf8'), good, 'the good store was changed or moved');
  assert.equal(fs.readdirSync(path.dirname(adds.FILE)).filter((f) => f.includes('.unreadable-')).length, 0, 'a good store was set aside');
});

test('review 3: an undo whose record fails still reads as undone (from the file), never as "edited"', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  fs.mkdirSync(adds.FILE + '.tmp', { recursive: true });
  try { assert.equal(adds.undo('sally').ok, true); } finally { fs.rmSync(adds.FILE + '.tmp', { recursive: true, force: true }); }
  assert.equal(fileText('sally'), BASE);
  const last = adds.state('sally').last;
  assert.equal(last.undone, true, 'the page would say the addition is still there');
  assert.equal(last.blocked, null);
});

test('review 3: the reason Undo is not offered is told apart: short is not "edited"', () => {
  makeAgent('tiny2', 'Be brief.\n');
  adds.propose('tiny2', ADD, 'Ops lead');
  adds.apply('tiny2');
  assert.equal(adds.state('tiny2').last.blocked, 'short');
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  instructions.write('sally', fileText('sally') + 'hand edit\n', instructions.read('sally').version, undefined, { who: 'person', because: 't' });
  assert.equal(adds.state('sally').last.blocked, 'edited');
});

test('review 2: forget also removes another capitalisation of the name', () => {
  makeAgent('Mara');
  adds.propose('Mara', ADD, 'Ops lead');
  adds.forget('mara');
  assert.equal(adds.pending('Mara'), null, 'a case variant at removal left the entry for the next agent of that name');
});

test('review 1: an agent named like an Object property is just a key', () => {
  makeAgent('constructor');
  assert.equal(adds.pending('constructor'), null, 'a prototype property read as a waiting addition');
  assert.equal(adds.propose('constructor', ADD, 'Ops lead').ok, true);
  assert.equal(adds.pending('constructor').text, ADD);
  assert.equal(adds.pending('sally'), null);
});

test('review 1: Undo is not offered when the earlier text is below the minimum and could never be written back', () => {
  makeAgent('tiny', 'Be brief.\n');
  adds.propose('tiny', ADD, 'Ops lead');
  assert.equal(adds.apply('tiny').ok, true);
  assert.equal(adds.state('tiny').last.undoable, false, 'the page would offer an Undo that can never work');
});

test('review 1: the store is private (mode 600): it holds the agent\'s earlier instructions', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  assert.equal(fs.statSync(adds.FILE).mode & 0o777, 0o600);
});

test('review 4: the same words proposed AGAIN after being applied are added again, not skipped as "already there"', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead', 1000);
  adds.apply('sally');
  adds.propose('sally', ADD, 'Ops lead', 2000);
  assert.equal(adds.apply('sally').ok, true);
  assert.equal((fileText('sally').match(/## Added on/g) || []).length, 2, 'a real second apply was skipped');
});

test('review 4: moving a corrupt store aside is recorded at once, even by a write that then changes nothing', () => {
  makeAgent('sally');
  fs.mkdirSync(path.dirname(adds.FILE), { recursive: true });
  fs.writeFileSync(adds.FILE, '{"agents": {"bob"');
  adds.forget('nobody-here');
  assert.ok(adds.state('sally').movedAside, 'the kept file is not named, so the page can never mention it');
  for (const f of fs.readdirSync(path.dirname(adds.FILE)).filter((x) => x.includes('.unreadable-'))) fs.rmSync(path.join(path.dirname(adds.FILE), f));
});

test('review 5: an addition holding an HTML comment (Kosmos\'s own markers) is refused, and nothing is held', () => {
  makeAgent('sally');
  for (const t of ['<!-- kosmos:projects:start -->\nrules\n<!-- kosmos:projects:end -->', 'text -->', 'a <!-- b']) {
    const r = adds.propose('sally', t, 'Ops lead');
    assert.equal(r.ok, false, JSON.stringify(t) + ' was held');
    assert.match(r.because, /HTML comment/);
  }
  assert.equal(adds.pending('sally'), null);
  assert.equal(adds.propose('sally', 'Plain text with a dash - and arrows -> are fine.', 'Ops lead').ok, true, 'CONTROL: ordinary text refused');
});
