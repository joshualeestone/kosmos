'use strict';

/**
 * The top-left toast, in the state where an update landed behind an open tab.
 *
 * #3955 (Josh, 2026-09-26: "It looks terrible and it's gigantic ... it says 'You're looking at the
 * previous version.' That doesn't make sense"; Mona Lisa's mock): both update states are now one
 * small chip with one action. The page-is-old state reads "Reload to finish updating" and never
 * says "Kosmos updated" while the old page is on screen; the offer reads "An update is available".
 *
 * 🛑 JOSH ASKED FOR THIS IN HIS OWN WORDS, 2026-08-22: "maybe if we push an
 * update we still pop the message at the top left to say, Kosmos has been
 * updated. Refresh your browser to install it". The wording moved because by
 * then it IS installed and only the window is behind: "install" sends somebody
 * hunting a problem that does not exist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function toast({ baked, served, offer, updating = false, later = null, engine = null }) {
  const slot = { dataset: {}, innerHTML: '' };
  const listeners = [];
  const doc = {
    getElementById: (id) => (id === 'utoast-slot' ? slot : { addEventListener: (_, f) => listeners.push(f), focus() {}, hidden: true }),
    querySelector: () => (baked === undefined ? null : { getAttribute: () => baked }),
  };
  new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterSuppresses', 'UPD_CONFIRM_OPENER', 'OFFER', 'ENGINE_STALE',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'updateSafeReload', 'renderUpdateToast'])
    + '\nrenderUpdateToast(OFFER);')(doc, (x) => String(x), updating, served, (v) => later === v, null, offer, engine);
  return { html: slot.innerHTML, v: slot.dataset.v, listeners };
}

test('a board running older engine code than the disk says so, and outranks both other states (#338)', () => {
  // Shape agreed with Angel 2026-08-23: `engine: { startedAt, staleSince }`,
  // staleSince null when current, always present. The server test pins it.
  const engine = { startedAt: '2026-08-23T11:51:00Z', staleSince: '2026-08-23T15:30:00Z' };
  const t = toast({ baked: '0.2.75', served: '0.2.76', offer: { version: '0.2.77' }, engine });
  assert.equal(t.v, 'engine');
  assert.match(t.html, /Kosmos changed on disk/);
  assert.match(t.html, /running code from \d/);
  assert.match(t.html, /kosmos restart/);
  assert.doesNotMatch(t.html, /previous version|ut-reload|0\.2\.77/, 'a lower state rendered beside the one that settles it');
  // Null and a current engine fall through to the states below.
  for (const e of [null, { startedAt: '2026-08-23T11:51:00Z', staleSince: null }]) {
    const f = toast({ baked: '0.2.75', served: '0.2.76', engine: e });
    assert.equal(f.v, 'stale', 'an engine that is not stale hid the page-stale state');
  }
});

test('a page older than the running Kosmos says so, and offers the one thing that fixes it', () => {
  const t = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.match(t.html, /Reload to finish updating/);
  assert.match(t.html, /id="ut-reload">Reload</);
  /* #3955: "Kosmos updated" over the old page read as done, and "previous version" as nonsense. */
  assert.doesNotMatch(t.html, /Kosmos updated|previous version/, 'the old page claimed the update was done');
});

test('it does not say install, and it does not say refresh your browser', () => {
  /* ⚠️ THE UPDATE ALREADY HAPPENED. The agents are on the new version and only
     this window is behind, so "install" describes work that is done and sends
     the person looking for a failure that did not occur. */
  const t = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.ok(!/Install/i.test(t.html), 'it tells them to install something that is already installed');
});

test('one action: no Later and nothing to close', () => {
  /* Later on the shipped toast defers an install, a real change to the machine.
     Here there is nothing to defer: dismissing would not make the page current,
     so the button would lie about what it did. */
  const t = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.ok(!/ut-later|Later|Dismiss|aria-label="Close"/i.test(t.html));
  assert.equal((t.html.match(/<button/g) || []).length, 1);
});

