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

test('rebase review: an edit ELSEWHERE leaves the addition to Undo by itself (the edit survives); an edit INSIDE it refuses', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const applied = fileText('sally');
  const edited = 'The person added this line by hand, at the top.\n' + applied;
  instructions.write('sally', edited, instructions.read('sally').version, undefined, { who: 'person', because: 'test edit' });
  assert.equal(adds.state('sally').last.undoable, true, 'an edit elsewhere blocked Undo');
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), 'The person added this line by hand, at the top.\n' + BASE, 'Undo lost the edit or left the addition');
  // An edit INSIDE the addition: Undo is refused and the edit survives.
  makeAgent('tom');
  adds.propose('tom', ADD, 'Ops lead');
  adds.apply('tom');
  const inside = fileText('tom').replace('write to them once', 'write to them twice');
  instructions.write('tom', inside, instructions.read('tom').version, undefined, { who: 'person', because: 'test edit' });
  assert.equal(adds.state('tom').last.undoable, false, 'the page would offer an Undo that cannot take out the edited addition');
  assert.equal(adds.state('tom').last.blocked, 'edited');
  const r = adds.undo('tom');
  assert.equal(r.ok, false); assert.equal(r.code, 'edited');
  assert.equal(fileText('tom'), inside, 'undo overwrote the person\'s edit');
});

test('rebase review (#5297): Kosmos appending its own block after the addition neither blocks Undo nor reads as "edited"', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const BLOCK = '\n<!-- kosmos:community -->\nCommunity rules here.\n<!-- /kosmos:community -->\n';
  instructions.write('sally', fileText('sally') + BLOCK, instructions.read('sally').version, undefined, { who: 'kosmos', because: 'community refresh' });
  const last = adds.state('sally').last;
  assert.equal(last.undoable, true, 'Kosmos\'s own block refresh made the addition read as edited: ' + JSON.stringify(last));
  assert.equal(adds.undo('sally').ok, true);
  const after = fileText('sally');
  assert.ok(!after.includes('## Added on'), 'Undo left the addition in');
  assert.ok(after.includes('<!-- kosmos:community -->'), 'Undo took out Kosmos\'s community block too');
  assert.ok(after.startsWith(BASE.trimEnd()), 'Undo changed the text before the addition');
});

