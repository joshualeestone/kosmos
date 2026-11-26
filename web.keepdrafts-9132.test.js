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
function helper(storage, win) {
  return new Function('localStorage', 'window', HELPER + '\nreturn { keptDrafts, draftsKept, keptDraftStored, forgetDrafts, forgetAllDrafts };')(storage, win);
}
// A window that records its storage listeners, so a test can deliver another tab's write.
function fakeWindow() {
  const listeners = [];
  return { listeners, addEventListener: (t, f) => { if (t === 'storage') listeners.push(f); },
    fire: (e) => listeners.forEach((f) => f(e)) };
}

// updateNothingToLose as the page has it, given the four maps, the typed boxes and the open agent and project.
function nothingToLose({ maps, typed = [], current = null, pjCurrent = null, draftsKept, keptDraftStored = () => null,
  dmReply = {}, pjReply = {}, composingSince = 0, pjLastOpened = null }) {
  const typedSet = new Set(typed.map((t) => ({ isConnected: true, ...t })));
  return new Function('TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'UPDATE_TYPED', 'CURRENT', 'PJ_CURRENT',
    'draftsKept', 'keptDraftStored', 'DM_REPLY', 'PJ_REPLY', 'ATTACH_PENDING', 'tipModalOpen',
    'UPDATE_COMPOSING_SINCE', 'UPDATE_COMPOSING_MAX_MS', 'PJ_LAST_OPENED',
    page.liftAll(SCRIPT, ['updateNothingToLose']) + '\nreturn updateNothingToLose();')(
    maps.talk || {}, maps.term || {}, maps.pj || {}, maps.room || {}, typedSet, current, pjCurrent,
    draftsKept, keptDraftStored, dmReply, pjReply, { room: {}, agent: {} }, () => false,
    composingSince, 60 * 1000, pjLastOpened);
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
  // The page's CURRENT (the open agent, which keys the chat box's draft), not an agent card or roster row.
  const sessionName = 'april';
  const current = { sessionName };
  assert.equal(nothingToLose({ maps: { talk }, typed: [{ id: 'd-say', value: 'half a sentence' }], current, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), true,
    'the chat box holding exactly its kept draft held the restart');
  assert.equal(nothingToLose({ maps: { talk }, typed: [{ id: 'd-say', value: 'half a sentence and more' }], current, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), false,
    'words in the box beyond the kept draft did not hold the restart');
  assert.equal(nothingToLose({ maps: { talk }, typed: [{ id: 'new-task-title', value: 'Write the brief' }], current, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), false,
    'CONTROL: another typed box with words did not hold the restart');
  const pj = h.keptDrafts('pj');
  pj.p7 = 'a project message';
  assert.equal(nothingToLose({ maps: { pj }, typed: [{ id: 'pj-say', value: 'a project message' }], pjCurrent: 'p7', draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), true,
    "the project box holding exactly its kept draft held the restart");
});

test('#9132 review 1: two tabs of one board writing the same agent\'s draft: the overwritten tab is NOT kept', () => {
  const storage = memoryStorage();
  const tabA = helper(storage), tabB = helper(storage);
  const a = tabA.keptDrafts('talk'), b = tabB.keptDrafts('talk');
  b.april = 'words typed in tab B';
  a.april = 'words typed in tab A';   // tab A writes the same key later: storage now holds A's
  assert.equal(tabB.draftsKept(b), false, 'tab B counted its words as kept although a reload would bring back tab A\'s');
  assert.equal(nothingToLose({ maps: { talk: b }, draftsKept: tabB.draftsKept, keptDraftStored: tabB.keptDraftStored }), false,
    'tab B would restart and lose its words');
  assert.equal(tabA.draftsKept(a), true, 'CONTROL: the tab whose words are in storage is kept');
});

test('#9132 review 1: a reply being written holds the restart; a reply picked with no words does not', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk');
  talk.april = 'yes, that one';
  const reply = { april: { at: '2026-11-26T09:00:00Z', words: 'the earlier message' } };
  assert.equal(nothingToLose({ maps: { talk }, dmReply: reply, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), false,
    'a restart would keep the words and lose what they reply to');
  assert.equal(nothingToLose({ maps: { talk: h.keptDrafts('term') }, dmReply: reply, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), true,
    'CONTROL: a reply with nothing typed held the restart (it never did)');
  const pj = h.keptDrafts('pj');
  pj.p7 = 'answering above';
  assert.equal(nothingToLose({ maps: { pj }, pjReply: { p7: { id: 'm1' } }, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), false,
    'a project reply being written did not hold the restart');
});

test('#9132 review 1: a removed agent\'s or project\'s drafts are forgotten, and logging out forgets every one', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk'), room = h.keptDrafts('room');
  talk.april = 'for April'; talk.roo = 'for Roo'; room.p1 = 'a post';
  h.forgetDrafts([talk, h.keptDrafts('term')], 'april');
  assert.equal(storage.data.has('kosmos.draft.talk.april'), false, 'a removed agent\'s draft stayed in storage');
  assert.equal(helper(storage).keptDrafts('talk').april, undefined, 'a new agent of the same name would inherit the old words');
  assert.equal(storage.data.has('kosmos.draft.talk.roo'), true, 'CONTROL: another agent\'s draft was forgotten too');
  storage.data.set('other.key', 'kept');
  h.forgetAllDrafts();
  assert.deepEqual([...storage.data.keys()], ['other.key'], 'logging out left a kept draft, or took something that is not one');
});

test('#9132 round 2: an open composition holds the restart, but never one older than a minute (its end never came)', () => {
  const h = helper(memoryStorage());
  assert.equal(nothingToLose({ maps: {}, composingSince: Date.now() - 1000, draftsKept: h.draftsKept }), false,
    'a composition being typed did not hold the restart');
  assert.equal(nothingToLose({ maps: {}, composingSince: Date.now() - 61 * 1000, draftsKept: h.draftsKept }), true,
    'a composition whose end never arrived held the restart for good');
  assert.equal(nothingToLose({ maps: {}, composingSince: 0, draftsKept: h.draftsKept }), true, 'CONTROL: no composition, nothing held');
  assert.match(SCRIPT, /addEventListener\('focusout', \(\) => \{ UPDATE_COMPOSING_SINCE = 0; \}, true\)/, 'leaving the box does not clear it');
});

test('#9132 round 2: another tab sending or changing a draft updates this tab\'s copy, and nothing is written back', () => {
  const storage = memoryStorage();
  const win = fakeWindow();
  const h = helper(storage, win);
  const talk = h.keptDrafts('talk');
  talk.april = 'typed here';
  // Another tab sent it: its own page deleted the stored entry; this one hears the storage event.
  storage.data.delete('kosmos.draft.talk.april');
  win.fire({ key: 'kosmos.draft.talk.april', newValue: null });
  assert.equal(talk.april, undefined, 'a draft another tab sent stayed in this tab\'s copy');
  assert.equal(h.draftsKept(talk), true, 'this tab still counted words that are gone everywhere');
  // Another tab typed more for Roo.
  const rec = JSON.stringify({ v: 'from the other tab', t: Date.now() });
  storage.data.set('kosmos.draft.talk.roo', rec);
  win.fire({ key: 'kosmos.draft.talk.roo', newValue: rec });
  assert.equal(talk.roo, 'from the other tab');
  assert.equal(storage.data.get('kosmos.draft.talk.roo'), rec, 'hearing the event wrote it back (a new time)');
  win.fire({ key: 'kosmos.draft.term.roo', newValue: JSON.stringify({ v: 'a terminal draft', t: Date.now() }) });
  assert.equal(talk.roo, 'from the other tab', 'CONTROL: an event for another kind of draft changed this map');
  assert.equal(talk['__proto__'], undefined, 'premise');
  talk['__proto__'] = 'an agent named __proto__';
  assert.equal(helper(storage).keptDrafts('talk')['__proto__'], 'an agent named __proto__', 'an odd agent name was not kept as a key');
});

test('#9132 round 3: a project box after Back (PJ_CURRENT null) belongs to the project last opened, and does not hold the restart', () => {
  const h = helper(memoryStorage());
  const room = h.keptDrafts('room');
  room.p7 = 'a post for the room';
  const typed = [{ id: 'pj-post', value: 'a post for the room' }];
  assert.equal(nothingToLose({ maps: { room }, typed, pjCurrent: null, pjLastOpened: 'p7', draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), true,
    'words left in a room box after Back held the restart until another project was opened');
  assert.equal(nothingToLose({ maps: { room }, typed, pjCurrent: null, pjLastOpened: null, draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), false,
    'CONTROL: with no project to belong to, the words hold the restart');
  assert.equal(nothingToLose({ maps: { room }, typed: [{ id: 'pj-post', value: 'newer words' }], pjCurrent: null, pjLastOpened: 'p7',
    draftsKept: h.draftsKept, keptDraftStored: h.keptDraftStored }), false, 'words beyond the kept draft did not hold the restart');
});

test('#9132 round 3: another tab\'s change reaches the open box when it still shows the old copy, never over newer typing', () => {
  const box = { id: 'd-say', value: 'old words' };
  const sessionName = 'april';
  const openAgent = { sessionName };   // the page's CURRENT (the open agent), not an agent card
  const heard = new Function('document', 'CURRENT', 'PJ_CURRENT', 'PJ_LAST_OPENED', 'pjGrowComposer',
    page.liftAll(SCRIPT, ['keptDraftHeard']) + '\nreturn keptDraftHeard;')(
    { getElementById: (id) => (id === 'd-say' ? box : null) }, openAgent, null, null, () => {});
  heard('talk', 'april', 'old words', 'newer words from the other tab');
  assert.equal(box.value, 'newer words from the other tab', 'the open box kept a copy storage no longer holds');
  box.value = 'typed here since';
  heard('talk', 'april', 'newer words from the other tab', 'yet another');
  assert.equal(box.value, 'typed here since', "the other tab's words replaced this person's newer typing");
  box.value = 'x';
  heard('talk', 'roo', 'x', 'for Roo');
  assert.equal(box.value, 'x', 'CONTROL: a change for another agent reached the open box');
  heard('talk', 'april', 'x', '');
  assert.equal(box.value, '', 'a draft the other tab sent stayed in the open box');
});