test('#3955: neither chip carries a version number (the confirm and Settings name it)', () => {
  const stale = toast({ baked: '0.2.75', served: '0.2.76' });
  assert.ok(!/0\.2\.7[56]/.test(stale.html));
  const offer = toast({ baked: '0.2.76', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.match(offer.html, /An update is available/);
  assert.ok(!/0\.2\.77/.test(offer.html), 'the chip grew a version number back');
});

test('#3955: the offer is one small chip with one action, Update (no Later)', () => {
  const offer = toast({ baked: '0.2.76', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.equal((offer.html.match(/<button/g) || []).length, 1);
  assert.match(offer.html, /id="ut-install">Update</);
  assert.doesNotMatch(offer.html, /ut-later|Later/);
});

test('#3955: both states are the one chip component (Mona Lisa\'s mock A and B)', () => {
  const stale = toast({ baked: '0.2.75', served: '0.2.76' });
  const offer = toast({ baked: '0.2.76', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.match(stale.html, /^<div class="uchip" role="status">/);
  assert.match(offer.html, /^<div class="uchip" role="status">/);
  assert.match(PAGE, /\.uchip \{ display: inline-flex;[^}]*height: 30px;/, 'the chip is not the small one-line shape');
  // The engine state keeps its own (unchanged) look.
  assert.match(PAGE, /\.utoast\.stale \{ --utone: var\(--label-2\); \}/);
});

test('when both are true, the reload state wins', () => {
  /* 🛑 THE CASE THAT ONLY APPEARED WHEN IT WAS DRAWN (Mona Lisa): page 0.2.75,
     server 0.2.76, and 0.2.77 published. Installing 0.2.77 from a 0.2.75 page
     compounds the staleness rather than resolving it, and the person would be
     acting on a screen already wrong about what it is. */
  const t = toast({ baked: '0.2.75', served: '0.2.76', offer: { version: '0.2.77' } });
  assert.match(t.html, /Reload to finish updating/);
  assert.ok(!/update is available/.test(t.html), 'it offered an install from a page that is already behind');
});

test('an install in flight owns the slot', () => {
  const t = toast({ baked: '0.2.75', served: '0.2.76', updating: true });
  assert.equal(t.html, '', 'the reload state interrupted an update that is running');
});

test('agreement, a failed poll, and a source checkout are all quiet', () => {
  assert.equal(toast({ baked: '0.2.76', served: '0.2.76' }).html, '');
  /* ⚠️ Both numbers or nothing: announcing a reload against a version we do not
     have would be inventing a newer one. */
  assert.equal(toast({ baked: '0.2.76', served: null }).html, '');
  assert.equal(toast({ baked: '__KOSMOS_VERSION__', served: '0.2.76' }).html, '');
  assert.equal(toast({ baked: undefined, served: '0.2.76' }).html, '');
});

test('the same page is not repainted every five seconds', () => {
  /* The slot is a role="status" live region and the poll runs every five
     seconds; rewriting an identical node re-announces it on some screen
     readers. Same guard the offer state already had. */
  const slot = { dataset: {}, innerHTML: '' };
  const doc = {
    getElementById: (id) => (id === 'utoast-slot' ? slot : { addEventListener() {}, focus() {}, hidden: true }),
    querySelector: () => ({ getAttribute: () => '0.2.75' }),
  };
  const run = new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterSuppresses', 'ENGINE_STALE',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'updateSafeReload', 'renderUpdateToast'])
    + '\nreturn renderUpdateToast;')(doc, (x) => String(x), false, '0.2.76', () => false, null);
  run(null);
  slot.innerHTML = 'MARKED';
  run(null);
  assert.equal(slot.innerHTML, 'MARKED', 'the toast repainted itself over an unchanged state');
});

/* #3955: the page reloads itself, but only when that cannot lose anything. */
function safeReload({ hidden = true, served = '0.2.76', sending = {}, drafts = {}, typed = [], attached = null, modal = false, already = null } = {}) {
  const store = { 'kosmos-auto-reloaded': already };
  let reloaded = 0;
  const doc = { hidden };
  // Fields the person typed into (the page's own 'input' listener collects them), with what they hold now.
  const typedSet = new Set(typed.map((v) => ({ value: v, isConnected: true })));
  const ss = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const win = { location: { reload: () => { reloaded += 1; } } };
  const got = new Function('document', 'sessionStorage', 'window', 'TALK_SENDING', 'PJ_SENDING', 'PJ_REPLY_SENDING', 'TERM_SENDING',
    'TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'tipModalOpen', 'UPDATE_TYPED', 'ATTACH_PENDING',
    page.liftAll(SCRIPT, ['updateSafeReload']) + '\nreturn updateSafeReload(' + JSON.stringify(served) + ');')(
    doc, ss, win, !!sending.talk, !!sending.pj, sending.reply || null, !!sending.term,
    drafts.talk || {}, drafts.term || {}, drafts.pj || {}, drafts.room || {}, () => modal, typedSet,
    attached || { room: {}, agent: {} });
  return { got, reloaded, store };
}

test('#3955: an old page in the background with nothing in hand reloads itself, once per version', () => {
  const r = safeReload();
  assert.equal(r.got, true);
  assert.equal(r.reloaded, 1);
  assert.equal(r.store['kosmos-auto-reloaded'], '0.2.76');
  assert.equal(safeReload({ already: '0.2.76' }).reloaded, 0, 'a board that keeps serving an old page would make a reload loop');
  assert.equal(safeReload({ already: '0.2.75' }).reloaded, 1, 'CONTROL: a newer version reloads again');
});

test('#3955: it never reloads a page someone is looking at, sending from, typing in, attaching to, or reading a window over', () => {
  /* Typed, not filled (review round 1): the page fills boxes itself (an agent's instructions), and
     only fields the person typed into count; the page collects those with one 'input' listener. */
  assert.match(SCRIPT, /document\.addEventListener\('input', \(e\) => \{ if \(updateTypedBox\(e\.target\)\) UPDATE_TYPED\.add\(e\.target\); \}, true\);/);
  assert.doesNotMatch(page.liftAll(SCRIPT, ['updateSafeReload']), /querySelectorAll\('textarea'\)/, 'every filled textarea blocks the reload again');
  assert.equal(safeReload({ hidden: false }).reloaded, 0, 'reloaded the page in front of the person');
  assert.equal(safeReload({ sending: { talk: true } }).reloaded, 0, 'reloaded mid-send');
  assert.equal(safeReload({ sending: { reply: { project: 'p', id: 1 } } }).reloaded, 0, 'reloaded mid-reply');
  assert.equal(safeReload({ drafts: { talk: { april: 'half a thought' } } }).reloaded, 0, 'lost a draft');
  assert.equal(safeReload({ drafts: { room: { p: { text: 'draft' } } } }).reloaded, 0, 'lost a room draft');
  assert.equal(safeReload({ typed: ['a task comment, half typed'] }).reloaded, 0, 'lost words typed into a field');
  assert.equal(safeReload({ attached: { room: { p1: [{ name: 'a.png' }] }, agent: {} } }).reloaded, 0, 'lost a file waiting to be sent');
  assert.equal(safeReload({ modal: true }).reloaded, 0, 'reloaded under an open window');
  assert.equal(safeReload({ drafts: { talk: { april: '   ' } }, typed: ['', '  '] }).reloaded, 1, 'CONTROL: blank drafts and emptied fields are not words');
});

test('#3955 round 2: a field removed from the page is let go, and holds no words', () => {
  const src = page.liftAll(SCRIPT, ['updateSafeReload']);
  assert.match(src, /if \(t\.isConnected === false\) UPDATE_TYPED\.delete\(t\);/, 'removed fields pile up in UPDATE_TYPED for the life of the tab');
  const gone = { value: 'typed, then the box was closed', isConnected: false };
  const typed = new Set([gone]);
  let reloaded = 0;
  const got = new Function('document', 'sessionStorage', 'window', 'TALK_SENDING', 'PJ_SENDING', 'PJ_REPLY_SENDING', 'TERM_SENDING',
    'TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'tipModalOpen', 'UPDATE_TYPED', 'ATTACH_PENDING', src + '\nreturn updateSafeReload("0.2.76");')(
    { hidden: true }, { getItem: () => null, setItem() {} }, { location: { reload: () => { reloaded += 1; } } },
    false, false, null, false, {}, {}, {}, {}, () => false, typed, { room: {}, agent: {} });
  assert.equal(got, true);
  assert.equal(reloaded, 1, 'a closed box\'s words blocked the reload');
  assert.equal(typed.size, 0, 'the removed field was kept');
});

test('#3955 round 3: only boxes that hold words count as typed (not a dropdown, checkbox or slider)', () => {
  const box = new Function(page.liftAll(SCRIPT, ['updateTypedBox']) + '\nreturn updateTypedBox;')();
  assert.equal(box({ tagName: 'TEXTAREA' }), true);
  assert.equal(box({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(box({ tagName: 'INPUT', type: '' }), true, 'an input with no type is a text box');
  assert.equal(box({ tagName: 'DIV', isContentEditable: true }), true, 'a rich-text composer would lose its words (round 6)');
  assert.equal(box({ tagName: 'DIV', isContentEditable: false }), false, 'CONTROL: a plain div is not a box');
  for (const type of ['tel', 'password', 'number', 'email', 'search', 'url']) {
    assert.equal(box({ tagName: 'INPUT', type }), true, 'words typed into a ' + type + ' box would be lost (round 5)');
  }
  for (const t of [{ tagName: 'SELECT' }, { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'range' }, { tagName: 'INPUT', type: 'radio' }]) {
    assert.equal(box(t), false, (t.type || t.tagName) + ' would stop the reload for the rest of the tab');
  }
});

test('#3955 round 3: the old-page chip runs the safe reload, and every value the reload reads is declared on the page', () => {
  const r = page.liftAll(SCRIPT, ['renderUpdateToast']);
  const stale = r.slice(r.indexOf('pageIsStale(SERVED_VERSION)'));
  assert.match(stale.slice(0, 200), /updateSafeReload\(SERVED_VERSION\);/, 'the stale chip no longer tries the safe reload');
  /* The reload guards each value with typeof (a missing one is skipped silently), so a rename would
     turn a check off with the tests still green: pin that each is declared under this name. */
  for (const name of ['TALK_SENDING', 'PJ_SENDING', 'PJ_REPLY_SENDING', 'TERM_SENDING', 'TALK_DRAFTS', 'TERM_DRAFTS',
    'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'ATTACH_PENDING', 'UPDATE_TYPED', 'PJ_POSTING', 'ATTACH_UPLOADING']) {
    assert.match(PAGE, new RegExp('^(let|const) ' + name + '\\b', 'm'), name + ' is not declared on the page: the reload\'s check on it is off');
  }
  assert.match(PAGE, /^function tipModalOpen\(/m, 'tipModalOpen is gone: the reload would ignore open windows');
});

test('#3955 round 5: a box that is hidden but still holds typed words blocks the reload (a kept New task draft)', () => {
  const src = page.liftAll(SCRIPT, ['updateSafeReload']);
  assert.doesNotMatch(src, /offsetParent|closest\('\[hidden\]'\)/, 'a hidden box is treated as saved again');
  const kept = { value: 'Rewrite the handoff checklist', isConnected: true, offsetParent: null, closest: () => ({}) };
  let reloaded = 0;
  new Function('document', 'sessionStorage', 'window', 'TALK_SENDING', 'PJ_SENDING', 'PJ_REPLY_SENDING', 'TERM_SENDING',
    'TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'tipModalOpen', 'UPDATE_TYPED', 'ATTACH_PENDING', src + '\nreturn updateSafeReload("0.2.76");')(
    { hidden: true }, { getItem: () => null, setItem() {} }, { location: { reload: () => { reloaded += 1; } } },
    false, false, null, false, {}, {}, {}, {}, () => false, new Set([kept]), { room: {}, agent: {} });
  assert.equal(reloaded, 0, 'a New task draft kept in a hidden dialog was reloaded away');
});

test('#3955 round 7: the reload reads a rich-text box by its words (textContent)', () => {
  const src = page.liftAll(SCRIPT, ['updateSafeReload']);
  const box = { isContentEditable: true, textContent: 'a rich-text draft', value: undefined, isConnected: true };
  let reloaded = 0;
  new Function('document', 'sessionStorage', 'window', 'TALK_SENDING', 'PJ_SENDING', 'PJ_REPLY_SENDING', 'TERM_SENDING',
    'TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'tipModalOpen', 'UPDATE_TYPED', 'ATTACH_PENDING', src + '\nreturn updateSafeReload("0.2.76");')(
    { hidden: true }, { getItem: () => null, setItem() {} }, { location: { reload: () => { reloaded += 1; } } },
    false, false, null, false, {}, {}, {}, {}, () => false, new Set([box]), { room: {}, agent: {} });
  assert.equal(reloaded, 0, 'a rich-text draft was reloaded away');
});

test('#3955 round 9: a file still uploading, or a room post in flight, holds the automatic reload', () => {
  const src = page.liftAll(SCRIPT, ['updateSafeReload']);
  const run = (uploading, posting) => {
    let reloaded = 0;
    new Function('document', 'sessionStorage', 'window', 'TALK_SENDING', 'PJ_SENDING', 'PJ_REPLY_SENDING', 'TERM_SENDING',
      'TALK_DRAFTS', 'TERM_DRAFTS', 'PJ_DRAFTS', 'PJ_ROOM_DRAFTS', 'tipModalOpen', 'UPDATE_TYPED', 'ATTACH_PENDING', 'ATTACH_UPLOADING', 'PJ_POSTING',
      src + '\nreturn updateSafeReload("0.2.76");')(
      { hidden: true }, { getItem: () => null, setItem() {} }, { location: { reload: () => { reloaded += 1; } } },
      false, false, null, false, {}, {}, {}, {}, () => false, new Set(), { room: {}, agent: {} }, uploading, posting);
    return reloaded;
  };
  assert.equal(run(0, false), 1, 'CONTROL: an idle hidden page reloads');
  assert.equal(run(1, false), 0, 'a reload cut off a file still uploading');
  assert.equal(run(0, true), 0, 'a reload cut off a room post in flight');
});

test('#3955 round 9: every upload counts itself up and back down, whatever happens to it', () => {
  const src = page.liftAll(SCRIPT, ['attachUpload']);
  assert.match(src, /ATTACH_UPLOADING \+= 1;[\s\S]*try \{[\s\S]*finally \{\s*ATTACH_UPLOADING = Math\.max\(0, ATTACH_UPLOADING - 1\);/,
    'the upload count is not raised before the try and lowered in its finally');
});