test('rebase review (#5297): an unrecorded apply, then a Kosmos block appended, then Apply again: added once, not twice', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  fs.mkdirSync(adds.FILE + '.tmp', { recursive: true });
  let r;
  try { r = adds.apply('sally'); } finally { fs.rmSync(adds.FILE + '.tmp', { recursive: true, force: true }); }
  assert.equal(r.code, 'unrecorded', 'fixture: the record did not fail');
  const BLOCK = '\n<!-- kosmos:community -->\nCommunity rules here.\n<!-- /kosmos:community -->\n';
  instructions.write('sally', fileText('sally') + BLOCK, instructions.read('sally').version, undefined, { who: 'kosmos', because: 'community refresh' });
  assert.equal(adds.apply('sally').ok, true);
  assert.equal((fileText('sally').match(/## Added on/g) || []).length, 1, 'the addition went in twice');
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
  // An edit inside the addition (one elsewhere no longer blocks Undo since the rebase review).
  instructions.write('sally', fileText('sally').replace('tell me instead', 'tell the team'), instructions.read('sally').version, undefined, { who: 'person', because: 't' });
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

/* Review 7: the real community block, through projects.spliceBlock and projects.removeBlock (the code the board-start
   refresh and the community switch run), not a made-up marker. removeBlock takes the blank lines on both sides of the
   block, which are the addition's own leading blank lines when the addition sits right after it. */
const projects = require('./projects');
function kosmosWrites(name, text) {
  instructions.write(name, text, instructions.read(name).version, undefined, { who: 'kosmos', because: 'community refresh' });
}
test('review 7: the community block put in before Apply and taken out after it neither blocks Undo nor adds the addition twice', () => {
  makeAgent('sally');
  kosmosWrites('sally', projects.spliceBlock(fileText('sally'), 'Community rules here.', projects.COMMUNITY_START, projects.COMMUNITY_END));
  const withBlock = fileText('sally');
  adds.propose('sally', ADD, 'Ops lead');
  assert.equal(adds.apply('sally').ok, true);
  kosmosWrites('sally', projects.removeBlock(fileText('sally'), projects.COMMUNITY_START, projects.COMMUNITY_END));
  assert.ok(!fileText('sally').includes(projects.COMMUNITY_START), 'fixture: the block was not taken out');
  const last = adds.state('sally').last;
  assert.equal(last.blocked, null, 'Kosmos taking its own block out made the addition read as edited: ' + JSON.stringify(last));
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE, 'Undo did not leave the text as it is without the block or the addition');
  assert.notEqual(withBlock, BASE, 'fixture: spliceBlock added nothing');
});
test('review 7: an unrecorded apply, then the community block taken out, then Apply again: added once, not twice', () => {
  makeAgent('sally');
  kosmosWrites('sally', projects.spliceBlock(fileText('sally'), 'Community rules here.', projects.COMMUNITY_START, projects.COMMUNITY_END));
  adds.propose('sally', ADD, 'Ops lead');
  fs.mkdirSync(adds.FILE + '.tmp', { recursive: true });
  let r;
  try { r = adds.apply('sally'); } finally { fs.rmSync(adds.FILE + '.tmp', { recursive: true, force: true }); }
  assert.equal(r.code, 'unrecorded', 'fixture: the record did not fail');
  kosmosWrites('sally', projects.removeBlock(fileText('sally'), projects.COMMUNITY_START, projects.COMMUNITY_END));
  assert.equal(adds.apply('sally').ok, true);
  assert.equal((fileText('sally').match(/## Added on/g) || []).length, 1, 'the addition went in twice');
});
test('review 7: the addition there TWICE (copied by hand) is not taken out by Undo; the person\'s copy survives', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const once = fileText('sally');
  const twice = once + once.slice(BASE.trimEnd().length);
  instructions.write('sally', twice, instructions.read('sally').version, undefined, { who: 'person', because: 'copied by hand' });
  assert.equal((fileText('sally').match(/## Added on/g) || []).length, 2, 'fixture: the copy is not there');
  assert.equal(adds.state('sally').last.blocked, 'edited');
  const u = adds.undo('sally');
  assert.equal(u.ok, false); assert.equal(u.code, 'edited');
  assert.equal(fileText('sally'), twice, 'Undo changed a file holding the addition twice');
});
test('review 7: text typed onto the start of the addition\'s heading line is an edit INSIDE it: Undo refuses', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const glued = fileText('sally').replace('\n## Added on', '\nNOTE ## Added on');
  assert.notEqual(glued, fileText('sally'), 'fixture: the heading line was not found');
  instructions.write('sally', glued, instructions.read('sally').version, undefined, { who: 'person', because: 'typed by hand' });
  assert.equal(adds.state('sally').last.blocked, 'edited');
  assert.equal(adds.undo('sally').ok, false);
  assert.equal(fileText('sally'), glued, 'Undo changed a file whose addition was edited');
});
test('review 7: "short" is judged on what Undo would write: a short file that has since gained Kosmos\'s block can be undone', () => {
  makeAgent('tiny3', 'Be brief.\n');
  adds.propose('tiny3', ADD, 'Ops lead');
  adds.apply('tiny3');
  assert.equal(adds.state('tiny3').last.blocked, 'short', 'fixture: the earlier text was not short');
  kosmosWrites('tiny3', projects.spliceBlock(fileText('tiny3'), 'Community rules here, long enough to be kept.', projects.COMMUNITY_START, projects.COMMUNITY_END));
  assert.equal(adds.state('tiny3').last.blocked, null, 'Undo hidden as "short" though it would write the block too');
  assert.equal(adds.undo('tiny3').ok, true);
  assert.ok(!fileText('tiny3').includes('## Added on') && fileText('tiny3').includes(projects.COMMUNITY_START), 'Undo did not take out just the addition');
});

/* Review 8 (sonnet, blind). */
function unrecordedApply(name) {
  fs.mkdirSync(adds.FILE + '.tmp', { recursive: true });
  let r;
  try { r = adds.apply(name); } finally { fs.rmSync(adds.FILE + '.tmp', { recursive: true, force: true }); }
  assert.equal(r.code, 'unrecorded', 'fixture: the record did not fail');
}
test('review 8: an unrecorded apply, then the addition typed onto by hand, then Apply again: refused, nothing added or recorded', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  unrecordedApply('sally');
  const glued = fileText('sally').replace('\n## Added on', '\nNOTE ## Added on');
  instructions.write('sally', glued, instructions.read('sally').version, undefined, { who: 'person', because: 'typed by hand' });
  const r = adds.apply('sally');
  assert.equal(r.ok, false); assert.equal(r.code, 'edited');
  assert.equal(fileText('sally'), glued, 'Apply changed the file');
  assert.equal(adds.state('sally').last, null, 'a record was written, so the page could call it undone');
  assert.equal(adds.pending('sally').text, ADD, 'the waiting addition was lost');
});
test('review 8: Undo with the community block AFTER the addition gives exactly the text with the block and without the addition', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  kosmosWrites('sally', projects.spliceBlock(fileText('sally'), 'Community rules here.', projects.COMMUNITY_START, projects.COMMUNITY_END));
  // What the file would be had the addition never been applied: the block put into the original text.
  const expected = projects.spliceBlock(BASE, 'Community rules here.', projects.COMMUNITY_START, projects.COMMUNITY_END);
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), expected);
});
test('review 8: Undo with nothing left above the addition (deleted by hand) and the block after it gives exactly the block', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  kosmosWrites('sally', projects.spliceBlock(fileText('sally'), 'Community rules here.', projects.COMMUNITY_START, projects.COMMUNITY_END));
  const noHead = fileText('sally').slice(fileText('sally').indexOf('## Added on'));
  instructions.write('sally', noHead, instructions.read('sally').version, undefined, { who: 'person', because: 'deleted the top' });
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), projects.COMMUNITY_START + '\nCommunity rules here.\n' + projects.COMMUNITY_END + '\n');
});

