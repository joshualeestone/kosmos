'use strict';

/**
 * kosmos#1724 / #2054: the Settings > Automation auto-handoff control (the capture
 * half, in the page). #2054 turned it from a checkbox + Save button into the app's
 * `.toggle` slider that saves on flip, with the threshold saving on change and hidden
 * while off (the lim pattern). The real paintAutomation is lifted (with the real
 * paintSwitch) and run against a stub: it must load a saved setting into the toggle and
 * threshold, default to on/85 when nothing is saved (#2013), and, as a STATUS control,
 * HIDE the knob on a could-not-read read rather than show a false Off.
 *
 * ⭐ #2054 ACCEPTANCE (Mona Lisa, unprompted): a moved setting must keep its stored
 * VALUE, not reset to a default. The value lives server-side and is read on paint, so
 * the guarantee is (a) a non-default stored value paints as itself, and (b) paint issues
 * no write. Both are pinned below.
 *
 * The trigger (the consume half) is tested in engine/autohandoff.test.js; the route in
 * server.test.js.
 *
 *   node --test web.autohandoff-1724.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A stub toggle element that the real paintSwitch can drive. */
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
    'ah-toggle': toggleEl(),
    'ah-threshold': { value: '' },
    'ah-threshold-row': { hidden: false },
    'ah-msg': { textContent: '' },
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
 * paintAutomation, the REAL one (with the real paintSwitch), wired to a stub fetch.
 * `saved` is what GET /api/settings returns as `.autohandoff` (undefined => no value
 * stored). `ok` is the HTTP ok flag; a false ok is could-not-read. `calls` records every
 * fetch so a test can assert paint never WRITES.
 */
function makePaint(saved, ok = true) {
  const d = dom();
  const calls = [];
  const fetchStub = async (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    return { ok, json: async () => ({ autohandoff: saved }) };
  };
  const body = 'let AH_EPOCH=0;\n' + lift(SCRIPT, 'paintSwitch') + '\n' + lift(SCRIPT, 'paintAutomation') + '\nreturn paintAutomation;';
  const paint = new Function('document', 'fetch', body)(d.document, fetchStub);
  return { paint, calls, ...d };
}

test('kosmos#1724: a saved setting LOADS into the slider and threshold', async () => {
  const { paint, els } = makePaint({ enabled: true, threshold: 90 });
  await paint();
  assert.equal(els['ah-toggle'].getAttribute('aria-checked'), 'true', 'the toggle reflects the saved on');
  assert.equal(els['ah-toggle'].hidden, false, 'the toggle is shown once its position is known');
  assert.equal(els['ah-threshold'].value, '90', 'threshold reflects the saved value');
  assert.equal(els['ah-threshold-row'].hidden, false, 'the threshold row shows while on');
  assert.equal(els['ah-msg'].textContent, '', 'no message on a clean read');
});

test('kosmos#1724/#2013: defaults to ON and 85% when nothing is saved', async () => {
  const { paint, els } = makePaint(undefined);
  await paint();
  assert.equal(els['ah-toggle'].getAttribute('aria-checked'), 'true', 'on by default');
  assert.equal(els['ah-threshold'].value, '85', 'threshold defaults to 85');
});

test('#2054 ACCEPTANCE: a NON-default stored value paints as itself, and paint writes nothing', async () => {
  // enabled:false / threshold:95 is the opposite of the on/85 default, so a control
  // that "silently reset" on the move would show on/85 here instead of off/95.
  const { paint, els, calls } = makePaint({ enabled: false, threshold: 95 });
  await paint();
  assert.equal(els['ah-toggle'].getAttribute('aria-checked'), 'false', 'the stored OFF survived the move (not the default on)');
  assert.equal(els['ah-threshold'].value, '95', 'the stored threshold survived the move (not the default 85)');
  assert.equal(els['ah-threshold-row'].hidden, true, 'the threshold row hides while off');
  // The core of "a moved setting must not silently reset": paint READS, never WRITES.
  const writes = calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD');
  assert.deepEqual(writes, [], 'paint issued a write (' + JSON.stringify(writes) + '); a paint that saves can reset a stored value');
});

