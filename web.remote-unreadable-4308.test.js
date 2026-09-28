'use strict';

/**
 * #4308 (Liu Kang's ruling): an unreadable remote-access settings file must not look like a Mac the person
 * switched off. /api/remote already reports it as `ok: false`; the page now says so, and says what repairs it.
 * Behavioural: paintPlus runs for real against a fake document, the same harness web.plus-tab.test.js uses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const MESSAGE = 'Remote access settings could not be read. Turn remote access on again to repair them.';

function pageFnSource(name) {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  let start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  if (script.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let stop = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { stop = k + 1; break; } }
  }
  assert.ok(stop > start, name + ' has no closing brace');
  return script.slice(start, stop);
}

async function paintWith(answer) {
  const els = {
    'plus-state1': { hidden: false },
    'plus-state2': { hidden: true },
    'plus-flow': { hidden: true },
    'plus-switch': { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, hidden: true },
    'plus-status': { textContent: '' },
    'plus-enrol': { hidden: false },
    'plus-devices': { hidden: false },
  };
  const paintPlus = new Function('document', 'fetch', 'plusWords', 'paintDevices', 'plusSecondDisarm',
    'let PLUS_EPOCH = 0;\n' + pageFnSource('paintPlus') + '\nreturn paintPlus;')(
    { getElementById: (id) => els[id] }, async () => ({ json: async () => answer }), (t) => t, () => {}, () => {});
  await paintPlus();
  return els;
}

test('#4308: an enrolled Mac whose settings file cannot be read says so, and says how to repair it', async () => {
  const els = await paintWith({ configured: true, enrolled: true, on: false, ok: false, status: { state: 'off', because: 'off' } });
  assert.equal(els['plus-flow'].hidden, false, 'the connected pane is not showing, so the message has nowhere to be');
  assert.equal(els['plus-status'].textContent, MESSAGE);
});

test('#4308 control: a readable file that is simply off shows no repair message', async () => {
  const els = await paintWith({ configured: true, enrolled: true, on: false, ok: true, status: { state: 'off', because: '' } });
  assert.notEqual(els['plus-status'].textContent, MESSAGE);
  assert.doesNotMatch(els['plus-status'].textContent, /could not be read/);
});

test('#4308: the page message is the ruled wording, with no em dash', () => {
  assert.ok(PAGE.includes("st.textContent = '" + MESSAGE + "'"), 'the repair line moved or its wording changed');
  assert.doesNotMatch(MESSAGE, /—/);
});
