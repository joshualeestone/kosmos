'use strict';
/**
 * kosmos#6613: the compact notice for a certificate check finding (paintCwNote), and the Plus pane's Got it for a lost
 * report (paintPlusCertWatch).
 *
 *   node --test web.cert-notice-6613.test.js
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
  const node = {
    id, hidden: true, dataset: {}, attrs: {}, listeners: {}, focused: false,
    _text: '', _html: '', head: '',
    get textContent() { return this._text; }, set textContent(v) { this._text = v; this._html = ''; this.head = ''; },
    set innerHTML(v) { this._html = v; this._text = ''; }, get innerHTML() { return this._html; },
    get firstChild() { return this._html || this._text ? {} : null; },
    querySelector() { const self = this; return { set textContent(v) { self.head = v; } }; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
    classList: { toggle() {}, remove() {} }, addEventListener(t, fn) { this.listeners[t] = fn; },
    getClientRects() { return [1]; }, focus() { this.focused = true; },
  };
  return node;
}

function noteWorld({ onPlus = false, stored = '' } = {}) {
  const els = {};
  const get = (id) => (els[id] ||= el(id));
  const mark = el('klink');
  const store = { 'kosmos.cwnote.dismissed': stored };
  const where = { onPlus };
  const ctx = {
    document: { getElementById: get, querySelector: (sel) => (sel === '.apphead .klink' ? mark : null) }, console,
    plusOnScreen: () => where.onPlus,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    fetch: async () => ({ ok: true, json: async () => ({ enrolled: false }) }),
    setInterval: () => 0, showTab() {}, settingsGo() {}, paintPlus() {}, plusSay() {}, plusWords: (s) => s,
  };
  const start = SCRIPT.indexOf('/* kosmos#6613: the notice for a finding');
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  assert.ok(start > 0 && end > start, 'the notice script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  /* As the page does: opening Kosmos+ (settingsGo) puts the person on it, and syncPlusChrome repaints the notice. */
  ctx.settingsGo = (sec) => { if (sec === 'plus') { where.onPlus = true; ctx.paintCwNote(ctx.CW_NOTE.last); } };
  return { ctx, get, store, mark, where };
}

const FOUND = { on: true, state: 'foreign', foreign: 1, earlier: 0, key: '0123456789abcdef' };
const shown = (get) => !!get('cwnote-slot').innerHTML;

test('a finding raises the notice away from Kosmos+, as a fixed warning sentence', () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  assert.ok(shown(get));
  assert.match(get('cwnote-slot').innerHTML, /class="utoast cwnote"/);
  assert.match(get('cwnote-slot').head, /^Warning: a certificate was issued for this computer's address/);
  assert.ok(!get('cwnote-slot').innerHTML.includes(FOUND.key), 'the key is not written into the page');
});

test('on Kosmos+ itself, with no finding, or with a key that is not hex, there is no notice (the control above shows one)', () => {
  const { ctx, get } = noteWorld({ onPlus: true });
  ctx.paintCwNote(FOUND);
  assert.ok(!shown(get), 'on Kosmos+');
  const w2 = noteWorld();
  w2.ctx.paintCwNote({ on: true, state: 'clear', key: null });
  assert.ok(!shown(w2.get), 'clear');
  w2.ctx.paintCwNote({ ...FOUND, key: '<b>x</b>' });
  assert.ok(!shown(w2.get), 'a key that is not 16 hex');
});

test('close puts that finding away (kept in storage), sends focus to the K mark; a new finding brings it back', () => {
  const { ctx, get, store, mark } = noteWorld();
  ctx.paintCwNote(FOUND);
  get('cwnote-slot').listeners.click({ target: { closest: () => ({ getAttribute: () => 'dismiss' }) } });
  assert.ok(!shown(get));
  assert.equal(store['kosmos.cwnote.dismissed'], FOUND.key);
  assert.ok(mark.focused, 'focus was left on nothing');
  ctx.paintCwNote(FOUND);
  assert.ok(!shown(get), 'the same finding stays put away');
  ctx.paintCwNote({ ...FOUND, key: 'fedcba9876543210' });
  assert.ok(shown(get), 'a new finding shows again');
});