/* Review 9 (opus, blind): everything the page and Undo say is read from the file. */
test('review 9: an unrecorded apply, then the addition\'s TEXT edited, then Apply again: refused, not added twice', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  unrecordedApply('sally');
  const edited = fileText('sally').replace('write to them once', 'write to them twice');
  instructions.write('sally', edited, instructions.read('sally').version, undefined, { who: 'person', because: 'edited by hand' });
  const r = adds.apply('sally');
  assert.equal(r.ok, false); assert.equal(r.code, 'edited');
  assert.equal(fileText('sally'), edited, 'Apply changed the file');
  assert.equal((fileText('sally').match(/kosmos addition/g) || []).length, 1, 'the addition went in twice');
});
test('review 9: undone, then the earlier version put back by the person: the page offers Undo again, and it works', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const applied = fileText('sally');
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(adds.state('sally').last.undone, true);
  instructions.write('sally', applied, instructions.read('sally').version, undefined, { who: 'person', because: 'restored the earlier version' });
  const last = adds.state('sally').last;
  assert.equal(last.undone, false, 'the page says undone while the addition is in the file');
  assert.equal(last.undoable, true);
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE);
});
test('review 9: an Undo whose record fails after Kosmos refreshed its block reads as undone, not "edited"', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  kosmosWrites('sally', projects.spliceBlock(fileText('sally'), 'Community rules here.', projects.COMMUNITY_START, projects.COMMUNITY_END));
  fs.mkdirSync(adds.FILE + '.tmp', { recursive: true });
  let r;
  try { r = adds.undo('sally'); } finally { fs.rmSync(adds.FILE + '.tmp', { recursive: true, force: true }); }
  assert.equal(r.ok, true, 'fixture: the undo itself failed');
  assert.ok(!fileText('sally').includes('## Added on'), 'fixture: the addition is still there');
  const last = adds.state('sally').last;
  assert.equal(last.undone, true, JSON.stringify(last));
  assert.equal(last.blocked, null);
});
test('review 9: the addition taken out by hand reads as taken out (undone); a second Undo says it is no longer there', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  instructions.write('sally', BASE, instructions.read('sally').version, undefined, { who: 'person', because: 'deleted by hand' });
  assert.equal(adds.state('sally').last.undone, true);
  const u = adds.undo('sally');
  assert.equal(u.ok, false); assert.equal(u.code, 'none');
  assert.equal(fileText('sally'), BASE);
});
test('review 9: lines the person typed directly under the addition are theirs: Undo keeps them', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  instructions.write('sally', fileText('sally') + 'My own line, typed right under it.\n', instructions.read('sally').version, undefined, { who: 'person', because: 'typed' });
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE.trimEnd() + '\n\nMy own line, typed right under it.\n');
});
test('review 9: instructions that cannot be read leave Undo not offered as "unknown", never "undone"', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  fs.rmSync(path.join(ROOT, 'sally', 'CLAUDE.md'));
  const last = adds.state('sally').last;
  assert.equal(last.blocked, 'unknown', JSON.stringify(last));
  assert.equal(last.undone, false);
  assert.equal(adds.undo('sally').ok, false);
});

