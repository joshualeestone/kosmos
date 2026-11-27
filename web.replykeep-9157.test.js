'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9157 (follow-up to #9132): a reply being written is kept across a reload with its draft.
 *
 * #9132 kept half-typed words, but a reply's target (DM_REPLY in a chat, PJ_REPLY in a room) lived only on the page,
 * so a reply with words still held the Mac window's restart onto an update, and one left in a chat that was never
 * reopened held it until it was sent or cancelled. Now both maps are kept maps (keptDrafts with KEPT_DM_REPLY_OPTS and KEPT_PJ_REPLY_OPTS): the
 * target comes back after a reload, and only a reply map that is NOT kept holds the restart.
 *
 * The page's own helper and updateNothingToLose are lifted, not rewritten here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const START = SCRIPT.indexOf('const KEPT_DRAFT_DAYS');
const END_AT = SCRIPT.indexOf('function draftsKept(m)');
const END = SCRIPT.indexOf('\n}\n', END_AT) + 3;
const HELPER = SCRIPT.slice(START, END);

function memoryStorage({ failWrites = false, failPrefix = null } = {}) {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failWrites || (failPrefix && k.indexOf(failPrefix) === 0)) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
  };
}
function helper(storage) {
  return new Function('localStorage', 'window', HELPER
    + '\nreturn { keptDrafts, draftsKept, keptDraftStored, forgetDrafts, forgetAllDrafts, KEPT_DM_REPLY_OPTS, KEPT_PJ_REPLY_OPTS };')(storage, undefined);
}
function nothingToLose(h, { talk = {}, room = {}, dmReply = {}, pjReply = {} }) {
  return new Function('TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'UPDATE_TYPED', 'CURRENT', 'PJ_CURRENT',
    'draftsKept', 'keptDraftStored', 'DM_REPLY', 'PJ_REPLY', 'ATTACH_PENDING', 'tipModalOpen',
    'UPDATE_COMPOSING_SINCE', 'UPDATE_COMPOSING_MAX_MS', 'PJ_LAST_OPENED',
    page.liftAll(SCRIPT, ['updateNothingToLose']) + '\nreturn updateNothingToLose();')(
    talk, {}, {}, room, new Set(), null, null, h.draftsKept, h.keptDraftStored, dmReply, pjReply,
    { room: {}, agent: {} }, () => false, 0, 60 * 1000, null);
}
const REPLY = { at: '2026-11-26T09:00:00Z', from: 'april', who: 'April', words: 'the earlier message' };

test('#9157 premise: both reply maps are kept maps in the page', () => {
  assert.ok(START > 0 && END > END_AT, 'the keptDrafts block was not found');
  assert.match(SCRIPT, /const DM_REPLY = keptDrafts\('dmreply', KEPT_DM_REPLY_OPTS\);/);
  assert.match(SCRIPT, /const PJ_REPLY = keptDrafts\('pjreply', KEPT_PJ_REPLY_OPTS\);/);
  // Review 6: each reply map is paired with the draft kind its words really live in (a mistyped pair would never bring
  // a reply back, and every other test would stay green).
  assert.match(SCRIPT, /const TALK_DRAFTS = keptDrafts\('talk'\);/);
  assert.match(SCRIPT, /const PJ_ROOM_DRAFTS = keptDrafts\('room'\);/);
  assert.match(SCRIPT, /const KEPT_DM_REPLY_OPTS = \{[^}]*pair: 'talk'[,\s}]/);
  assert.match(SCRIPT, /const KEPT_PJ_REPLY_OPTS = \{[^}]*pair: 'room'[,\s}]/);
  // A property set on a stored reply would bypass the kept map (the room's @mention is written as a new object).
  // Review 1: an assignment (not ==/===) to any field of either map's entry.
  const inPlace = SCRIPT.match(/(DM_REPLY|PJ_REPLY)\[[^\]]+\]\.[A-Za-z_$]+\s*(\+|-)?=(?!=)/g) || [];
  assert.deepEqual(inPlace, [], 'a reply field is set in place, so storage never sees it');
});

test('#9157: a chat reply comes back after a reload, still answering its message', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk');
  talk.april = 'yes, that one';   // review 2: a reply comes back only with words beside it
  const replies = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  replies.april = REPLY;
  const after = helper(storage).keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  assert.deepEqual({ ...after.april }, REPLY);
  delete after.april;   // sent or cancelled
  assert.equal(helper(storage).keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS).april, undefined, 'a cancelled reply came back');
});

