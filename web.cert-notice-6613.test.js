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
  return {
    id, hidden: true, textContent: '', dataset: {}, attrs: {}, listeners: {},
    _html: '', set innerHTML(v) { this._html = v; this.textContent = ''; }, get innerHTML() { return this._html; },
    querySelector() { const self = this; return { set textContent(v) { self.textContent = v; } }; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
    classList: { toggle() {}, remove() {} }, addEventListener(t, fn) { this.listeners[t] = fn; },
  };
}

function noteWorld({ onPlus = false, stored = '' } = {}) {
  const els = {};
  const get = (id) => (els[id] ||= el(id));
  const store = { 'kosmos.cwnote.dismissed': stored };
  const ctx = {
    document: { getElementById: get }, console,
    plusOnScreen: () => onPlus,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    fetch: async () => ({ ok: true, json: async () => ({ enrolled: false }) }),
    setInterval: () => 0, showTab() {}, settingsGo() {}, paintPlus() {}, plusSay() {}, plusWords: (s) => s,
  };
  const start = SCRIPT.indexOf('/* kosmos#6613: the compact notice for a finding');
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  assert.ok(start > 0 && end > start, 'the notice script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { ctx, get, store };
}

const FOUND = { on: true, state: 'foreign', foreign: 1, earlier: 0, key: '0123456789abcdef' };

test('a finding raises the notice away from Kosmos+, in a fixed sentence', () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  assert.equal(get('cwcard').hidden, false);
  assert.match(get('cw-rows').textContent, /this computer's address was issued that this computer did not ask for/);
  assert.ok(!get('cw-rows').innerHTML.includes(FOUND.key), 'the key is not written into the page');
});

test('on Kosmos+ itself, with no finding, or with a key that is not hex, there is no notice (the control above shows one)', () => {
  const { ctx, get } = noteWorld({ onPlus: true });
  ctx.paintCwNote(FOUND);
  assert.equal(get('cwcard').hidden, true, 'on Kosmos+');
  const w2 = noteWorld();
  w2.ctx.paintCwNote({ on: true, state: 'clear', key: null });
  assert.equal(w2.get('cwcard').hidden, true, 'clear');
  w2.ctx.paintCwNote({ ...FOUND, key: '<b>x</b>' });
  assert.equal(w2.get('cwcard').hidden, true, 'a key that is not 16 hex');
});

test('close puts that finding away (kept in storage); a new finding brings the notice back', () => {
  const { ctx, get, store } = noteWorld();
  ctx.paintCwNote(FOUND);
  get('cw-rows').listeners.click({ target: { closest: () => ({ getAttribute: () => 'dismiss' }) } });
  assert.equal(get('cwcard').hidden, true);
  assert.equal(store['kosmos.cwnote.dismissed'], FOUND.key);
  ctx.paintCwNote(FOUND);
  assert.equal(get('cwcard').hidden, true, 'the same finding stays put away');
  ctx.paintCwNote({ ...FOUND, key: 'fedcba9876543210' });
  assert.equal(get('cwcard').hidden, false, 'a new finding shows again');
});

test('a key put away in another tab (storage) is honoured at the next paint', () => {
  const { ctx, get } = noteWorld({ stored: FOUND.key });
  ctx.paintCwNote(FOUND);
  assert.equal(get('cwcard').hidden, true);
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

test('the markup carries the notice and Got it', () => {
  assert.match(PAGE, /<div class="askcard" id="cwcard" role="status" aria-live="polite" hidden>/);
  assert.match(PAGE, /<button class="btn" type="button" id="plus-cw-ack" hidden>Got it<\/button>/);
});