test('#2054 (executable): flipping a LOADED toggle POSTs the flipped value and repaints from the server echo', async () => {
  // The post-load save path, executed rather than regex-matched -- this is the path
  // the catch-guard and repaint bugs live in. Start loaded (toggle off, threshold 90),
  // flip it, and assert exactly one POST with the flipped enabled + current threshold,
  // then a repaint from the server's echo.
  const d = dom();
  d.els['ah-toggle'].setAttribute('aria-checked', 'false');
  d.els['ah-toggle'].hidden = false;
  d.els['ah-threshold'].value = '90';
  const calls = [];
  const fetchStub = async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const bodyObj = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method, body: bodyObj });
    return { ok: true, json: async () => ({ ok: true, autohandoff: bodyObj && bodyObj.autohandoff }) };
  };
  const body = 'let AH_SAVING=false;\nlet AH_EPOCH=0;\n'
    + lift(SCRIPT, 'paintSwitch') + '\n'
    + lift(SCRIPT, 'paintAutomation') + '\n'
    + lift(SCRIPT, 'saveAutohandoff') + '\n'
    + lift(SCRIPT, 'ahToggleClick') + '\nreturn ahToggleClick;';
  const ahToggleClick = new Function('document', 'fetch', body)(d.document, fetchStub);
  ahToggleClick();
  await new Promise((r) => setTimeout(r, 0));
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1, 'exactly one POST fired for the flip');
  assert.equal(posts[0].url, '/api/settings');
  assert.deepEqual(posts[0].body, { autohandoff: { enabled: true, threshold: 90 } },
    'the POST carries the flipped enabled (off->on) and the current threshold');
  assert.equal(d.els['ah-toggle'].getAttribute('aria-checked'), 'true', 'the toggle repainted to the saved on, from the server echo');
  assert.equal(d.els['ah-threshold-row'].hidden, false, 'the threshold row shows once on');
});

test('#2054: a stale in-flight paint cannot repaint over a newer one (AH_EPOCH guard)', async () => {
  // The move's acceptance under tab churn: if an older paint's GET resolves after a
  // newer one has already painted, the stale response must be discarded. Discriminating
  // by construction -- without the epoch guard the late stale paint would land LAST and
  // win (on/90), so this test returns the dangerous answer if the guard is removed.
  const d = dom();
  const fetchResolvers = [];
  const fetchStub = () => new Promise((resolve) => { fetchResolvers.push(resolve); });
  const body = 'let AH_EPOCH=0;\n' + lift(SCRIPT, 'paintSwitch') + '\n' + lift(SCRIPT, 'paintAutomation') + '\nreturn paintAutomation;';
  const paintAutomation = new Function('document', 'fetch', body)(d.document, fetchStub);
  const p1 = paintAutomation(); // mine=1 (older/stale), fetch pending
  const p2 = paintAutomation(); // mine=2 (newer), fetch pending
  // The NEWER paint completes first -> off/80.
  fetchResolvers[1]({ ok: true, json: async () => ({ autohandoff: { enabled: false, threshold: 80 } }) });
  await p2;
  assert.equal(d.els['ah-toggle'].getAttribute('aria-checked'), 'false', 'sanity: the newer paint set the toggle off');
  // The STALE paint's GET resolves LATE and must be a no-op.
  fetchResolvers[0]({ ok: true, json: async () => ({ autohandoff: { enabled: true, threshold: 90 } }) });
  await p1;
  assert.equal(d.els['ah-toggle'].getAttribute('aria-checked'), 'false', 'the stale paint repainted over the newer one -- AH_EPOCH guard missing/ineffective');
  assert.equal(d.els['ah-threshold'].value, '80', 'the stale threshold (90) overwrote the newer 80');
});