test('#9157: a kept reply with words no longer holds the restart; an unkept one still does (control)', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk');
  talk.april = 'yes, that one';
  const dmReply = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  dmReply.april = REPLY;
  assert.equal(nothingToLose(h, { talk, dmReply }), true, 'a kept reply still held the restart');
  assert.equal(nothingToLose(h, { talk, dmReply: { april: REPLY } }), false,
    'CONTROL: a plain (unkept) reply with words must hold the restart');
  const room = h.keptDrafts('room');
  room.p7 = 'answering above';
  const pjReply = h.keptDrafts('pjreply', h.KEPT_PJ_REPLY_OPTS);
  pjReply.p7 = { id: 'm1', who: 'Roo', words: 'a post', mention: '@roo ' };
  assert.equal(nothingToLose(h, { room, pjReply }), true, 'a kept room reply still held the restart');
});

test('#9157: a reply storage refused still holds the restart, though its words are kept', () => {
  // Review 2: one helper and one storage, refusing only the reply's keys, so the words ARE kept and the reply alone
  // is what holds.
  const h = helper(memoryStorage({ failPrefix: 'kosmos.draft.dmreply.' }));
  const talk = h.keptDrafts('talk');
  talk.april = 'yes, that one';
  const dmReply = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  dmReply.april = REPLY;
  assert.equal(h.draftsKept(talk), true, 'CONTROL: the words are kept');
  assert.equal(h.draftsKept(dmReply), false, 'a refused write counted as kept');
  assert.equal(nothingToLose(h, { talk, dmReply }), false, 'a reply that could not be kept let the restart through');
});

test('#9157: a reply another tab replaced is not kept here; the room mention counts as part of the reply', () => {
  const storage = memoryStorage();
  const tabA = helper(storage);
  const a = tabA.keptDrafts('pjreply', tabA.KEPT_PJ_REPLY_OPTS);
  a.p7 = { id: 'm1', mention: '@roo ' };
  assert.equal(tabA.draftsKept(a), true, 'CONTROL: the reply just written is kept');
  // Another tab (no storage event delivered here) answers a different post in the same room.
  storage.setItem('kosmos.draft.pjreply.p7', JSON.stringify({ v: { id: 'm2', mention: '@roo ' }, t: Date.now() }));
  assert.equal(tabA.draftsKept(a), false, 'this tab would restart and come back answering the other post');
  // Review 1: the same post, only the @mention differs: still not what this tab holds.
  storage.setItem('kosmos.draft.pjreply.p7', JSON.stringify({ v: { id: 'm1', mention: null }, t: Date.now() }));
  assert.equal(tabA.draftsKept(a), false, 'a different @mention counted as the same reply');
  a.p7 = Object.assign({}, a.p7, { mention: null });
  assert.equal(tabA.draftsKept(a), true, 'CONTROL: once this tab writes again it is kept');
});

test('#9157: a reply is forgotten with its agent or project, and on log out', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const dmReply = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  const pjReply = h.keptDrafts('pjreply', h.KEPT_PJ_REPLY_OPTS);
  dmReply.april = REPLY; dmReply.roo = REPLY; pjReply.p7 = { id: 'm1' };
  h.forgetDrafts([dmReply], 'april');
  assert.equal(storage.getItem('kosmos.draft.dmreply.april'), null, 'a removed agent\'s reply stayed in storage');
  assert.notEqual(storage.getItem('kosmos.draft.dmreply.roo'), null, 'CONTROL: another agent\'s reply was forgotten too');
  h.forgetAllDrafts();
  assert.equal(storage.data.size, 0, 'log out left a reply in storage');
  assert.match(SCRIPT, /forgetDrafts\(\[TALK_DRAFTS, TERM_DRAFTS, typeof DM_REPLY !== 'undefined' && DM_REPLY\], name\)/);
  assert.match(SCRIPT, /forgetDrafts\(\[PJ_DRAFTS, PJ_ROOM_DRAFTS, PJ_REPLY\], p\.id\)/);
});