test('the dismissed list keeps the newest 50 keys', () => {
  const many = Array.from({ length: 60 }, (_, i) => i.toString(16).padStart(16, '0')).join('\n');
  const { ctx, get, store } = noteWorld({ stored: many });
  ctx.paintCwNote(FOUND);
  get('cwnote-slot').listeners.click({ target: { closest: () => ({ getAttribute: () => 'dismiss' }) } });
  const kept = store['kosmos.cwnote.dismissed'].split('\n');
  assert.equal(kept.length, 50);
  assert.equal(kept[kept.length - 1], FOUND.key, 'the newest is the one just put away');
});

test('with the check switched off, a finding is still raised, and says the check is off', () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote({ ...FOUND, on: false });
  assert.ok(shown(get));
  assert.match(get('cwnote-slot').innerHTML, /The certificate check is off; this is what it found before\./);
  assert.ok(!/Kosmos\+ checks the public certificate logs/.test(get('cwnote-slot').innerHTML));
  ctx.paintCwNote(FOUND);
  assert.match(get('cwnote-slot').innerHTML, /Kosmos\+ checks the public certificate logs/, 'switched back on, the card says so (repainted)');
});

test('Review puts the finding away only once the pane says it', async () => {
  for (const paneSays of [true, false]) {
    const w = noteWorld();
    // The real repaint on Kosmos+ also hands the notice the answer (paintPlusCertWatch -> paintCwNote), clearing its key.
    w.ctx.paintPlus = async () => {
      w.ctx.paintCwNote(FOUND);
      w.get('plus-cw-line').textContent = paneSays ? 'Warning: a finding.' : '';
      w.get('plus-cw-line').dataset.state = paneSays ? 'foreign' : '';
      w.get('plus-cw-switch').hidden = false;
    };
    w.ctx.paintCwNote(FOUND);
    w.get('cwnote-slot').listeners.click({ target: { closest: () => ({ getAttribute: () => 'open' }) } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.store['kosmos.cwnote.dismissed'] === FOUND.key, paneSays, paneSays ? 'the pane said it: put away' : 'CONTROL: a pane that did not paint keeps the notice');
    if (!paneSays) assert.ok(w.get('plus-cw-switch').focused, 'focus was left on nothing');
  }
});

test('a failed read of the board keeps the warning showing (no blink)', async () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  ctx.fetch = async () => { throw new Error('board restarting'); };
  await ctx.pollCwNote();
  assert.ok(shown(get));
});

test('a key put away in another tab (storage) is honoured at the next paint', () => {
  const { ctx, get } = noteWorld({ stored: FOUND.key });
  ctx.paintCwNote(FOUND);
  assert.ok(!shown(get));
});

test('the Plus pane painter hands the notice the same answer, and leaving Kosmos+ repaints it', () => {
  const a = SCRIPT.indexOf('function paintPlusCertWatch(cw, plusOn) {');
  const body = SCRIPT.slice(a, SCRIPT.indexOf('\n}\n', a));
  assert.ok(body.includes("if (typeof paintCwNote === 'function') paintCwNote(cw);"), 'the pane no longer feeds the notice');
  const s = SCRIPT.indexOf('function syncPlusChrome() {');
  assert.ok(SCRIPT.slice(s, SCRIPT.indexOf('\n}\n', s)).includes('paintCwNote(CW_NOTE.last)'), 'leaving Kosmos+ no longer repaints the notice');
});

