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

function memoryStorage({ failWrites = false } = {}) {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); data.set(k, String(v)); },
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
  // A property set on a stored reply would bypass the kept map (the room's @mention is written as a new object).
  // Review 1: an assignment (not ==/===) to any field of either map's entry.
  const inPlace = SCRIPT.match(/(DM_REPLY|PJ_REPLY)\[[^\]]+\]\.[A-Za-z_$]+\s*(\+|-)?=(?!=)/g) || [];
  assert.deepEqual(inPlace, [], 'a reply field is set in place, so storage never sees it');
});

test('#9157: a chat reply comes back after a reload, still answering its message', () => {
  const storage = memoryStorage();
  const h = helper(storage);
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

test('#9157: a reply storage refused still holds the restart', () => {
  const ok = memoryStorage();
  const h = helper(ok);
  const talk = h.keptDrafts('talk');
  talk.april = 'yes, that one';
  const refusing = helper(memoryStorage({ failWrites: true }));
  const dmReply = refusing.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  dmReply.april = REPLY;
  assert.equal(refusing.draftsKept(dmReply), false, 'a refused write counted as kept');
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

test('#9157 review 1: a reply older than the age-out is kept while its words are still fresh, and goes with them', () => {
  const storage = memoryStorage();
  const h = helper(storage);
  const day = 24 * 60 * 60 * 1000;
  storage.setItem('kosmos.draft.dmreply.april', JSON.stringify({ v: REPLY, t: Date.now() - 15 * day }));
  storage.setItem('kosmos.draft.talk.april', JSON.stringify({ v: 'typed on day ten', t: Date.now() - 5 * day }));
  storage.setItem('kosmos.draft.dmreply.roo', JSON.stringify({ v: REPLY, t: Date.now() - 15 * day }));   // no words
  storage.setItem('kosmos.draft.pjreply.p7', JSON.stringify({ v: { id: 'm1' }, t: Date.now() - 15 * day }));
  storage.setItem('kosmos.draft.room.p7', JSON.stringify({ v: 'room words', t: Date.now() - 1 * day }));
  const dm = h.keptDrafts('dmreply', h.KEPT_DM_REPLY_OPTS);
  const pj = h.keptDrafts('pjreply', h.KEPT_PJ_REPLY_OPTS);
  assert.equal(dm.april && dm.april.at, REPLY.at, 'the reply aged out while its words came back: Send would post them plain');
  assert.equal(pj.p7 && pj.p7.id, 'm1', 'a room reply aged out while its words came back');
  assert.equal(dm.roo, undefined, 'CONTROL: an old reply with no words beside it still ages out');
  assert.equal(storage.getItem('kosmos.draft.dmreply.roo'), null, 'CONTROL: and leaves storage');
});
