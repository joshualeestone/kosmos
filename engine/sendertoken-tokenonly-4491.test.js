'use strict';
/**
 * #4491: sendertoken.tokenOnlyFor, the pilot setting the supervisor reads at launch to put KOSMOS_AGENT_TOKEN_ONLY=1
 * into one agent's pane (tools/test-supervisor-env.sh drives that half). Exact names only, and anything unreadable
 * is off. Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-tokenonly-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const store = require('./store');
const st = require('./sendertoken');

const write = (text) => { fs.mkdirSync(path.dirname(st.tokenOnlyFile()), { recursive: true }); fs.writeFileSync(st.tokenOnlyFile(), text); };
test.beforeEach(() => { fs.rmSync(st.tokenOnlyFile(), { force: true }); });

test('the setting lives under the sandboxed store root', () => {
  assert.ok(st.tokenOnlyFile().startsWith(SANDBOX + path.sep));
  assert.equal(path.dirname(st.tokenOnlyFile()), store.ROOT);
});

test('a listed agent is on; an unlisted one is off', () => {
  write(JSON.stringify({ agents: ['Kip', 'mara'] }));
  assert.equal(st.tokenOnlyFor('Kip'), true);
  assert.equal(st.tokenOnlyFor('mara'), true);
  assert.equal(st.tokenOnlyFor('Ava'), false, 'CONTROL: an agent nobody listed');
});

test('matched exactly, never by safeKey: names that share a key are not each other', () => {
  write(JSON.stringify({ agents: ['Kip'] }));
  for (const other of ['kip', 'KIP', 'Kip ', ' Kip', 'Kip-discord', 'Kip+qa']) {
    assert.equal(st.tokenOnlyFor(other), false, JSON.stringify(other));
  }
});

test('no file, an unreadable or wrongly shaped one, or a bad name is off (today\'s behaviour)', () => {
  assert.equal(st.tokenOnlyFor('Kip'), false, 'no file');
  for (const text of ['', 'not json', 'null', '[]', '["Kip"]', '{"agents":"Kip"}', '{"agents":{"0":"Kip"}}', '{"agent":["Kip"]}']) {
    write(text);
    assert.equal(st.tokenOnlyFor('Kip'), false, text);
  }
  write(JSON.stringify({ agents: ['Kip'] }));
  for (const name of [undefined, null, '', 42, ['Kip']]) assert.equal(st.tokenOnlyFor(name), false, String(name));
});
