'use strict';

/**
 * kosmos#1722: the Settings > Automation heartbeat control (the later addition to
 * the section #1724 created). The real paintHeartbeat is lifted and run against a
 * stub: it loads the in-force setting into the checkbox and interval select,
 * renders the interval choices the server names, defaults to off/17, and enables
 * the controls. Unlike #1724's auto-save, this control is WIRED (the runner is
 * live in server.js), so it does not ship not-yet-active. The sweep is tested in
 * engine/heartbeat.test.js; the route in server.heartbeat-1722.test.js.
 *
 *   node --test web.heartbeat-1722.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

function dom() {
  const els = {
    'hb-enabled': { checked: false, disabled: true },
    'hb-interval': { value: '', innerHTML: '', disabled: true },
    'hb-save': { disabled: true },
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
 * paintHeartbeat, the REAL one, wired to a URL-aware stub fetch: `/api/notify-setting`
 * returns `{on: notifyOn}` (the master switch), everything else returns `served`
 * (the heartbeat setting). `notifyOn` defaults to true (notifications on).
 */
function makePaint(served, notifyOn = true) {
  const d = dom();
  const fetchStub = async (url) => ({
    json: async () => (String(url).indexOf('notify-setting') !== -1 ? { on: notifyOn, ok: true } : served),
  });
  const paint = new Function('document', 'fetch',
    lift(SCRIPT, 'paintHeartbeat') + '\nreturn paintHeartbeat;')(d.document, fetchStub);
  return { paint, ...d };
}

test('kosmos#1722: the in-force setting LOADS, and the interval choices come from the server', async () => {
  const { paint, els } = makePaint({ on: true, intervalMinutes: 60, intervals: [5, 10, 17, 60], ok: true });
  await paint();
  assert.equal(els['hb-enabled'].checked, true, 'on reflects the in-force value');
  assert.equal(els['hb-interval'].value, '60', 'the interval reflects the in-force value');
  assert.match(els['hb-interval'].innerHTML, /value="5"/, 'the select renders the server interval choices');
  assert.match(els['hb-interval'].innerHTML, /value="60"/, 'every choice the server names is rendered');
  // WIRED, not not-yet-active: the runner is live, so the control is enabled.
  assert.equal(els['hb-enabled'].disabled, false, 'the toggle is enabled (the runner is live)');
  assert.equal(els['hb-save'].disabled, false, 'Save is enabled');
});

test('kosmos#1722: defaults to off and 17 minutes when the heartbeat is off', async () => {
  const { paint, els } = makePaint({ on: false, intervalMinutes: 17, intervals: [5, 10, 17, 60], ok: true });
  await paint();
  assert.equal(els['hb-enabled'].checked, false, 'off by default');
  assert.equal(els['hb-interval'].value, '17', 'the interval is the fleet-cadence default');
});

test('kosmos#1722: a failed read disables the controls and says so, never silently', async () => {
  const d = dom();
  const paint = new Function('document', 'fetch',
    lift(SCRIPT, 'paintHeartbeat') + '\nreturn paintHeartbeat;')(d.document, async () => { throw new Error('down'); });
  await paint();
  assert.equal(d.els['hb-enabled'].disabled, true, 'a read failure disables rather than showing a stale toggle');
  assert.match(d.els['hb-msg'].textContent, /could not read/i, 'and it says the read failed');
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

test('kosmos#1722: the control is wired -- section, controls, painted on open, saved to the route', () => {
  assert.ok(PAGE.includes('id="s-sec-automation"'), 'the Automation section is in the page');
  for (const id of ['hb-enabled', 'hb-interval', 'hb-save', 'hb-msg', 'hb-needs-notify']) {
    assert.ok(PAGE.includes('id="' + id + '"'), id + ' is present');
  }
  const paint = lift(SCRIPT, 'paintHeartbeat');
  assert.match(paint, /fetch\('\/api\/notify-setting'/, 'paintHeartbeat reads the notify master state for the hint');
  const paintSettings = lift(SCRIPT, 'paintSettings');
  assert.match(paintSettings, /paintHeartbeat\(\)/, 'paintSettings calls paintHeartbeat');
  const saveAt = SCRIPT.indexOf("getElementById('hb-save').addEventListener");
  assert.ok(saveAt > -1, 'the hb-save click handler exists');
  const handler = SCRIPT.slice(saveAt, saveAt + 900);
  assert.match(handler, /fetch\('\/api\/heartbeat-setting',[\s\S]*method: 'PUT'/, 'Save PUTs to /api/heartbeat-setting');
  assert.match(handler, /intervalMinutes:/, 'it sends the interval');
});