test('#9157 review 1/5: saving the words re-saves the reply beside them, so a reply never ages out before them', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const day = 24 * 60 * 60 * 1000;
  const talk = h.keptDrafts('talk');
  const dm = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  dm.april = REPLY;   // Reply pressed on day 0 ...
  storage.setItem('kosmos.draft.dmreply.april', JSON.stringify({ v: REPLY, t: Date.now() - 10 * day }));   // ... ten days ago
  talk.april = 'typed on day ten';   // the words are typed now, on the page holding the reply
  const rec = JSON.parse(storage.getItem('kosmos.draft.dmreply.april'));
  const words = JSON.parse(storage.getItem('kosmos.draft.talk.april'));
  assert.ok(rec.t >= words.t, 'the reply was not re-saved with its words, so it would age out first');
  assert.equal(helper(storage).keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS).april.at, REPLY.at, 'the reply did not come back with its words');
  // CONTROL: words for an agent with no reply here re-save nothing.
  talk.roo = 'words for roo';
  assert.equal(storage.getItem('kosmos.draft.dmreply.roo'), null, 'CONTROL: a reply appeared for words that have none');
});

test('#9157 review 2: a reply picked with nothing typed after it is not brought back by a reload', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const replies = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  replies.april = REPLY;
  replies.roo = REPLY;
  h.keptDrafts('talk').roo = 'words for roo';
  const after = helper(storage).keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  assert.equal(after.april, undefined, 'a reply with no words came back: the next message would go out as a reply');
  assert.equal(after.roo && after.roo.at, REPLY.at, 'CONTROL: a reply with words beside it comes back');
  const pjStore = memoryStorage();
  const hp = helper(pjStore);
  hp.keptDrafts('pjreply', hp.KEPT_PJ_REPLY_OPTS).p7 = { id: 'm1' };
  assert.equal(helper(pjStore).keptDrafts('pjreply', hp.KEPT_PJ_REPLY_OPTS).p7, undefined, 'a room reply with no words came back');
});

// Review 3/5: tabs of one board share one storage; a write or removal in one tab is heard as a storage event in the
// others, delivered later (never inside the writing call), as a browser does.
function sharedStorage() {
  const data = new Map();
  const tabs = [];
  const tab = () => {
    const listeners = [];
    const me = { listeners };
    const fire = (key, newValue) => setImmediate(() => tabs.filter((t) => t !== me).forEach((t) => t.listeners.forEach((f) => f({ key, newValue }))));
    me.storage = {
      get length() { return data.size; },
      key: (i) => [...data.keys()][i] ?? null,
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => { data.set(k, String(v)); fire(k, String(v)); },
      removeItem: (k) => { if (data.has(k)) { data.delete(k); fire(k, null); } },
    };
    me.win = { addEventListener: (t, f) => { if (t === 'storage') listeners.push(f); } };
    tabs.push(me);
    return me;
  };
  return { data, tab };
}
// A page's maps in the page's order: the words map first, then the reply map.
function tabPage(shared) {
  const t = shared.tab();
  const h = new Function('localStorage', 'window', HELPER
    + '\nreturn { keptDrafts, draftsKept, KEPT_DM_REPLY_OPTS };')(t.storage, t.win);
  return { h, talk: h.keptDrafts('talk'), dm: h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS) };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

test('#9157 review 3/5: another tab loading writes nothing, so a reply this tab just picked is untouched', async () => {
  const shared = sharedStorage();
  const one = tabPage(shared);
  one.dm.april = REPLY;   // Reply pressed in tab 1, nothing typed yet
  await settle();
  const before = shared.data.get('kosmos.draft.dmreply.april');
  const two = tabPage(shared);
  await settle();
  assert.equal(shared.data.get('kosmos.draft.dmreply.april'), before, 'a load changed the stored reply');
  assert.equal(one.dm.april && one.dm.april.at, REPLY.at, 'another tab loading ended the reply tab 1 is writing');
  assert.equal(two.dm.april, undefined, 'a reply with nothing typed after it was brought back by a load');
});

