'use strict';
/**
 * kosmos#6587 (S-7a slice 2b): the floating notice for a Kosmos+ service key mismatch (paintSkNote), on every view but
 * Kosmos+. Put away for the tab by Close or Review, until an answer says anything but mismatch; one fixed sentence.
 *
 *   node --test web.sk-notice-6587.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = require(path.join(__dirname, 'test-support/page'));
const PAGE = fs.readFileSync(path.join(__dirname, 'web/index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function el(id) {
  return {
    id, hidden: false, dataset: {}, attrs: {}, listeners: {}, focused: false, _text: '', _html: '', head: '',
    get textContent() { return this._text; }, set textContent(v) { this._text = v; this._html = ''; this.head = ''; },
    set innerHTML(v) { this._html = v; this._text = ''; this._review = null; }, get innerHTML() { return this._html; },
    get firstChild() { return this._html || this._text ? {} : null; },
    querySelector(sel) {
      const self = this;
      if (sel === '[data-sk="open"]') return this._html ? (this._review ||= { focused: false, focus() { this.focused = true; } }) : null;
      return { set textContent(v) { self.head = v; } };
    },
    contains(x) { return !!x && x === this._review; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, fn) { this.listeners[t] = fn; }, getClientRects() { return [1]; }, focus() { this.focused = true; },
  };
}

function world({ onPlus = false, session = {}, noSession = false, answer = null } = {}) {
  const els = {};
  const get = (id) => (els[id] ||= el(id));
  const mark = el('klink');
  const where = { onPlus, went: [] };
  const ctx = {
    document: { getElementById: get, querySelector: (sel) => (sel === '.apphead .klink' ? mark : null), activeElement: null }, console,
    plusOnScreen: () => where.onPlus,
    sessionStorage: noSession ? undefined : { getItem: (k) => session[k] ?? null, setItem: (k, v) => { session[k] = v; }, removeItem: (k) => { delete session[k]; } },
    showTab: (t) => where.went.push(t), settingsGo: (s) => { where.went.push(s); where.onPlus = true; }, paintPlus: () => Promise.resolve(),
    // The certificate notice's poll carries this one; it polls once as the block loads (an error answer paints nothing).
    localStorage: { getItem: () => null, setItem() {} }, plusSay() {}, plusWords: (s) => s, setInterval: () => 0,
    fetch: async () => (where.answer ? { ok: true, json: async () => where.answer } : { ok: false, json: async () => ({}) }),
  };
  where.answer = answer;
  if (noSession) Object.defineProperty(ctx, 'sessionStorage', { get() { throw new Error('blocked'); } });
  const start = SCRIPT.indexOf('/* kosmos#6613: the notice for a finding');   // through pollCwNote, which paints this notice too
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  assert.ok(start > 0 && end > start, 'the notice script moved; re-anchor this test');
  const fa = SCRIPT.indexOf('function rebootFocusAway() {');
  assert.ok(fa > 0, 'rebootFocusAway moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(fa, SCRIPT.indexOf('\n}\n', fa) + 3) + SCRIPT.slice(start, end), ctx);
  return { ctx, get, where, session, mark };
}
const click = (w, which) => w.get('sknote-slot').listeners.click({ target: { closest: () => ({ getAttribute: () => which }) } });

test('a mismatch away from Kosmos+ raises the notice, with the fixed warning and Review and Close', () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  const slot = w.get('sknote-slot');
  assert.match(slot.head, /^Warning: the key this computer trusts for the Kosmos\+ service is not on the signed list/);
  assert.match(slot.innerHTML, /data-sk="open"[^>]*>Review</);
  assert.match(slot.innerHTML, /data-sk="dismiss" aria-label="Close: Kosmos\+ service key warning"/);
  assert.match(slot.innerHTML, /role="status"/);
});

test('every other state, and Kosmos+ on screen, raise nothing (the control) and clear a notice shown', () => {
  for (const state of ['off', 'refused', 'none', 'unknown', 'listed', 'elsewhere', '']) {
    const w = world();
    w.ctx.paintSkNote({ state: 'mismatch' });
    assert.ok(w.get('sknote-slot').firstChild, 'CONTROL: shown before ' + state);
    w.ctx.paintSkNote({ state });
    assert.equal(w.get('sknote-slot').firstChild, null, state);
  }
  const w = world({ onPlus: true });
  w.ctx.paintSkNote({ state: 'mismatch' });
  assert.equal(w.get('sknote-slot').firstChild, null, 'on Kosmos+ its own line says it');
  for (const none of [null, undefined]) { const v = world(); v.ctx.paintSkNote({ state: 'mismatch' }); v.ctx.paintSkNote(none); assert.equal(v.get('sknote-slot').firstChild, null, String(none)); }
});

test('unchanged, it is not rewritten (so it is not read out again on every poll)', () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  const first = w.get('sknote-slot').innerHTML;
  w.get('sknote-slot')._html = first + '<!--marker-->';
  w.ctx.paintSkNote({ state: 'mismatch' });
  assert.match(w.get('sknote-slot').innerHTML, /marker/, 'a second paint left it alone');
});

test('Close puts it away for the session: gone now, and on the next poll; focus goes to the K mark', () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  click(w, 'dismiss');
  assert.equal(w.get('sknote-slot').firstChild, null);
  assert.equal(w.session['kosmos.sknote.away'], '1');
  w.ctx.paintSkNote({ state: 'mismatch' });
  assert.equal(w.get('sknote-slot').firstChild, null, 'still away');
  assert.equal(w.mark.focused, true);
  // A new visit (a fresh session) brings it back while the mismatch lasts.
  const again = world();
  again.ctx.paintSkNote({ state: 'mismatch' });
  assert.ok(again.get('sknote-slot').firstChild, 'a new session shows it again');
});

test('Review opens Kosmos+ and puts it away; with no session storage the tab still remembers', () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  click(w, 'open');
  assert.deepEqual(w.where.went, ['settings', 'plus']);
  assert.equal(w.get('sknote-slot').firstChild, null);
  const blocked = world({ noSession: true });
  blocked.ctx.paintSkNote({ state: 'mismatch' });
  assert.ok(blocked.get('sknote-slot').firstChild, 'CONTROL: shown with storage blocked');
  click(blocked, 'dismiss');
  blocked.ctx.paintSkNote({ state: 'mismatch' });
  assert.equal(blocked.get('sknote-slot').firstChild, null, 'put away for this tab without storage');
});

test('the page wires it: the slot is second in the stack and hidden empty, the pane and the poll paint it, Kosmos+ repaints it', () => {
  assert.match(PAGE, /<div id="cwnote-slot"><\/div>[\s\S]{0,400}<div id="sknote-slot"><\/div>/);
  assert.match(PAGE, /#cwnote-slot:empty, #sknote-slot:empty,/);
  assert.match(SCRIPT, /if \(typeof paintSkNote === 'function'\) paintSkNote\(sk\);/, 'the pane paints it');
  assert.match(SCRIPT, /paintSkNote\(r\.enrolled === true \? r\.serviceKeys : null\)/, 'the poll paints it');
  assert.match(SCRIPT, /paintSkNote\(SK_NOTE\.last\);/, 'leaving or opening Kosmos+ repaints it');
  // Only fixed text: the notice reads sk.state alone.
  const fn = SCRIPT.slice(SCRIPT.indexOf('function paintSkNote(sk) {'), SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function paintSkNote(sk) {')));
  assert.doesNotMatch(fn, /sk\.(?!state)/);
});

test('a put-away lasts only for the mismatch it was: an answer that is not one ends it, and the next mismatch is raised', () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  click(w, 'dismiss');
  w.ctx.paintSkNote({ state: 'mismatch' });
  assert.equal(w.get('sknote-slot').firstChild, null, 'CONTROL: put away while the mismatch lasts');
  w.ctx.paintSkNote({ state: 'listed' });
  assert.equal(w.session['kosmos.sknote.away'], undefined, 'the put-away is ended');
  w.ctx.paintSkNote({ state: 'mismatch' });
  assert.ok(w.get('sknote-slot').firstChild, 'a later mismatch in the same tab is raised again');
  // An older board's answer (no state) does not end it.
  const v = world();
  v.ctx.paintSkNote({ state: 'mismatch' }); click(v, 'dismiss'); v.ctx.paintSkNote(null);
  assert.equal(v.session['kosmos.sknote.away'], '1', 'no state is not an answer about the key');
});

test('Review puts it away as Close does: a repaint of the same mismatch stays away', () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  click(w, 'open');
  assert.equal(w.session['kosmos.sknote.away'], '1');
  w.where.onPlus = false;
  w.ctx.paintSkNote({ state: 'mismatch' });
  assert.equal(w.get('sknote-slot').firstChild, null);
});

test('Review lands focus on the pane\'s line only when the pane painted (#plus-flow shown)', async () => {
  for (const hidden of [false, true]) {
    const w = world();
    w.get('plus-sk-line').textContent = 'Warning: the key this computer trusts';
    w.get('plus-flow').hidden = hidden;
    w.ctx.paintSkNote({ state: 'mismatch' });
    click(w, 'open');
    await new Promise((r) => setImmediate(r));
    assert.equal(w.get('plus-sk-line').focused, !hidden, hidden ? 'a hidden pane: not focused there' : 'CONTROL: a painted pane takes focus');
  }
});

test('an older board\'s answer (set up, no serviceKeys) on the poll leaves a shown notice; a real one repaints it', async () => {
  const w = world();
  w.ctx.paintSkNote({ state: 'mismatch' });
  w.where.answer = { enrolled: true, on: true };
  await w.ctx.pollCwNote();
  assert.ok(w.get('sknote-slot').firstChild, 'kept');
  w.where.answer = { enrolled: true, on: true, serviceKeys: { state: 'listed' } };
  await w.ctx.pollCwNote();
  assert.equal(w.get('sknote-slot').firstChild, null, 'CONTROL: a real answer is painted');
});

test('a clear while focus is on the card sends focus to the K mark, not the page; focus elsewhere moves nobody', () => {
  for (const onCard of [true, false]) {
    const w = world();
    w.ctx.paintSkNote({ state: 'mismatch' });
    w.ctx.document.activeElement = onCard ? w.get('sknote-slot').querySelector('[data-sk="open"]') : null;
    w.ctx.paintSkNote({ state: 'listed' });
    assert.equal(w.mark.focused, onCard, onCard ? 'focus on the card goes to the K mark' : 'CONTROL: focus elsewhere is left');
  }
});
