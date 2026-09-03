'use strict';

/**
 * kosmos#1722 / #2054: the Settings > Automation heartbeat (Prompter) control. #2054
 * turned it from a checkbox + Save button into the app's `.toggle` slider that saves on
 * flip, with the interval saving on change and hidden while off (the lim pattern). The
 * real paintHeartbeat is lifted (with the real paintSwitch) and run against a stub: it
 * loads the in-force setting into the toggle and interval select, renders the interval
 * choices the server names, defaults to on/17 (#2013), and, as a STATUS control, HIDES
 * the knob on a could-not-read read rather than show a false Off.
 *
 * ⭐ #2054 ACCEPTANCE (Mona Lisa): a moved setting must keep its stored VALUE. The value
 * lives server-side and is read on paint, so the guarantee is (a) a non-default stored
 * value paints as itself, and (b) paint issues no write. Both are pinned below.
 *
 * The sweep is tested in engine/heartbeat.test.js; the route in server.heartbeat-1722.test.js.
 *
 *   node --test web.heartbeat-1722.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A stub toggle element the real paintSwitch can drive. */
function toggleEl() {
  const attrs = {};
  return {
    hidden: true,
    classList: { toggle() {}, remove() {}, add() {} },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute(k) { return k in attrs; },
  };
}

function dom() {
  const els = {
    'hb-toggle': toggleEl(),
    'hb-interval': { value: '', innerHTML: '' },
    'hb-interval-row': { hidden: false },
    'hb-msg': { textContent: '' },
    'hb-needs-notify': { hidden: false }, // default visible, so a test proves paint HIDES it when notify is on
  };
  return {
    els,
    document: {
      getElementById(id) { if (!(id in els)) throw new Error('the page asked for #' + id + ', not stubbed'); return els[id]; },
      activeElement: null,
    },
  };
}

/**
 * paintHeartbeat, the REAL one (with the real paintSwitch), wired to a URL-aware stub
 * fetch: `/api/notify-setting` returns `{on: notifyOn, ok: true}` (the master switch),
 * everything else returns `served` with `ok`. `calls` records every fetch so a test can
 * assert paint never WRITES. `notifyOn` defaults to true (notifications on).
 */
function makePaint(served, notifyOn = true, ok = true) {
  const d = dom();
  const calls = [];
  const fetchStub = async (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    if (String(url).indexOf('notify-setting') !== -1) return { ok: true, json: async () => ({ on: notifyOn, ok: true }) };
    return { ok, json: async () => served };
  };
  const body = lift(SCRIPT, 'paintSwitch') + '\n' + lift(SCRIPT, 'paintHeartbeat') + '\nreturn paintHeartbeat;';
  const paint = new Function('document', 'fetch', body)(d.document, fetchStub);
  return { paint, calls, ...d };
}

test('kosmos#1722: the in-force setting LOADS, and the interval choices come from the server', async () => {
  const { paint, els } = makePaint({ on: true, intervalMinutes: 60, intervals: [5, 10, 17, 60], ok: true });
  await paint();
  assert.equal(els['hb-toggle'].getAttribute('aria-checked'), 'true', 'the toggle reflects the in-force on');
  assert.equal(els['hb-toggle'].hidden, false, 'the toggle is shown once its position is known');
  assert.equal(els['hb-interval'].value, '60', 'the interval reflects the in-force value');
  assert.match(els['hb-interval'].innerHTML, /value="5"/, 'the select renders the server interval choices');
  assert.match(els['hb-interval'].innerHTML, /value="60"/, 'every choice the server names is rendered');
  assert.equal(els['hb-interval-row'].hidden, false, 'the interval row shows while on');
});

test('kosmos#1722: renders off and 17 minutes when the server says the heartbeat is off', async () => {
  const { paint, els } = makePaint({ on: false, intervalMinutes: 17, intervals: [5, 10, 17, 60], ok: true });
  await paint();
  assert.equal(els['hb-toggle'].getAttribute('aria-checked'), 'false', 'a served off renders the toggle off');
  assert.equal(els['hb-interval'].value, '17', 'the interval is the fleet-cadence default');
  assert.equal(els['hb-interval-row'].hidden, true, 'the interval row hides while off');
});

test('#2054 ACCEPTANCE: a NON-default stored value paints as itself, and paint writes nothing', async () => {
  // on:false / interval:60 is not the on/17 default, so a control that "silently reset"
  // on the move would show on/17 here.
  const { paint, els, calls } = makePaint({ on: false, intervalMinutes: 60, intervals: [5, 10, 17, 60], ok: true });
  await paint();
  assert.equal(els['hb-toggle'].getAttribute('aria-checked'), 'false', 'the stored OFF survived the move');
  assert.equal(els['hb-interval'].value, '60', 'the stored interval survived the move (not the default 17)');
  const writes = calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD');
  assert.deepEqual(writes, [], 'paint issued a write (' + JSON.stringify(writes) + '); a paint that saves can reset a stored value');
});

