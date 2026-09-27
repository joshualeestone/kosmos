'use strict';
/* #4025: the App icon switch in Settings (the waiting count on the Dock or taskbar icon). Runs the
 * REAL page functions (lifted from web/index.html) against a stub DOM and fetch: hidden until the
 * board's setting is read, never a guessed Off, and a save repaints from what the board stored.
 *
 *   node --test web.waiting-badge-4025.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const FNS = page.liftAll(SCRIPT, ['paintWaitingBadge', 'readWaitingBadge', 'saveWaitingBadge']);

function harness(fetchImpl) {
  const tog = { hidden: true, attrs: {}, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    hasAttribute(k) { return this.attrs[k] !== undefined; } };
  const msg = { textContent: '', focus() { document.activeElement = msg; } };
  const el = { 'wb-toggle': tog, 'wb-note': msg };
  const document = { getElementById: (id) => el[id] || null, activeElement: null };
  const paintSwitch = (id, on) => {
    const t = el[id];
    if (on === null || on === undefined) { delete t.attrs['aria-checked']; t.hidden = true; return; }
    t.attrs['aria-checked'] = on === true ? 'true' : 'false'; t.hidden = false;
  };
  const make = new Function('document', 'fetch', 'paintSwitch',
    'let WB_EPOCH = 0; let WB_SAVING = false;\n' + FNS + '\nreturn { paintWaitingBadge, saveWaitingBadge };');
  return { tog, msg, document, api: make(document, fetchImpl, paintSwitch) };
}

test('#4025: the switch ships hidden and unchecked in the markup, inside Settings', () => {
  const m = HTML.match(/<button[^>]*id="wb-toggle"[^>]*>/);
  assert.ok(m, 'no App icon switch');
  assert.match(m[0], /\bhidden\b/, 'the switch is clickable before its setting has loaded');
  assert.doesNotMatch(m[0], /aria-checked/, 'the markup claims a position the board has not said');
  assert.match(m[0], /aria-label="Show the waiting count on the Kosmos icon"/, 'the name does not contain the visible label (WCAG 2.5.3)');
});

test('#4025: a read shows the stored position, off included', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ waitingBadge: false }) }));
  await h.api.paintWaitingBadge();
  assert.equal(h.tog.hidden, false);
  assert.equal(h.tog.getAttribute('aria-checked'), 'false');
});

test('#4025: a failed read, or a board with no such setting, hides the switch and says so (never a false Off)', async () => {
  for (const f of [async () => ({ ok: false, json: async () => ({}) }), async () => ({ ok: true, json: async () => ({ timezone: null }) }),
    async () => { throw new Error('offline'); }]) {
    const h = harness(f);
    await h.api.paintWaitingBadge();
    assert.equal(h.tog.hidden, true);
    assert.equal(h.tog.getAttribute('aria-checked'), null);
    assert.match(h.msg.textContent, /could not read/);
  }
});

test('#4025: a click saves the opposite, and paints what the board stored', async () => {
  const posts = [];
  const h = harness(async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true, waitingBadge: false }) }; }
    return { ok: true, json: async () => ({ waitingBadge: true }) };
  });
  await h.api.paintWaitingBadge();
  await h.api.saveWaitingBadge();
  assert.deepEqual(posts, [{ waitingBadge: false }], 'the click did not save the opposite');
  assert.equal(h.tog.getAttribute('aria-checked'), 'false');
});

test('#4025: a refused save keeps the old position and says so; a switch not yet loaded saves nothing', async () => {
  let posts = 0;
  const h = harness(async (url, opts) => {
    if (opts && opts.method === 'POST') { posts += 1; return { ok: false, json: async () => ({ ok: false }) }; }
    return { ok: true, json: async () => ({ waitingBadge: true }) };
  });
  await h.api.saveWaitingBadge();
  assert.equal(posts, 0, 'a click before the setting loaded wrote over it');
  await h.api.paintWaitingBadge();
  await h.api.saveWaitingBadge();
  assert.equal(posts, 1, 'CONTROL: a loaded switch saves');
  assert.equal(h.tog.getAttribute('aria-checked'), 'true', 'a refused save showed a position the board does not hold');
  assert.match(h.msg.textContent, /could not save/);
});

test('#4025 round 3: a save whose answer was lost re-reads the board, so the switch shows what it holds', async () => {
  let stored = true;
  const h = harness(async (url, opts) => {
    if (opts && opts.method === 'POST') { stored = JSON.parse(opts.body).waitingBadge; throw new Error('connection reset'); }
    return { ok: true, json: async () => ({ waitingBadge: stored }) };
  });
  await h.api.paintWaitingBadge();
  await h.api.saveWaitingBadge();
  assert.equal(stored, false, 'CONTROL: the board did store the Off');
  assert.equal(h.tog.getAttribute('aria-checked'), 'false', 'the switch kept a position the board no longer holds');
  assert.match(h.msg.textContent, /could not save/, 'the lost answer was not said');
});

test('#4025: a save paints the board\'s answer, not the click (the board may hold something else)', async () => {
  const h = harness(async (url, opts) => ((opts && opts.method === 'POST')
    ? { ok: true, json: async () => ({ ok: true, waitingBadge: true }) } : { ok: true, json: async () => ({ waitingBadge: true }) }));
  await h.api.paintWaitingBadge();
  await h.api.saveWaitingBadge();   // asks for Off; the board answers it holds On
  assert.equal(h.tog.getAttribute('aria-checked'), 'true', 'the switch drew the click, not what the board stored');
});

test('#4025: a repaint while a save is in flight does not draw over it', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let reads = 0;
  const h = harness(async (url, opts) => {
    if (opts && opts.method === 'POST') { await gate; return { ok: true, json: async () => ({ ok: true, waitingBadge: false }) }; }
    reads += 1;
    return { ok: true, json: async () => ({ waitingBadge: true }) };
  });
  await h.api.paintWaitingBadge();
  const saving = h.api.saveWaitingBadge();
  await h.api.paintWaitingBadge();   // Settings repainted mid-save
  assert.equal(reads, 1, 'a repaint read the board while the save was in flight');
  release(); await saving;
  assert.equal(h.tog.getAttribute('aria-checked'), 'false', 'the save\'s answer was thrown away');
});

test('#4025 round 5: a click during a lost-answer re-read waits, so the switch never shows what the board does not hold', { timeout: 5000 }, async () => {
  let stored = true;
  let releaseRead;
  let posts = 0;
  let slowRead = false;
  const h = harness(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts += 1;
      if (posts === 1) throw new Error('connection reset');   // not stored, answer lost
      stored = JSON.parse(opts.body).waitingBadge;
      return { ok: true, json: async () => ({ ok: true, waitingBadge: stored }) };
    }
    if (slowRead) await new Promise((r) => { releaseRead = r; });
    return { ok: true, json: async () => ({ waitingBadge: stored }) };
  });
  await h.api.paintWaitingBadge();
  slowRead = true;
  const first = h.api.saveWaitingBadge();   // fails, then re-reads slowly
  await new Promise((r) => setImmediate(r));
  await h.api.saveWaitingBadge();           // a second click during the re-read
  await h.api.paintWaitingBadge();          // and a Settings repaint
  assert.equal(posts, 1, 'a second save started while the first was still re-reading');
  slowRead = false; releaseRead(); await first;
  assert.equal(h.tog.getAttribute('aria-checked'), String(stored), 'the switch shows a position the board does not hold');
});

test('#4025 round 5: opening Settings paints the switch (the hook is wired)', () => {
  const body = page.liftAll(SCRIPT, ['paintSettings']);
  assert.match(body, /\bpaintWaitingBadge\(\)/, 'paintSettings no longer loads the App icon switch, so it would stay hidden');
});

test('#4025 round 5: a failed read with the keyboard on the switch moves focus to the sentence, not the page behind', async () => {
  const h = harness(async () => ({ ok: false, json: async () => ({}) }));
  h.tog.attrs['aria-checked'] = 'true'; h.tog.hidden = false;
  h.document.activeElement = h.tog;
  await h.api.paintWaitingBadge();
  assert.equal(h.tog.hidden, true, 'CONTROL: the switch hid');
  assert.equal(h.document.activeElement, h.msg, 'focus stayed on a hidden switch (it falls to the page behind)');
});