test('Got it shows with the lost-report sentence only, carrying its marker', () => {
  const els = {};
  const get = (id) => (els[id] ||= el(id));
  const ctx = { document: { getElementById: get }, console };
  const sw = SCRIPT.indexOf('function paintSwitch(togId, on) {');
  const swEnd = SCRIPT.indexOf('\n}\n', sw) + 3;
  const a = SCRIPT.indexOf('var PLUS_CW_WORDS = {');
  const b = SCRIPT.indexOf("{ const cwSw = document.getElementById('plus-cw-switch');");
  assert.ok(sw > 0 && a > 0 && b > a, 'the certificate check script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(sw, swEnd) + SCRIPT.slice(a, b), ctx);
  ctx.paintPlusCertWatch({ on: true, state: 'unknown', lost: true, lostAt: 1792368000 }, true);
  assert.equal(get('plus-cw-ack').hidden, false);
  assert.equal(get('plus-cw-ack').dataset.at, '1792368000');
  ctx.paintPlusCertWatch({ on: true, state: 'clear', lost: false, lostAt: null }, true);
  assert.equal(get('plus-cw-ack').hidden, true, 'CONTROL: nothing lost, no Got it');
  ctx.paintPlusCertWatch({ on: true, state: 'unknown', lost: true, lostAt: 1792368000 }, false);
  assert.equal(get('plus-cw-ack').hidden, true, 'with Kosmos+ off the lost sentence is quiet, and so is Got it');
});

/* The Got it handler, lifted with its stubs: success hides it (by the repaint) and says Noted. with focus on the switch;
   a refusal says why and leaves it. */
function ackWorld(answer) {
  const els = {};
  const get = (id) => (els[id] ||= el(id));
  get('plus-cw-ack').dataset.at = '1792368000';
  get('plus-cw-ack').hidden = false;
  get('plus-cw-switch').hidden = false;
  const calls = [], said = [];
  const ctx = {
    document: { getElementById: get, querySelector: () => null }, console,
    plusOnScreen: () => true, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, opts) => { calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null }); return answer; },
    setInterval: () => 0, showTab() {}, settingsGo() {}, plusWords: (s) => s, plusSay: (m) => said.push(m),
    paintPlus: async () => { if (answer.ok) get('plus-cw-ack').hidden = true; },
  };
  const start = SCRIPT.indexOf('/* kosmos#6613: the notice for a finding');
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { get, calls, said };
}

test('Got it posts the marker it was shown, then says Noted. with focus on the switch', async () => {
  const w = ackWorld({ ok: true, json: async () => ({}) });
  await w.get('plus-cw-ack').listeners.click();
  const post = w.calls.find((c) => c.url === '/api/remote/cert-watch/ack-lost');
  assert.ok(post, JSON.stringify(w.calls));
  assert.deepEqual(post.body, { at: 1792368000 });
  assert.equal(w.get('plus-cw-ack').hidden, true);
  assert.ok(w.said.includes('Noted.'), JSON.stringify(w.said));
  assert.ok(w.get('plus-cw-switch').focused, 'focus was left on nothing');
});

test('a refused Got it says why, and does not say Noted. (the control)', async () => {
  const w = ackWorld({ ok: false, json: async () => ({ error: 'that report is no longer the one to acknowledge' }) });
  await w.get('plus-cw-ack').listeners.click();
  assert.ok(w.said.includes('that report is no longer the one to acknowledge'), JSON.stringify(w.said));
  assert.ok(!w.said.includes('Noted.'));
  assert.equal(w.get('plus-cw-ack').hidden, false);
});

test('the markup carries the notice slot (first in the floating stack) and Got it', () => {
  assert.match(PAGE, /<div class="topnotes" id="topnotes">[\s\S]{0,400}<div id="cwnote-slot"><\/div>\s*<div id="utoast-slot"><\/div>/);
  assert.match(PAGE, /<button class="btn" type="button" id="plus-cw-ack" aria-label="Got it: the earlier report could not be read" hidden>Got it<\/button>/);
});

test('every slot in the floating stack is taken out of the layout while empty (an empty flex item spends a gap)', () => {
  const stack = PAGE.slice(PAGE.indexOf('<div class="topnotes" id="topnotes">'));
  const slots = [...stack.slice(0, stack.indexOf('</div>\n  </div>')).matchAll(/<div id="([a-z-]+-slot)"><\/div>/g)].map((m) => m[1]);
  assert.ok(slots.includes('cwnote-slot') && slots.length >= 7, JSON.stringify(slots));
  const rule = (PAGE.match(/^(#[a-z-]+-slot:empty(?:, #[a-z-]+-slot:empty)*) \{ display: none; \}$/m) || [])[1] || '';
  const covered = rule.split(', ').map((x) => x.replace(/^#|:empty$/g, ''));
  assert.deepEqual(slots.filter((s) => !covered.includes(s)), [], 'a slot that stays a flex item while empty');
});