test('#9157 review 5: words typed where the reply is not never come back as that reply', async () => {
  const shared = sharedStorage();
  const one = tabPage(shared);
  one.dm.april = REPLY;   // tab 1: Reply pressed, nothing typed
  await settle();
  const two = tabPage(shared);   // tab 2 loads: no reply shown there
  await settle();
  // Review 6: a real gap. Equal milliseconds count as "beside" (the re-save writes words and reply in one), and no
  // person clicks Reply in one tab and types in another within the same millisecond.
  await new Promise((r) => setTimeout(r, 5));
  two.talk.april = 'an unrelated message';   // typed in tab 2, newer than the reply
  await settle();
  const three = tabPage(shared);   // a reload (or the restart onto an update)
  assert.equal(three.dm.april, undefined, 'the unrelated words came back as a reply to a message nobody here picked');
  assert.equal(three.talk.april, 'an unrelated message', 'CONTROL: the words themselves came back');
  // Tab 1 still shows the reply beside words now newer than it: a reload would not bring it back, so it is not kept,
  // and its restart waits (as before this change).
  assert.equal(one.h.draftsKept(one.dm), false, 'tab 1 counted as kept a reply a reload would drop');
});

test('#9157 review 5: words typed beside the reply bring it back, in every tab (control for the above)', async () => {
  const shared = sharedStorage();
  const one = tabPage(shared);
  const two = tabPage(shared);
  one.dm.april = REPLY;
  one.talk.april = 'yes, that one';
  await settle();
  assert.equal(two.dm.april && two.dm.april.at, REPLY.at, 'tab 2 did not hear the reply');
  assert.equal(two.talk.april, 'yes, that one', 'tab 2 did not hear the words');
  assert.equal(one.h.draftsKept(one.dm), true, 'a reply a reload brings back is not counted as kept');
  assert.equal(tabPage(shared).dm.april.at, REPLY.at, 'a reload did not bring the reply back with its words');
  delete two.dm.april;   // x in tab 2
  await settle();
  assert.equal(one.dm.april, undefined, 'cancelling in tab 2 did not end the reply in tab 1');
});

test('#9157 review 6: a room reply comes back after a reload with its @mention, beside the words in the post box', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const room = h.keptDrafts('room');
  const pj = h.keptDrafts('pjreply', h.KEPT_PJ_REPLY_OPTS);
  pj.p7 = { id: 'm1', from: 'roo', who: 'Roo', words: 'a post', mention: null };
  pj.p7 = Object.assign({}, pj.p7, { mention: '@roo ' });   // as pjReplyMention writes it
  room.p7 = '@roo yes, that one';
  assert.equal(h.draftsKept(pj), true, 'a room reply beside its words is not counted as kept');
  const after = helper(storage);
  after.keptDrafts('room');
  const back = after.keptDrafts('pjreply', h.KEPT_PJ_REPLY_OPTS).p7;
  assert.equal(back && back.id, 'm1', 'a room reply did not come back with its words');
  assert.equal(back && back.mention, '@roo ', 'the @mention Reply put in the box did not come back with it');
  // CONTROL: words typed in another project's box bring nothing back for this one.
  const other = memoryStorage();
  const ho = helper(other);
  ho.keptDrafts('room').p8 = 'other words';
  ho.keptDrafts('pjreply', ho.KEPT_PJ_REPLY_OPTS).p7 = { id: 'm1', mention: null };
  assert.equal(helper(other).keptDrafts('pjreply', ho.KEPT_PJ_REPLY_OPTS).p7, undefined, 'CONTROL: a room reply came back with no words of its own');
});

test('#9157 review 7: words typed while a reply is on its way do not re-save it, so a reload brings them back plain', async () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const talk = h.keptDrafts('talk');
  const dm = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  talk.april = 'yes, that one';
  dm.april = REPLY;
  delete talk.april;   // Enter: the box empties and its words are let go; the reply stays until the send answers
  globalThis.DM_REPLY_SENDING = { agent: 'april', at: REPLY.at };
  try {
    await new Promise((r) => setTimeout(r, 5));   // a person types after pressing Enter, never in the same millisecond
    talk.april = 'and another thing';   // the NEXT message, typed while the reply is still on its way
    const after = helper(storage);
    after.keptDrafts('talk');
    assert.equal(after.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS).april, undefined,
      'a reload during the send brought the reply back beside the next message: it would go out as a second reply');
  } finally {
    delete globalThis.DM_REPLY_SENDING;
  }
  // CONTROL: the send failed (nothing in flight now) and the person types again: the reply is re-saved with them.
  await new Promise((r) => setTimeout(r, 5));
  talk.april = 'and another thing, again';
  const later = helper(storage);
  later.keptDrafts('talk');
  assert.equal(later.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS).april.at, REPLY.at, 'CONTROL: with nothing in flight the reply did not come back');
});
