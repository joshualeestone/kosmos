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
    set innerHTML(v) { this._html = v; this._text = ''; this._review = null; }, get innerHTML() { return this._html; },
    get firstChild() { return this._html || this._text ? {} : null; },
    // The card's Review: a new button each time the card is rebuilt, as the real innerHTML makes one.
    querySelector(sel) {
      const self = this;
      if (sel === '[data-cw="open"]') return this._html ? (this._review ||= { focused: false, focus() { this.focused = true; } }) : null;
      return { set textContent(v) { self.head = v; } };
    },
    contains(x) { return !!x && x === this._review; },
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
    document: { getElementById: get, querySelector: (sel) => (sel === '.apphead .klink' ? mark : null), activeElement: null }, console,
    plusOnScreen: () => where.onPlus,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    // The block polls once as it loads; an error answer keeps that poll from painting over what a test paints.
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    setInterval: () => 0, showTab() {}, settingsGo() {}, paintPlus() {}, plusSay() {}, plusWords: (s) => s,
  };
  const start = SCRIPT.indexOf('/* kosmos#6613: the notice for a finding');
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  assert.ok(start > 0 && end > start, 'the notice script moved; re-anchor this test');
  // The restart note's focus-away (where a cleared notice sends focus), lifted from the page, not stubbed.
  const fa = SCRIPT.indexOf('function rebootFocusAway() {');
  assert.ok(fa > 0, 'rebootFocusAway moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(fa, SCRIPT.indexOf('\n}\n', fa) + 3) + SCRIPT.slice(start, end), ctx);
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
      w.get('plus-cw-line').dataset.key = paneSays ? FOUND.key : '';
      w.get('plus-cw-switch').hidden = false;
      w.get('plus-flow').hidden = false;   // the pane is showing
    };
    w.ctx.paintCwNote(FOUND);
    w.get('cwnote-slot').listeners.click({ target: { closest: () => ({ getAttribute: () => 'open' }) } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.store['kosmos.cwnote.dismissed'] === FOUND.key, paneSays, paneSays ? 'the pane said it: put away' : 'CONTROL: a pane that did not paint keeps the notice');
    if (!paneSays) assert.ok(w.get('plus-cw-switch').focused, 'focus was left on nothing');
  }
});

test('Review does not put a finding away on a line left from an older finding set', async () => {
  const w = noteWorld();
  w.ctx.paintPlus = async () => {
    w.ctx.paintCwNote(FOUND);
    w.get('plus-cw-line').textContent = 'Warning: an older finding.';
    w.get('plus-cw-line').dataset.state = 'foreign';
    w.get('plus-cw-line').dataset.key = 'aaaaaaaaaaaaaaaa';
    w.get('plus-flow').hidden = false;
  };
  w.ctx.paintCwNote(FOUND);
  w.get('cwnote-slot').listeners.click({ target: { closest: () => ({ getAttribute: () => 'open' }) } });
  await new Promise((r) => setTimeout(r, 0));
  assert.notEqual(w.store['kosmos.cwnote.dismissed'], FOUND.key);
});

test('the notice\'s Review and Got it are at finger size on a touch screen', () => {
  // Inside the touch media block where the other finger-size rules live, or it does not apply on a touch screen.
  const at = PAGE.indexOf('.utoast.cwnote .uacts button, #plus-cw-ack { min-height: 44px; }');
  const block = PAGE.lastIndexOf('@media (hover: none), (pointer: coarse)', at);
  assert.ok(at > 0 && block > 0, 'Review and Got it at finger size');
  const between = PAGE.slice(block, at);
  let depth = 0; for (const ch of between) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
  assert.ok(depth >= 1, 'the finger-size rule is not inside the touch media block');
});

test('a failed read of the board keeps the warning showing (no blink)', async () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  ctx.fetch = async () => { throw new Error('board restarting'); };
  await ctx.pollCwNote();
  assert.ok(shown(get));
});

test('an error answer from the board (a 500) is a failed read too: the warning stays, and polling does not go quiet', async () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  let asked = 0;
  ctx.fetch = async () => { asked += 1; return { ok: false, json: async () => ({ error: 'we could not read the Plus state' }) }; };
  await ctx.pollCwNote();
  await ctx.pollCwNote();
  assert.ok(shown(get));
  assert.equal(asked, 2, 'a 500 was read as "not set up" and polling went quiet');
});

test('a set-up answer with no certWatch (an older board) leaves a showing warning alone', async () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  ctx.fetch = async () => ({ ok: true, json: async () => ({ enrolled: true, on: true }) });
  await ctx.pollCwNote();
  assert.ok(shown(get));
});

test('the small line says what is true: on, Kosmos+ off, or the check off', () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND, true);
  assert.match(get('cwnote-slot').innerHTML, /Kosmos\+ checks the public certificate logs/);
  ctx.paintCwNote(FOUND, false);
  assert.match(get('cwnote-slot').innerHTML, /Kosmos\+ is off, so nothing is checking now/);
  ctx.paintCwNote({ ...FOUND, on: false }, true);
  assert.match(get('cwnote-slot').innerHTML, /The certificate check is off/);
  ctx.paintCwNote({ ...FOUND, failing: true }, true);
  assert.match(get('cwnote-slot').innerHTML, /The check has been failing lately/);
});