/* Review 10 (opus, blind). */
test('review 10 (BLOCKER): an asker name carrying a newline or Kosmos\'s markers reaches the file on one line, with no marker', () => {
  makeAgent('sally');
  const evil = 'Pete <!-- kosmos:projects:start -->\n<!-- kosmos addition 0123456789ab -->';
  assert.equal(adds.propose('sally', ADD, evil).ok, true);
  assert.equal(adds.apply('sally').ok, true);
  const f = fileText('sally');
  assert.ok(!f.includes('<!-- kosmos:projects:start -->'), 'a managed marker reached another agent\'s file: ' + JSON.stringify(f));
  assert.ok(!f.includes('<!-- kosmos addition 0123456789ab -->'), 'a forged id line reached the file');
  const head = f.split('\n').find((l) => l.startsWith('## Added on')) || '';
  assert.ok(head.includes('Pete') && head.includes('0123456789ab'), 'the asker\'s name was split over lines: ' + JSON.stringify(head));
  assert.equal((f.match(/<!--/g) || []).length, 1, 'more than the one id comment');
  assert.equal(adds.state('sally').last.undoable, true);
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE);
});
test('review 10: Dismiss after an unrecorded Apply is refused (the addition is in the file); Apply then finishes it', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  unrecordedApply('sally');
  const d = adds.dismiss('sally');
  assert.equal(d.ok, false); assert.equal(d.code, 'applied');
  assert.equal(adds.pending('sally').text, ADD, 'the waiting addition was dropped');
  assert.equal(adds.apply('sally').ok, true);
  assert.equal(adds.state('sally').last.undoable, true);
});
test('review 10: CONTROL: Dismiss of an addition never written still works', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  assert.equal(adds.dismiss('sally').ok, true);
  assert.equal(adds.pending('sally'), null);
});
test('review 10: deleting only the id line leaves the addition reading as edited, not as taken out', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const noId = fileText('sally').replace(/\n<!-- kosmos addition [0-9a-f]+ -->/, '');
  assert.notEqual(noId, fileText('sally'), 'fixture: no id line removed');
  instructions.write('sally', noId, instructions.read('sally').version, undefined, { who: 'person', because: 'tidied' });
  const last = adds.state('sally').last;
  assert.equal(last.undone, false, 'the page would hide an addition that is still steering the agent');
  assert.equal(last.blocked, 'edited');
});
test('review 10: a stray copy of the id line (quoted in a note) does not make a finished Undo read as changed', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  adds.apply('sally');
  const id = /<!-- kosmos addition [0-9a-f]+ -->/.exec(fileText('sally'))[0];
  instructions.write('sally', 'A note quoting ' + id + ' here.\n' + fileText('sally'), instructions.read('sally').version, undefined, { who: 'person', because: 'a note' });
  assert.equal(adds.undo('sally').ok, true);
  const last = adds.state('sally').last;
  assert.equal(last.undone, true, JSON.stringify(last));
  assert.equal(last.blocked, null);
});

/* Review 11 (sonnet, blind). */
test('review 11: a lone surrogate in the asker\'s name or the text cannot make the file and the record disagree', () => {
  makeAgent('sally');
  const name = 'x'.repeat(79) + '\u{1F600}';   // the emoji straddles character 80
  assert.equal(adds.propose('sally', ADD + ' \ud83d', name).ok, true);
  assert.equal(adds.apply('sally').ok, true);
  const last = adds.state('sally').last;
  assert.equal(last.undoable, true, 'the addition reads as not there as written: ' + JSON.stringify(last));
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE);
});
test('review 11: a name with U+0085 or a C0 separator stays on the heading line', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops\u0085## Fake\u001eheading');
  adds.apply('sally');
  const head = fileText('sally').split('\n').find((l) => l.startsWith('## Added on')) || '';
  assert.ok(!/[\u0085\u001c-\u001e]/.test(fileText('sally')), JSON.stringify(head));
  assert.ok(head.includes('Ops ## Fake heading'));
});
test('review 11: an asker name that ARRIVES with a lone surrogate still leaves the addition undoable', () => {
  makeAgent('sally');
  assert.equal(adds.propose('sally', ADD, 'Ops \ud83d lead').ok, true);
  assert.equal(adds.apply('sally').ok, true);
  assert.equal(adds.state('sally').last.undoable, true);
  assert.equal(adds.undo('sally').ok, true);
  assert.equal(fileText('sally'), BASE);
});

