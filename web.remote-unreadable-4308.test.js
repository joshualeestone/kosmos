'use strict';

/**
 * #4308 (Liu Kang's ruling): an unreadable remote-access settings file must not look like a Mac the person
 * switched off, and the person must be told what repairs it. The sentence has ONE source, the engine's status()
 * (engine/remote.js); the page shows it as it is. So this runs end to end: a real damaged remote.json in a sandbox,
 * the real status() it produces, and paintPlus run for real against a fake document (the web.plus-tab.test.js
 * harness) with that answer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-web-4308-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_TUNNEL_BIN = path.join(SANDBOX, 'no-tunnel-here');   // nothing may start a real one
const remote = require('./engine/remote');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SHOWN = 'Your remote-access settings could not be read. Turn remote access on again to repair them.';

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

/* What GET /api/remote answers (server.js), for an enrolled Mac, built from the engine's own read() and status(). */
function apiAnswer() {
  const r = remote.read();
  return { status: remote.status(), on: r.on === true, ok: r.ok !== false, configured: true, email: '', enrolled: true };
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

test('#4308: a damaged settings file on an enrolled Mac says so on the page, and says how to repair it', async () => {
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, '{"on": true, "relay": "rel');   // cut short
  const answer = apiAnswer();
  assert.equal(answer.ok, false, 'fixture: the file is not unreadable');
  const els = await paintWith(answer);
  assert.equal(els['plus-flow'].hidden, false, 'the connected pane is not showing, so the sentence has nowhere to be');
  assert.equal(els['plus-switch'].attrs['aria-checked'], 'false');
  assert.equal(els['plus-status'].textContent, SHOWN);
});

test('#4308 control: a readable file that is simply off says nothing about repairing', async () => {
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: false }) + '\n');
  const answer = apiAnswer();
  assert.equal(answer.ok, true);
  const els = await paintWith(answer);
  assert.doesNotMatch(els['plus-status'].textContent, /could not be read|repair/);
});

test('#4308: the sentence has no em dash', () => {
  assert.doesNotMatch(SHOWN, /—/);
});
