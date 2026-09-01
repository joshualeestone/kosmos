'use strict';

/**
 * kosmos#1668: the Settings time-zone control (the CAPTURE half, in the page).
 *
 *   node --test web.timezone-1668.test.js
 *
 * The real paintYouTz is lifted and run against a stub. It must: list the
 * runtime's zones, default the dropdown to THIS computer's own zone when nothing
 * is saved (so a person who never opens Settings still has the right one), show
 * the saved zone when there is one, and make a zone the enumeration omits still
 * selectable. The consumer half (an agent's greeting changing) is demonstrated
 * in engine/timezone-1668.test.js; the route in server.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift, liftConst } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A <select> stub that models the ordering paintYouTz relies on. */
function tzDom(machineTz) {
  const options = [];
  const sel = {
    value: '', disabled: true,
    get options() { return options; },
    appendChild(o) { options.push(o); return o; },
    insertBefore(o, ref) { const i = ref ? options.indexOf(ref) : 0; options.splice(i < 0 ? 0 : i, 0, o); return o; },
    get firstChild() { return options[0] || null; },
  };
  const btn = { disabled: true };
  const msg = { textContent: '' };
  const els = { 'you-tz': sel, 'you-tz-save': btn, 'you-tz-msg': msg };
  const document = {
    getElementById(id) { if (!(id in els)) throw new Error('the page asked for #' + id + ', which this stub does not carry'); return els[id]; },
    createElement() { return { value: '', textContent: '' }; },
    activeElement: null,
  };
  const Intl = {
    supportedValuesOf: () => ['America/Chicago', 'America/New_York', 'Asia/Tokyo'],
    DateTimeFormat: function () { return { resolvedOptions: () => ({ timeZone: machineTz }) }; },
  };
  return { sel, btn, msg, document, Intl };
}

/** paintYouTz, the REAL one, wired to a stub fetch that returns `savedTz`. */
function makePaint(machineTz, savedTz) {
  const d = tzDom(machineTz);
  const fetchStub = async () => ({ json: async () => ({ timezone: savedTz }) });
  const src = liftConst(SCRIPT, 'YOU_TZ_FALLBACK') + '\n'
    + lift(SCRIPT, 'youTzMachine') + '\n'
    + lift(SCRIPT, 'paintYouTz') + '\nreturn paintYouTz;';
  const paint = new Function('document', 'fetch', 'Intl', src)(d.document, fetchStub, d.Intl);
  return { paint, ...d };
}

test('kosmos#1668: with no saved zone the dropdown defaults to this computer and asks to confirm', async () => {
  const { paint, sel, btn, msg } = makePaint('America/Chicago', null);
  await paint();
  assert.ok(sel.options.length >= 3, 'the runtime zones are listed');
  assert.equal(sel.value, 'America/Chicago', 'defaults to this computer’s own zone');
  assert.equal(sel.disabled, false, 'the dropdown is enabled');
  assert.equal(btn.disabled, false, 'Save is enabled');
  assert.match(msg.textContent, /Save to confirm/, 'it says the default is unsaved');
});

test('kosmos#1668: a saved zone is shown and not treated as unsaved', async () => {
  const { paint, sel, msg } = makePaint('America/Chicago', 'Asia/Tokyo');
  await paint();
  assert.equal(sel.value, 'Asia/Tokyo', 'the saved zone is selected, not the machine zone');
  assert.equal(msg.textContent, '', 'a saved zone shows no confirm-me hint');
});

test('kosmos#1668: a machine zone the enumeration omits is still made selectable', async () => {
  // Intl.supportedValuesOf returns three zones; the machine is none of them.
  const { paint, sel } = makePaint('Pacific/Chatham', null);
  await paint();
  assert.equal(sel.value, 'Pacific/Chatham', 'the machine zone was inserted and selected');
  assert.ok(sel.options.some((o) => o.value === 'Pacific/Chatham'), 'it is a real option');
});

test('kosmos#1668: the control is wired -- HTML present, painted on settings open, saved to the route', () => {
  // The field exists in Settings, beside Your name.
  const at = PAGE.indexOf('id="you-tz"');
  assert.ok(at > -1, 'the you-tz dropdown is in the page');
  const field = PAGE.slice(PAGE.lastIndexOf('<div class="field"', at), at + 400);
  assert.match(field, /id="you-tz-save"/, 'a Save button sits with the dropdown');
  assert.match(field, /id="you-tz-msg"/, 'a status line sits with the dropdown');

  // paintSettings paints it, or opening Settings would never load it.
  const paintSettings = lift(SCRIPT, 'paintSettings');
  assert.match(paintSettings, /paintYouTz\(\)/, 'paintSettings calls paintYouTz');

  // The save path posts to the capture route (the save handler is an anonymous
  // listener, so this is asserted on the script text rather than lifted).
  const saveAt = SCRIPT.indexOf("getElementById('you-tz-save').addEventListener");
  assert.ok(saveAt > -1, 'the you-tz-save click handler exists');
  const handler = SCRIPT.slice(saveAt, saveAt + 700);
  assert.match(handler, /fetch\('\/api\/settings',[\s\S]*method: 'POST'/, 'Save POSTs to /api/settings');
  assert.match(handler, /JSON\.stringify\(\{ timezone \}\)/, 'it sends the chosen timezone');
});
