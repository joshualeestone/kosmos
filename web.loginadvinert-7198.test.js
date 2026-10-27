'use strict';
/**
 * kosmos#7198 review 7: loginAdvInert gives back only what it made inert. While the Sign in again dialog is open the
 * login notices are out of reach; closing it must not un-inert a notice slot something else had already made inert
 * (the first-run screen does), and must give back one it inerted itself.
 *
 *   node --test web.loginadvinert-7198.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function load(slot) {
  const document = { getElementById: (id) => (id === 'login-adv-slot' ? slot : null) };
  // The page keeps ACCT_ADD_INERTED_ADV beside the function; it is declared here the same way.
  return new Function('document', 'let ACCT_ADD_INERTED_ADV = false;\n' + lift(SCRIPT, 'loginAdvInert') + '\nreturn loginAdvInert;')(document);
}

test('#7198: a slot the dialog made inert is given back on close', () => {
  const slot = { inert: false };
  const inert = load(slot);
  inert(true);
  assert.equal(slot.inert, true, 'opening the dialog left Refresh login reachable');
  inert(false);
  assert.equal(slot.inert, false, 'closing the dialog kept the notices out of reach');
});

test('#7198: a slot already inert (the first-run screen) stays inert when the dialog closes', () => {
  const slot = { inert: true };
  const inert = load(slot);
  inert(true);
  inert(false);
  assert.equal(slot.inert, true, 'closing the dialog gave back what something else had made inert');
});

test('#7198: no slot on the page is not an error', () => {
  const inert = load(null);
  assert.doesNotThrow(() => { inert(true); inert(false); });
});
