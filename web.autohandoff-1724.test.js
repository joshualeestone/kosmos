'use strict';

/**
 * kosmos#1724: the Settings > Automation auto-handoff control (the capture half,
 * in the page). The real paintAutomation is lifted and run against a stub: it
 * must load a saved setting into the checkbox and threshold, default to off/85
 * when nothing is saved, and enable the controls. The trigger (the consume half)
 * is tested in engine/autohandoff.test.js; the route in server.test.js.
 *
 *   node --test web.autohandoff-1724.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

function dom() {
  const els = {
    'ah-enabled': { checked: false, disabled: true },
    'ah-threshold': { value: '', disabled: true },
    'ah-save': { disabled: true },
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

/** paintAutomation, the REAL one, wired to a stub fetch returning `saved`. */
function makePaint(saved) {
  const d = dom();
  const fetchStub = async () => ({ json: async () => ({ autohandoff: saved }) });
  const paint = new Function('document', 'fetch',
    lift(SCRIPT, 'paintAutomation') + '\nreturn paintAutomation;')(d.document, fetchStub);
  return { paint, ...d };
}

test('kosmos#1724: a saved setting LOADS into the controls, which are live once the sweep exists', async () => {
  const { paint, els } = makePaint({ enabled: true, threshold: 90 });
  await paint();
  assert.equal(els['ah-enabled'].checked, true, 'enabled reflects the saved value');
  assert.equal(els['ah-threshold'].value, '90', 'threshold reflects the saved value');
  // The sweep (engine/autohandoff-sweep.js, wired in server.js) now acts on the setting,
  // so the control is live: enabled and honoured. It shipped not-yet-active only while the
  // sweep was missing; that note would be a false statement now, so it is gone.
  assert.equal(els['ah-enabled'].disabled, false, 'live: the toggle is enabled');
  assert.equal(els['ah-save'].disabled, false, 'live: Save is enabled');
  assert.equal(els['ah-msg'].textContent, '', 'no not-yet-active note once the sweep is live');
});

test('kosmos#1724: defaults to off and 85% when nothing is saved', async () => {
  const { paint, els } = makePaint(undefined);
  await paint();
  assert.equal(els['ah-enabled'].checked, false, 'off by default');
  assert.equal(els['ah-threshold'].value, '85', 'threshold defaults to 85');
});

test('kosmos#1724: the control is wired -- section, controls, painted on open, saved to the route', () => {
  assert.ok(PAGE.includes('id="s-sec-automation"'), 'the Automation section is in the page');
  assert.ok(PAGE.includes('data-go="automation"'), 'the Automation nav item is in the page');
  for (const id of ['ah-enabled', 'ah-threshold', 'ah-save', 'ah-msg']) {
    assert.ok(PAGE.includes('id="' + id + '"'), id + ' is present');
  }
  const paintSettings = lift(SCRIPT, 'paintSettings');
  assert.match(paintSettings, /paintAutomation\(\)/, 'paintSettings calls paintAutomation');
  const saveAt = SCRIPT.indexOf("getElementById('ah-save').addEventListener");
  assert.ok(saveAt > -1, 'the ah-save click handler exists');
  const handler = SCRIPT.slice(saveAt, saveAt + 800);
  assert.match(handler, /fetch\('\/api\/settings',[\s\S]*method: 'POST'/, 'Save POSTs to /api/settings');
  assert.match(handler, /autohandoff:/, 'it sends the autohandoff setting');
});
