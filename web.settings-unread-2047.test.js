'use strict';

/**
 * #2047: a Settings flag-reader must not render a definite switch position when
 * it could not READ the setting. The reported case was auto-update showing a
 * confident OFF on a 403 board (server.js's board-token gate returns 403 with a
 * JSON error body). The reader did `await (await fetch('/api/X')).json()` and
 * relied on its `catch` for the unread branch -- but a 403 does NOT reject: it
 * resolves with `ok:false` and a parseable body, so `.json()` succeeds, the
 * catch never fires, and the error object `{error:...}` is painted as a real
 * setting (`r.on === true` is false -> a confident OFF nobody set).
 *
 * The sibling readers ah-toggle/hb-toggle (#2054) and tell/notify (#2020) were
 * already made 403-safe. This pins the three that were not: auto, eng, lim.
 *
 * 🔑 THE ARM THAT MATTERS IS THE 403 (ok:false), NOT THE OFFLINE (reject). The
 * existing seam test in server.test.js drives a fetch that REJECTS, which is the
 * network-failure catch and was never the bug. A 403 RESOLVES, and that is the
 * path this file exercises -- with a 200 control proving the reader still paints
 * a real position, so the "no position" assertion cannot pass vacuously.
 *
 *   node --test web.settings-unread-2047.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** An element the real paintSwitch (and the readers) can drive. */
function elStub() {
  const attrs = {};
  const classes = new Set();
  return {
    hidden: false,
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    classList: {
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
    _classes: classes,
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute(k) { return k in attrs; },
  };
}

function makeDoc() {
  const els = {};
  return {
    els,
    document: {
      getElementById(id) { if (!(id in els)) els[id] = elStub(); return els[id]; },
      activeElement: null,
    },
  };
}

/** A fetch that RESOLVES (never rejects), the way a real 403/200 does. */
function fetchStub(ok, body) {
  return async () => ({ ok, status: ok ? 200 : 403, json: async () => body });
}

/* The board-token gate's real 403 body (server.js): a parseable JSON object
   with no `on` field. This is exactly the shape that slipped past the old catch. */
const GATE_403 = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };

/**
 * Each reader lifted with its real callees and wired to a stub document + fetch.
 * `pjApplyEngMode` is stubbed to a no-op: refreshEngMode calls it on the read
 * path and it touches project-viewport chrome irrelevant to the switch position.
 */
function build(readerName, prelude, callees, fetchImpl) {
  const { els, document } = makeDoc();
  const parts = [prelude, ...callees.map((c) => lift(SCRIPT, c)), lift(SCRIPT, readerName)];
  const src = parts.join('\n') + '\nreturn ' + readerName + ';';
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'fetch', src)(document, fetchImpl);
  return { els, run };
}

const READERS = [
  {
    name: 'auto-update',
    reader: 'refreshAutoUpdate',
    prelude: 'let AUTO_EPOCH=0;',
    callees: ['paintSwitch', 'autoPaint'],
    toggle: 'auto-toggle',
    msg: 'auto-msg',
    onBody: { on: true, ok: true },
    okFalseBody: { on: true, ok: false },
  },
  {
    name: 'engineering mode',
    reader: 'refreshEngMode',
    prelude: 'let ENG_ON=false; let ENG_EPOCH=0; function pjApplyEngMode(){}',
    callees: ['paintSwitch'],
    toggle: 'eng-toggle',
    msg: 'eng-msg',
    onBody: { on: true, ok: true },
    okFalseBody: { on: true, ok: false },
  },
  {
    name: 'run limits',
    reader: 'paintLimits',
    prelude: 'let LIM_EPOCH=0;',
    callees: ['paintSwitch', 'paintLimitsFrom'],
    toggle: 'lim-toggle',
    msg: 'lim-msg',
    onBody: { on: true, ok: true, tiers: [10, 40, 100], perHour: 40 },
    okFalseBody: { on: true, ok: false, tiers: [10, 40, 100], perHour: 40 },
  },
];

for (const r of READERS) {
  // Presence before absence: prove the reader CAN paint a definite position, or
  // the 403 assertion below would pass on a reader that never shows one.
  test('#2047 control: ' + r.name + ' paints the real position on a 200 read', async () => {
    const { els, run } = build(r.reader, r.prelude, r.callees, fetchStub(true, r.onBody));
    await run();
    assert.equal(els[r.toggle].getAttribute('aria-checked'), 'true',
      r.reader + ': a readable On did not render as On');
    assert.equal(els[r.toggle].hidden, false,
      r.reader + ': a readable switch stayed hidden');
  });

  test('#2047: ' + r.name + ' renders NO position on a 403 board (not OFF, not ON)', async () => {
    const { els, run } = build(r.reader, r.prelude, r.callees, fetchStub(false, GATE_403));
    await run();
    // The switch role is two-state and cannot say "unknown", so the honest
    // rendering of an unread setting is the ABSENCE of a positioned control.
    assert.equal(els[r.toggle].hidden, true,
      r.reader + ': a 403 read left a switch on screen -- a position nobody read');
    assert.equal(els[r.toggle].hasAttribute('aria-checked'), false,
      r.reader + ': a 403 kept an aria-checked, which reads as a definite answer if anything un-hides it');
    assert.equal(els[r.toggle]._classes.has('on'), false,
      r.reader + ': a 403 rendered as On');
    assert.match(els[r.msg].textContent, /could not/i,
      r.reader + ': a 403 said nothing, so the switch would be the only claim on screen');
  });

  // The invariant the card is really about: a 200 with {ok:false} is a CORRUPT
  // read (the engine's honest "safe default in force"), NOT a gated one. It must
  // KEEP its switch at the safe-default position -- the res.ok check must not
  // over-broaden and route ok:false into the unread branch too. The tell that
  // separates this from the 403 arm is hidden === false (the control stays).
  test('#2047: ' + r.name + ' KEEPS its switch on a 200 corrupt read (ok:false, not unread)', async () => {
    const { els, run } = build(r.reader, r.prelude, r.callees, fetchStub(true, r.okFalseBody));
    await run();
    assert.equal(els[r.toggle].hidden, false,
      r.reader + ': a 200 {ok:false} corrupt read wrongly hid the switch -- ok:false is not unread');
    assert.equal(els[r.toggle].getAttribute('aria-checked'), 'true',
      r.reader + ': a 200 {ok:false} read must keep the safe-default position');
    assert.match(els[r.msg].textContent, /could not/i,
      r.reader + ': a 200 {ok:false} read must say the setting could not be read');
  });
}
