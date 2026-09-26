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

/* The page's function source by name, brace-matched (the same slicer the sibling web tests use). */
function pageFnSource(name) {
  const start = RAW.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from web/index.html');
  let depth = 0;
  for (let k = RAW.indexOf('{', start); k < RAW.length; k += 1) {
    if (RAW[k] === '{') depth += 1;
    else if (RAW[k] === '}') { depth -= 1; if (depth === 0) return RAW.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* The REAL paintDetailState and workingSampleIsStale, with the label/glyph derivations stubbed to
   echo the state they were handed, so the test reads which state the pill was painted from. */
function pillFor(card, spokeLearnedAt, lastAt) {
  const els = {};
  const doc = { getElementById: (id) => (els[id] = els[id] || { className: '', innerHTML: '', textContent: '', hidden: false, dataset: {} }) };
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'DM_SPOKE_AT', 'LAST_AT', [
    'const esc = (s) => String(s);',
    'const stateCopyOf = (a) => ({ label: a.state });',
    'const cardStOf = (a) => ({ st: a.state });',
    'const glyphOf = () => "";',
    'const taskLine = () => "";',
    pageFnSource('workingSampleIsStale'),
    pageFnSource('paintDetailState'),
    'return paintDetailState;',
  ].join('\n'))(doc, new Map(spokeLearnedAt === null ? [] : [[card.sessionName, { at: 1, learnedAt: spokeLearnedAt }]]), lastAt);
  run(card);
  return els['d-state'].className;
}

test('#3958: a working sample older than the reply on screen paints the pill idle, as the DM line hides', () => {
  const card = { sessionName: 'beatrix', state: 'working' };
  assert.match(pillFor(card, 2000, 1000), /\bst-idle\b/, 'the reply was learned after the sample: stale');
  assert.match(pillFor(card, 500, 1000), /\bst-working\b/, 'control: the sample is newer than the reply, so it stands');
  assert.match(pillFor(card, null, 1000), /\bst-working\b/, 'control: no reply known, the sample stands');
  assert.match(pillFor({ sessionName: 'beatrix', state: 'needs_you' }, 2000, 1000), /\bst-needs_you\b/, 'only a WORKING sample is ever downgraded');
});
