'use strict';

/**
 * #3958: once the agent page's pill follows the poll, the "when last seen" marker beside it must
 * read the LATEST card too. It used to read CURRENT (the card from when the page opened), which
 * agreed with a pill frozen at that moment; with a live pill it would past-mark a restart that
 * began after the page opened ("Restarting agent · when last seen", the inversion #2019 forbids).
 *
 * A SOURCE pin, and said so: the behavioural path needs a restarting agent whose presence reads
 * off, which no fixture here produces. The pill's own behaviour is measured in a browser by
 * docs/browser-checks/render-agent-pill-3958.js.
 *
 *   node --test web.pill-remembered-3958.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('#3958: the remembered marker reads the latest card from LAST, not CURRENT alone', () => {
  const calls = RAW.match(/markStateRemembered\(!\([^;]*\);/g) || [];
  assert.equal(calls.length, 1, 'expected the one restarting-aware call site; found ' + calls.length);
  assert.match(calls[0], /latest && latest\.state === 'restarting'/);
  assert.match(RAW, /const latest = CURRENT && \(LAST\.find\(\(x\) => x\.sessionName === CURRENT\.sessionName\) \|\| CURRENT\);/);
  assert.doesNotMatch(RAW, /markStateRemembered\(!\(CURRENT && CURRENT\.state === 'restarting'\)\)/, 'the frozen read is the bug');
});

test('#3958: the poll paints the pill off the same fresh card as the DM line', () => {
  assert.match(RAW, /paintBusy\(fresh, CURRENT\.name\);\n\s*\/\* #3958: the pill follows the poll too/);
  assert.match(RAW, /if \(fresh\) paintDetailState\(fresh\);/);
});