test('a key put away in another tab (storage) is honoured at the next paint', () => {
  const { ctx, get } = noteWorld({ stored: FOUND.key });
  ctx.paintCwNote(FOUND);
  assert.ok(!shown(get));
});

test('the Plus pane painter hands the notice the same answer, and leaving Kosmos+ repaints it', () => {
  const a = SCRIPT.indexOf('function paintPlusCertWatch(cw, plusOn) {');
  const body = SCRIPT.slice(a, SCRIPT.indexOf('\n}\n', a));
  assert.ok(body.includes("if (typeof paintCwNote === 'function') paintCwNote(cw, plusOn);"), 'the pane no longer feeds the notice');
  const s = SCRIPT.indexOf('function syncPlusChrome() {');
  assert.ok(SCRIPT.slice(s, SCRIPT.indexOf('\n}\n', s)).includes('paintCwNote(CW_NOTE.last, CW_NOTE.lastPlusOn)'), 'leaving Kosmos+ no longer repaints the notice');
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
    paintPlus: async () => { if (answer.ok || world.repaintHides) get('plus-cw-ack').hidden = true; },
  };
  const world = { get, calls, said, repaintHides: false };
  const start = SCRIPT.indexOf('/* kosmos#6613: the notice for a finding');
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return world;
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

test('a refused Got it says why, does not say Noted. (the control), and keeps focus on Got it', async () => {
  const w = ackWorld({ ok: false, json: async () => ({ error: 'that report is no longer the one to acknowledge' }) });
  await w.get('plus-cw-ack').listeners.click();
  assert.ok(w.said.includes('that report is no longer the one to acknowledge'), JSON.stringify(w.said));
  assert.ok(!w.said.includes('Noted.'));
  assert.equal(w.get('plus-cw-ack').hidden, false);
  assert.ok(w.get('plus-cw-ack').focused, 'focus left Got it');
  assert.equal(w.get('plus-cw-ack').getAttribute('aria-busy'), null);
});

test('a refused Got it whose button the repaint removed sends focus to the switch, not nowhere', async () => {
  const w = ackWorld({ ok: false, json: async () => ({ error: 'that report is no longer the one to acknowledge' }) });
  const ctxHide = w.get('plus-cw-ack');
  // The marker was cleared meanwhile: the repaint hides Got it and the line says nothing.
  w.repaintHides = true;
  await w.get('plus-cw-ack').listeners.click();
  assert.equal(ctxHide.hidden, true);
  assert.ok(w.get('plus-cw-switch').focused, 'focus was left on nothing');
});

test('a computer not set up for Kosmos+ is asked again only after a while', async () => {
  const { ctx } = noteWorld();
  let asked = 0;
  ctx.fetch = async () => { asked += 1; return { ok: true, json: async () => ({ enrolled: false }) }; };
  await ctx.pollCwNote();
  await ctx.pollCwNote();
  assert.equal(asked, 1);
});

test('the markup carries the notice slot (first in the floating stack) and Got it', () => {
  assert.match(PAGE, /<div class="topnotes" id="topnotes">[\s\S]{0,400}<div id="cwnote-slot"><\/div>[\s\S]{0,400}<div id="sknote-slot"><\/div>\s*<div id="utoast-slot"><\/div>/);   // kosmos#6587: the service key warning second
  assert.match(PAGE, /<button class="btn" type="button" id="plus-cw-ack" hidden>Got it: earlier report<\/button>/);
});

test('every slot in the floating stack is taken out of the layout while empty (an empty flex item spends a gap)', () => {
  const stack = PAGE.slice(PAGE.indexOf('<div class="topnotes" id="topnotes">'));
  const cut = stack.indexOf('</div>\n  </div>');
  assert.ok(cut > 0, 'the stack markup was reshaped; re-anchor this test');
  const slots = [...stack.slice(0, cut).matchAll(/<div id="([a-z-]+-slot)"><\/div>/g)].map((m) => m[1]);
  assert.ok(slots.includes('cwnote-slot') && slots.length >= 7, JSON.stringify(slots));
  const rule = (PAGE.match(/^(#[a-z-]+-slot:empty(?:, #[a-z-]+-slot:empty)*) \{ display: none; \}$/m) || [])[1] || '';
  const covered = rule.split(', ').map((x) => x.replace(/^#|:empty$/g, ''));
  assert.deepEqual(slots.filter((s) => !covered.includes(s)), [], 'a slot that stays a flex item while empty');
});

test('a finding only for an earlier address says so; a finding here as well says this computer (the control)', () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote({ ...FOUND, foreign: 0, earlier: 2 });
  assert.match(get('cwnote-slot').head, /an address this computer used before\.$/);
  ctx.paintCwNote({ ...FOUND, foreign: 1, earlier: 2 });
  assert.match(get('cwnote-slot').head, /^Warning: a certificate was issued for this computer's address/);
});

test('Review carries a name that says which card it belongs to', () => {
  const { ctx, get } = noteWorld();
  ctx.paintCwNote(FOUND);
  assert.match(get('cwnote-slot').innerHTML, /data-cw="open" aria-label="Review: certificate warning">Review</);
});

test('focus on the card survives a repaint (onto the new Review) and a clear (onto the K mark)', () => {
  const { ctx, get, mark } = noteWorld();
  ctx.paintCwNote(FOUND, true);
  const first = get('cwnote-slot').querySelector('[data-cw="open"]');
  ctx.document.activeElement = first;
  ctx.paintCwNote(FOUND, false);   // the small line changes, so the card is rebuilt
  const second = get('cwnote-slot').querySelector('[data-cw="open"]');
  assert.notEqual(second, first, 'the card was not rebuilt; this test proves nothing');
  assert.ok(second.focused, 'focus was dropped to the page by the rebuild');
  ctx.document.activeElement = second;
  ctx.paintCwNote({ on: true, state: 'clear', key: null });
  assert.ok(!shown(get));
  assert.ok(mark.focused, 'focus was dropped to the page by the clear');
});

test('a clear or a repaint with focus elsewhere moves nobody (the control for the test above)', () => {
  const { ctx, get, mark } = noteWorld();
  ctx.paintCwNote(FOUND, true);
  ctx.paintCwNote(FOUND, false);
  assert.ok(!get('cwnote-slot').querySelector('[data-cw="open"]').focused);
  ctx.paintCwNote({ on: true, state: 'clear', key: null });
  assert.ok(!mark.focused);
});

/* The pane painter and the notice in one context, as on the page. */
function paneWorld() {
  const w = noteWorld();
  const sw = SCRIPT.indexOf('function paintSwitch(togId, on) {');
  const a = SCRIPT.indexOf('var PLUS_CW_WORDS = {');
  const b = SCRIPT.indexOf("{ const cwSw = document.getElementById('plus-cw-switch');");
  assert.ok(sw > 0 && a > 0 && b > a, 'the certificate check script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(sw, SCRIPT.indexOf('\n}\n', sw) + 3) + SCRIPT.slice(a, b), w.ctx);
  return w;
}

test('a poll in flight when the pane paints a newer answer cannot repaint over it', async () => {
  const w = paneWorld();
  let land;
  w.ctx.fetch = () => new Promise((r) => { land = r; });
  const poll = w.ctx.pollCwNote();
  w.ctx.paintPlusCertWatch({ on: true, state: 'clear', key: null }, true);   // the newer answer: nothing found
  land({ ok: true, json: async () => ({ enrolled: true, on: true, certWatch: FOUND }) });   // the older one: a finding
  await poll;
  assert.ok(!shown(w.get), 'the late poll painted its older finding over the pane\'s newer answer');
});

test('the same late poll, with no pane paint between, does paint (the control for the test above)', async () => {
  const w = paneWorld();
  let land;
  w.ctx.fetch = () => new Promise((r) => { land = r; });
  const poll = w.ctx.pollCwNote();
  land({ ok: true, json: async () => ({ enrolled: true, on: true, certWatch: FOUND }) });
  await poll;
  assert.ok(shown(w.get));
});

test('an answer with no certWatch hides the pane row and Got it, and clears the key Review reads', () => {
  const w = paneWorld();
  w.ctx.paintPlusCertWatch({ on: true, state: 'unknown', lost: true, lostAt: 1792368000, key: null }, true);
  w.ctx.paintPlusCertWatch({ ...FOUND }, true);
  assert.equal(w.get('plus-cw-line').dataset.key, FOUND.key, 'CONTROL: a finding sets the key');
  w.ctx.paintPlusCertWatch(null, true);
  assert.equal(w.get('plus-cw-row').hidden, true);
  assert.equal(w.get('plus-cw-ack').hidden, true);
  assert.equal(w.get('plus-cw-line').dataset.key, '');
  assert.equal(w.get('plus-cw-line').dataset.state, '');
});

test('paintPlus clears the notice only on a real not-set-up answer, and polls again once set up', () => {
  const a = SCRIPT.indexOf('async function paintPlus() {');
  const body = SCRIPT.slice(a, SCRIPT.indexOf('\n}\n', a));
  assert.ok(a > 0 && body.length > 0, 'paintPlus moved; re-anchor this test');
  assert.ok(body.includes("if (r && r.enrolled === true && typeof CW_NOTE !== 'undefined') CW_NOTE.quietUntil = 0;"), 'a computer set up again stays quiet for ten minutes');
  const clears = body.match(/paintCwNote\(null\)/g) || [];
  assert.equal(clears.length, 1, 'paintPlus clears the notice somewhere else too');
  assert.ok(body.includes("if (r && r.enrolled === false && typeof paintCwNote === 'function') paintCwNote(null);"), 'a failed read (r null) or an error answer clears the warning');
});
