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
  // #3338: the search accelerator input. Model addEventListener + dataset so
  // paintYouTz can wire it, and expose the handler so a test can drive typing.
  const search = {
    value: '', dataset: {}, _handlers: {},
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    type(v) { this.value = v; if (this._handlers.input) this._handlers.input(); },
  };
  const els = { 'you-tz': sel, 'you-tz-save': btn, 'you-tz-msg': msg, 'you-tz-search': search };
  const document = {
    getElementById(id) { if (!(id in els)) throw new Error('the page asked for #' + id + ', which this stub does not carry'); return els[id]; },
    createElement() { return { value: '', textContent: '' }; },
    activeElement: null,
  };
  const Intl = {
    supportedValuesOf: () => ['America/Chicago', 'America/New_York', 'Asia/Tokyo'],
    DateTimeFormat: function () { return { resolvedOptions: () => ({ timeZone: machineTz }) }; },
  };
  return { sel, btn, msg, search, document, Intl };
}

/** paintYouTz, the REAL one, wired to a stub fetch that returns `savedTz`.
 *  #3338: the friendly picker replaced the raw Intl list, so the slice now lifts
 *  the friendly data + helpers (YOU_TZ_FRIENDLY / places / zip3 and the youTz*
 *  functions) rather than YOU_TZ_FALLBACK. */
function makePaint(machineTz, savedTz) {
  const d = tzDom(machineTz);
  const fetchStub = async () => ({ json: async () => ({ timezone: savedTz }) });
  const src = liftConst(SCRIPT, 'YOU_TZ_FRIENDLY') + '\n'
    + liftConst(SCRIPT, 'YOU_TZ_PLACES') + '\n'
    + liftConst(SCRIPT, 'YOU_TZ_ZIP3') + '\n'
    + lift(SCRIPT, 'youTzMachine') + '\n'
    + lift(SCRIPT, 'youTzLabel') + '\n'
    + lift(SCRIPT, 'youTzResolve') + '\n'
    + lift(SCRIPT, 'youTzSelect') + '\n'
    + lift(SCRIPT, 'youTzFillSelect') + '\n'
    + lift(SCRIPT, 'youTzWireSearch') + '\n'
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

test('#3338: zones are shown with friendly labels, not raw IANA ids', async () => {
  const { paint, sel } = makePaint('America/Chicago', null);
  await paint();
  const chi = sel.options.find((o) => o.value === 'America/Chicago');
  assert.ok(chi, 'the Central zone is an option');
  assert.equal(chi.textContent, 'Central Time (CT)', 'it is labelled in plain language, not "America/Chicago"');
  // The full raw Intl enumeration (hundreds of ids) is gone; a short friendly set remains.
  assert.ok(sel.options.length <= 20, 'the friendly list is short, not the ~400-entry raw list');
});

test('#3338: typing a city jumps the select (Dallas / McKinney -> Central)', async () => {
  const { paint, sel, search } = makePaint('America/New_York', null);
  await paint();
  search.type('Dallas');
  assert.equal(sel.value, 'America/Chicago', 'Dallas resolves to Central');
  search.type('McKinney');
  assert.equal(sel.value, 'America/Chicago', 'McKinney resolves to Central');
  search.type('New York');
  assert.equal(sel.value, 'America/New_York', 'New York resolves to Eastern');
});

test('#3338: typing a US ZIP jumps the select (75454 -> Central, 90210 -> Pacific)', async () => {
  const { paint, sel, search } = makePaint('America/New_York', null);
  await paint();
  search.type('75454');
  assert.equal(sel.value, 'America/Chicago', 'a McKinney-area ZIP resolves to Central');
  search.type('90210');
  assert.equal(sel.value, 'America/Los_Angeles', 'a Beverly Hills ZIP resolves to Pacific');
});

test('#3338: an unrecognized query does NOT move the selection (no wrong jump)', async () => {
  const { paint, sel, search, msg } = makePaint('America/Chicago', null);
  await paint();
  const before = sel.value;
  search.type('zzzzzz');
  assert.equal(sel.value, before, 'a nonsense query leaves the current zone alone');
  assert.match(msg.textContent, /No match/, 'and it says so rather than silently doing nothing');
});

test('#3338: a single letter does NOT jump the select (no mid-typing flicker)', async () => {
  const { paint, sel, search } = makePaint('America/New_York', null);
  await paint();
  const before = sel.value;
  // "d" is the first letter of "Dallas"; without the length gate it matched
  // "america/denver" and jumped the select to Denver before the city was typed.
  search.type('d');
  assert.equal(sel.value, before, 'one letter does not resolve');
  search.type('da');
  assert.equal(sel.value, before, 'two letters do not resolve');
});

test('#3338: zone abbreviations and zone words resolve (CT, central, pacific)', async () => {
  const { paint, sel, search } = makePaint('America/New_York', null);
  await paint();
  search.type('CT');
  assert.equal(sel.value, 'America/Chicago', '"CT" resolves to Central');
  search.type('central');
  assert.equal(sel.value, 'America/Chicago', '"central" resolves to Central');
  search.type('pacific');
  assert.equal(sel.value, 'America/Los_Angeles', '"pacific" resolves to Pacific');
});

test('#3338: the search accelerator input is present in the Settings markup', () => {
  const at = PAGE.indexOf('id="you-tz-search"');
  assert.ok(at > -1, 'the city/ZIP search input sits with the time-zone control');
  const field = PAGE.slice(PAGE.lastIndexOf('<div class="field"', at), PAGE.indexOf('id="you-tz-msg"', at));
  assert.match(field, /id="you-tz"/, 'the search input is beside the zone select');
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