test('#2054 ACCEPTANCE (executable): a threshold change BEFORE the setting loads writes nothing', async () => {
  // The interact-side of "a moved setting must not silently reset": if a change event
  // fires before the first read lands (toggle still hidden, no aria-checked), the
  // handler must refuse to save -- otherwise it writes a markup default over the stored
  // value. Executed, not regex-matched, so a logically-inverted guard FAILS here: an
  // inverted guard would fall through into saveAutohandoff and issue a POST.
  const d = dom(); // ah-toggle starts with no aria-checked (unloaded)
  const calls = [];
  const fetchStub = async (url, opts) => { calls.push({ method: (opts && opts.method) || 'GET' }); return { ok: true, json: async () => ({}) }; };
  const body = 'let AH_SAVING=false;\nlet AH_EPOCH=0;\n'
    + lift(SCRIPT, 'saveAutohandoff') + '\n'
    + lift(SCRIPT, 'ahThresholdChange') + '\nreturn ahThresholdChange;';
  const ahThresholdChange = new Function('document', 'fetch', body)(d.document, fetchStub);
  assert.equal(d.els['ah-toggle'].hasAttribute('aria-checked'), false, 'precondition: the toggle is unloaded');
  ahThresholdChange();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [], 'a pre-load threshold change issued a fetch (' + JSON.stringify(calls) + '); an inverted guard would write a default over the stored value');
});

test('#2054: a could-not-read read HIDES the knob (status control), never a false Off', async () => {
  // Hard failure: a thrown fetch.
  const d = dom();
  const body = 'let AH_EPOCH=0;\n' + lift(SCRIPT, 'paintSwitch') + '\n' + lift(SCRIPT, 'paintAutomation') + '\nreturn paintAutomation;';
  const paint = new Function('document', 'fetch', body)(d.document, async () => { throw new Error('down'); });
  await paint();
  assert.equal(d.els['ah-toggle'].hidden, true, 'a read failure hides the knob rather than showing a stale/false position');
  assert.equal(d.els['ah-toggle'].hasAttribute('aria-checked'), false, 'and strips aria-checked, so nothing reads it as Off');
  assert.equal(d.els['ah-threshold-row'].hidden, true, 'the threshold row is hidden too');
  assert.match(d.els['ah-msg'].textContent, /could not read/i, 'and it says the read failed');

  // 403 on an enforcing board: a NON-OK response is could-not-read, not a position.
  const gated = makePaint({ enabled: true, threshold: 90 }, false);
  await gated.paint();
  assert.equal(gated.els['ah-toggle'].hidden, true, 'a non-ok GET (403) hides the knob rather than painting a position from it');
  assert.equal(gated.els['ah-toggle'].hasAttribute('aria-checked'), false, 'a 403 draws no aria-checked');
});

test('kosmos#1724/#2054: the control is wired -- section, slider + threshold, painted on open, saved on interact', () => {
  assert.ok(PAGE.includes('id="s-sec-automation"'), 'the Automation section is in the page');
  assert.ok(PAGE.includes('data-go="automation"'), 'the Automation nav item is in the page');
  for (const id of ['ah-toggle', 'ah-threshold', 'ah-threshold-row', 'ah-msg']) {
    assert.ok(PAGE.includes('id="' + id + '"'), id + ' is present');
  }
  // No Save button any more: the slider commits on flip, like every other .toggle.
  assert.ok(!PAGE.includes('id="ah-save"'), 'the ah-save button should be gone (#2054: sliders commit on flip)');
  const paintSettings = lift(SCRIPT, 'paintSettings');
  assert.match(paintSettings, /paintAutomation\(\)/, 'paintSettings calls paintAutomation');
  // Save on interact: a toggle click and a threshold change both save.
  assert.match(SCRIPT, /getElementById\('ah-toggle'\)\.addEventListener\('click', ahToggleClick\)/, 'the toggle click is wired to ahToggleClick');
  assert.match(SCRIPT, /getElementById\('ah-threshold'\)\.addEventListener\('change', ahThresholdChange\)/, 'the threshold change is wired to ahThresholdChange');
  const save = lift(SCRIPT, 'saveAutohandoff');
  assert.match(save, /fetch\('\/api\/settings',[\s\S]*method: 'POST'/, 'a save POSTs to /api/settings');
  assert.match(save, /autohandoff:/, 'it sends the autohandoff setting');
  // The pre-load guards that stop a write from resetting a stored value.
  const change = lift(SCRIPT, 'ahThresholdChange');
  assert.match(change, /hasAttribute\('aria-checked'\)/, 'the threshold handler refuses to save before the setting has loaded');
});