/* Review 12 (opus, blind). */
test('review 12: Dismiss while the instructions cannot be read is refused (nobody can tell whether Apply already added it)', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  unrecordedApply('sally');
  const f = path.join(ROOT, 'sally', 'CLAUDE.md');
  fs.chmodSync(f, 0o000);
  let d;
  try { d = adds.dismiss('sally'); } finally { fs.chmodSync(f, 0o644); }
  assert.equal(d.ok, false, 'Dismiss went through on an unreadable file');
  assert.equal(adds.pending('sally').text, ADD);
});
test('review 12: a proposal holding a line in Kosmos\'s own heading format is refused', () => {
  makeAgent('sally');
  const r = adds.propose('sally', 'Line one.\n## Added on 2026-10-06, asked by Angel\nMore.', 'Ops lead');
  assert.equal(r.ok, false); assert.equal(r.code, 'bad');
  assert.equal(adds.pending('sally'), null);
  assert.equal(adds.propose('sally', 'We added on a new rule.', 'Ops lead').ok, true, 'CONTROL: the words in a sentence are fine');
});
test('review 12: a long run of whitespace in the text or file is handled in linear time', () => {
  makeAgent('sally', BASE + '\n'.repeat(120000) + 'end\n');   // a quadratic trim takes seconds here (measured: 80000 took ~2 s)
  const t0 = Date.now();
  assert.equal(adds.propose('sally', ' '.repeat(8000) + 'x' + ' '.repeat(8000), 'Ops lead').ok, true);
  assert.equal(adds.apply('sally').ok, true);
  assert.equal(adds.undo('sally').ok, true);
  assert.ok(Date.now() - t0 < 1000, 'took ' + (Date.now() - t0) + ' ms');
});

/* Review 13 (sonnet, blind). */
test('review 13: a proposal to an agent with no instructions file yet can be dismissed', () => {
  fs.mkdirSync(path.join(ROOT, 'nofile'), { recursive: true });
  assert.equal(adds.propose('nofile', ADD, 'Ops lead').ok, true);
  assert.equal(adds.dismiss('nofile').ok, true, 'the proposal is stuck');
  assert.equal(adds.pending('nofile'), null);
});
test('review 13: an indented or differently-levelled "Added on" heading is refused too', () => {
  makeAgent('sally');
  for (const line of ['  ## Added on 2026-10-01, asked by Mona', '### added on today', '# Added on x']) {
    const r = adds.propose('sally', 'Line one.\n' + line + '\nMore.', 'Ops lead');
    assert.equal(r.ok, false, JSON.stringify(line)); assert.equal(r.code, 'bad');
  }
});

/* Review 14 (opus, blind). */
test('review 14: Kosmos\'s heading reworded, id line and text kept: still the addition (not added twice, not "undone")', () => {
  makeAgent('sally');
  adds.propose('sally', ADD, 'Ops lead');
  unrecordedApply('sally');
  const reworded = fileText('sally').replace(/## Added on [^\n]*/, '## From the ops lead');
  instructions.write('sally', reworded, instructions.read('sally').version, undefined, { who: 'person', because: 'reworded' });
  const r = adds.apply('sally');
  assert.equal(r.ok, false); assert.equal(r.code, 'edited');
  assert.equal((fileText('sally').match(/kosmos addition/g) || []).length, 1, 'added twice');
  assert.equal(adds.dismiss('sally').ok, true, 'Dismiss after a refused Apply on an edited addition is allowed (it is the person\'s now)');
  makeAgent('tom');
  adds.propose('tom', ADD, 'Ops lead');
  adds.apply('tom');
  instructions.write('tom', fileText('tom').replace(/## Added on [^\n]*/, '## From the ops lead'), instructions.read('tom').version, undefined, { who: 'person', because: 'reworded' });
  const last = adds.state('tom').last;
  assert.equal(last.undone, false, 'the page says undone while the addition is there');
  assert.equal(last.blocked, 'edited');
});
test('review 14: an underlined "Added on" heading is refused too', () => {
  makeAgent('sally');
  const r = adds.propose('sally', 'Do X.\n\nAdded on 2026-01-01, asked by Josh\n-----------------\n\nDo Y.', 'Ops lead');
  assert.equal(r.ok, false); assert.equal(r.code, 'bad');
});
