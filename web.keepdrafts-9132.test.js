'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9132: half-typed words in a chat or room box are kept across a reload, so the Mac window can restart itself
 * onto an update while one is parked.
 *
 * The four draft maps (TALK_DRAFTS, TERM_DRAFTS, PJ_DRAFTS, PJ_ROOM_DRAFTS) were plain page objects, lost on a reload,
 * so updateNothingToLose refused the silent restart while any held words, and a window with one parked draft never
 * updated. Now each map writes every entry to localStorage as it changes and is filled from it on load (keptDrafts),
 * and only words that are NOT kept hold the restart.
 *
 * The helper is lifted from the page itself (between its own markers), not rewritten here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

// The helper block: from its constants to the end of draftsKept.
const START = SCRIPT.indexOf('const KEPT_DRAFT_DAYS');
const END_AT = SCRIPT.indexOf('function draftsKept(m)');
const END = SCRIPT.indexOf('\n}\n', END_AT) + 3;
const HELPER = SCRIPT.slice(START, END);

function memoryStorage(seed = {}, { failWrites = false } = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// The page's helper, with this localStorage.
function helper(storage) {
  return new Function('localStorage', HELPER + '\nreturn { keptDrafts, draftsKept };')(storage);
}

// updateNothingToLose as the page has it, given the four maps, the typed boxes and the open agent and project.
function nothingToLose({ maps, typed = [], current = null, pjCurrent = null, draftsKept }) {
  const typedSet = new Set(typed.map((t) => ({ isConnected: true, ...t })));
  return new Function('TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'UPDATE_TYPED', 'CURRENT', 'PJ_CURRENT',
    'draftsKept', 'ATTACH_PENDING', 'tipModalOpen',
    page.liftAll(SCRIPT, ['updateNothingToLose']) + '\nreturn updateNothingToLose();')(
    maps.talk || {}, maps.term || {}, maps.pj || {}, maps.room || {}, typedSet, current, pjCurrent,
    draftsKept, { room: {}, agent: {} }, () => false);
}

test('#9132 premise: the helper was found in the page', () => {
  assert.ok(START > 0 && END_AT > START && END > END_AT, 'the keptDrafts block was not found');
  assert.match(HELPER, /function keptDrafts\(kind\)/);
  for (const [name, kind] of [['TALK_DRAFTS', 'talk'], ['TERM_DRAFTS', 'term'], ['PJ_DRAFTS', 'pj'], ['PJ_ROOM_DRAFTS', 'room']]) {
    assert.match(SCRIPT, new RegExp(`const ${name} = keptDrafts\\('${kind}'\\);`), `${name} is not a kept map`);
  }
});

test('#9132: a draft written to a kept map survives a reload (a new page filled from the same storage)', () => {
  const storage = memoryStorage();
  const first = helper(storage).keptDrafts('talk');
  first.april = 'half a sentence for April';
  first['agent two'] = 'another';
  delete first['agent two'];
  const reloaded = helper(storage).keptDrafts('talk');
  assert.equal(reloaded.april, 'half a sentence for April');
  assert.equal(reloaded['agent two'], undefined, 'a deleted draft came back');
  assert.equal(helper(storage).keptDrafts('term').april, undefined, 'one kind of draft leaked into another');
});

test('#9132: an emptied draft is removed, and one older than 14 days is dropped on load', () => {
  const old = Date.now() - 15 * 24 * 60 * 60 * 1000;
  const storage = memoryStorage({
    'kosmos.draft.pj.old': JSON.stringify({ v: 'from last month', t: old }),
    'kosmos.draft.pj.new': JSON.stringify({ v: 'from today', t: Date.now() }),
    'kosmos.draft.pj.broken': 'not json',
  });
  const pj = helper(storage).keptDrafts('pj');
  assert.equal(pj.new, 'from today');
  assert.equal(pj.old, undefined, 'a 15-day-old draft came back');
  assert.equal(storage.data.has('kosmos.draft.pj.old') || storage.data.has('kosmos.draft.pj.broken'), false, 'stale entries stay in storage');
  pj.new = '   ';
  assert.equal(storage.data.has('kosmos.draft.pj.new'), false, 'a blank draft stayed in storage');
});

test('#9132: kept drafts no longer hold the restart; unkept ones still do (the control)', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk');
  talk.april = 'half a sentence';
  assert.equal(nothingToLose({ maps: { talk }, draftsKept: h.draftsKept }), true, 'a kept draft still held the restart');
  // CONTROL: the same words in a plain map (how the page was before) hold it.
  assert.equal(nothingToLose({ maps: { talk: { april: 'half a sentence' } }, draftsKept: h.draftsKept }), false,
    'CONTROL: an unkept draft did not hold the restart');
});

test('#9132: when storage refuses a write, that map is not kept and its words hold the restart again', () => {
  const storage = memoryStorage({}, { failWrites: true });
  const h = helper(storage);
  const room = h.keptDrafts('room');
  room.p1 = 'a post not saved anywhere';
  assert.equal(h.draftsKept(room), false);
  assert.equal(nothingToLose({ maps: { room }, draftsKept: h.draftsKept }), false, 'words storage refused were treated as kept');
});

test('#9132: the open chat box whose words are its kept draft does not hold the restart; any other words do', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk');
  talk.april = 'half a sentence';
  const current = { sessionName: 'april' };
  assert.equal(nothingToLose({ maps: { talk }, typed: [{ id: 'd-say', value: 'half a sentence' }], current, draftsKept: h.draftsKept }), true,
    'the chat box holding exactly its kept draft held the restart');
  assert.equal(nothingToLose({ maps: { talk }, typed: [{ id: 'd-say', value: 'half a sentence and more' }], current, draftsKept: h.draftsKept }), false,
    'words in the box beyond the kept draft did not hold the restart');
  assert.equal(nothingToLose({ maps: { talk }, typed: [{ id: 'new-task-title', value: 'Write the brief' }], current, draftsKept: h.draftsKept }), false,
    'CONTROL: another typed box with words did not hold the restart');
  const pj = h.keptDrafts('pj');
  pj.p7 = 'a project message';
  assert.equal(nothingToLose({ maps: { pj }, typed: [{ id: 'pj-say', value: 'a project message' }], pjCurrent: 'p7', draftsKept: h.draftsKept }), true,
    "the project box holding exactly its kept draft held the restart");
});