test('kosmos#1722/#2054: a could-not-read read HIDES the knob (status control), never a false Off', async () => {
  // Hard failure: a thrown fetch.
  const d = dom();
  const body = lift(SCRIPT, 'paintSwitch') + '\n' + lift(SCRIPT, 'paintHeartbeat') + '\nreturn paintHeartbeat;';
  const paint = new Function('document', 'fetch', body)(d.document, async () => { throw new Error('down'); });
  await paint();
  assert.equal(d.els['hb-toggle'].hidden, true, 'a read failure hides the knob rather than showing a stale toggle');
  assert.equal(d.els['hb-toggle'].hasAttribute('aria-checked'), false, 'and strips aria-checked, so nothing reads it as Off');
  assert.equal(d.els['hb-interval-row'].hidden, true, 'the interval row is hidden too');
  assert.match(d.els['hb-msg'].textContent, /could not read/i, 'and it says the read failed');

  // 403 on an enforcing board: a NON-OK response is could-not-read, not a position.
  const gated = makePaint({ on: true, intervalMinutes: 17, intervals: [5, 10, 17, 60], ok: true }, true, false);
  await gated.paint();
  assert.equal(gated.els['hb-toggle'].hidden, true, 'a non-ok GET (403) hides the knob rather than painting a position from it');
  assert.equal(gated.els['hb-toggle'].hasAttribute('aria-checked'), false, 'a 403 draws no aria-checked');
});

test('kosmos#1722: the notify-off hint (Mona\'s edit 5) shows ONLY when the notify master switch is off', async () => {
  const settingOn = { on: true, intervalMinutes: 17, intervals: [5, 10, 17, 60], ok: true };
  const off = makePaint(settingOn, false); // notifications OFF
  await off.paint();
  assert.equal(off.els['hb-needs-notify'].hidden, false, 'notify off => the hint is shown');

  const on = makePaint(settingOn, true); // notifications ON
  await on.paint();
  assert.equal(on.els['hb-needs-notify'].hidden, true, 'notify on => the hint is hidden');
});

test('kosmos#1722: the notify-off hint is a DEDICATED element with Mona\'s exact string, not hb-msg', () => {
  assert.ok(PAGE.includes('id="hb-needs-notify"'), 'the dedicated hint element exists');
  assert.ok(PAGE.includes('Notifications are off, so this cannot reach you. Turn them on and Kosmos will let you know when an agent has stopped.'),
    'the hint carries Mona\'s exact voice string');
  // it ships hidden by default (shown only when notify is off, set in paintHeartbeat)
  assert.match(PAGE, /id="hb-needs-notify"[^>]*hidden/, 'the hint is hidden by default in the markup');
});

test('kosmos#1722/#2054: the control is wired -- section, slider + interval, painted on open, saved on interact', () => {
  assert.ok(PAGE.includes('id="s-sec-automation"'), 'the Automation section is in the page');
  for (const id of ['hb-toggle', 'hb-interval', 'hb-interval-row', 'hb-msg', 'hb-needs-notify']) {
    assert.ok(PAGE.includes('id="' + id + '"'), id + ' is present');
  }
  // No Save button any more: the slider commits on flip.
  assert.ok(!PAGE.includes('id="hb-save"'), 'the hb-save button should be gone (#2054: sliders commit on flip)');
  const paint = lift(SCRIPT, 'paintHeartbeat');
  assert.match(paint, /fetch\('\/api\/notify-setting'/, 'paintHeartbeat reads the notify master state for the hint');
  const paintSettings = lift(SCRIPT, 'paintSettings');
  assert.match(paintSettings, /paintHeartbeat\(\)/, 'paintSettings calls paintHeartbeat');
  assert.match(SCRIPT, /getElementById\('hb-toggle'\)[\s\S]{0,40}addEventListener\('click', hbToggleClick\)/, 'the toggle click is wired to hbToggleClick');
  assert.match(SCRIPT, /getElementById\('hb-interval'\)[\s\S]{0,40}addEventListener\('change', hbIntervalChange\)/, 'the interval change is wired to hbIntervalChange');
  const save = lift(SCRIPT, 'saveHeartbeat');
  assert.match(save, /fetch\('\/api\/heartbeat-setting',[\s\S]*method: 'PUT'/, 'a save PUTs to /api/heartbeat-setting');
  assert.match(save, /\bintervalMinutes\b/, 'it sends the interval');
  // The pre-load guard that stops a write from resetting a stored value.
  const change = lift(SCRIPT, 'hbIntervalChange');
  assert.match(change, /hasAttribute\('aria-checked'\)/, 'the interval handler refuses to save before the setting has loaded');
});
