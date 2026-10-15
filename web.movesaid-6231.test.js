'use strict';
/**
 * #6231 item 11 (follow-up to #6214): each refused Restart Kosmos press starts a hold before the toast is repainted.
 * A fresh press now owns that hold, so an earlier press's hold cannot repaint the toast in the middle of the later
 * answer. Runs the SHIPPED engineRestartClick from web/index.html against a fake document, fetch and timer queue.
 *
 *   node --test web.movesaid-6231.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
const HOLD = PAGE.match(/^const ENGINE_SAID_HOLD_MS = [^\n]+$/m);
assert.ok(HOLD, 'ENGINE_SAID_HOLD_MS moved; re-anchor this test');
const PRESS = PAGE.match(/^let ENGINE_SAID_PRESS = 0;[^\n]*$/m);   // the page's own declaration, not one made up here
assert.ok(PRESS, 'ENGINE_SAID_PRESS is not declared at the top level of the page');

function harness() {
  const timers = [];
  const slot = { dataset: { v: 'painted' }, querySelector: () => null };
  const small = { textContent: '' };
  const title = { textContent: '' };
  const toast = { querySelector: (sel) => (sel === 'small' ? small : sel === 'b' ? title : null) };
  const btn = { disabled: false, textContent: 'Restart Kosmos', closest: () => toast };
  const document = { getElementById: (id) => (id === 'ut-engine-restart' ? btn : id === 'utoast-slot' ? slot : null) };
  // Every press is refused for a reason that is not a move (a plain 409), so each one holds the toast.
  const fetch = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, because: 'busy' }) });
  const src = `${HOLD[0].replace(/^const /, 'var ')}
${PRESS[0]}
let ENGINE_RESTARTING = false; const ENGINE_STALE = null;
${slice('engineRestartClick')}
return engineRestartClick;`;
  // eslint-disable-next-line no-new-func
  const click = new Function('document', 'fetch', 'setTimeout', 'clearStopMoveOffers', 'offerStopMove', 'getComputedStyle', 'location', 'console', src)(
    document, fetch, (fn) => { timers.push(fn); return timers.length; }, () => {}, () => {}, () => ({ display: 'block' }),
    { reload() {} }, { info() {} },
  );
  return { click, timers, slot };
}

test('#6231 item 11: an earlier refused press\'s hold does not repaint the toast during a later press\'s answer', async () => {
  const h = harness();
  await h.click();
  await h.click();
  assert.equal(h.timers.length, 2, 'each refused press did not start its hold');
  h.timers[0]();   // the FIRST press's hold comes due while the second answer is on screen
  assert.equal(h.slot.dataset.v, 'painted', 'the first press repainted the toast in the middle of the second answer');
  h.timers[1]();   // the second press's own hold still repaints when it is due
  assert.equal(h.slot.dataset.v, undefined, 'the latest press never repainted the toast');
});

test('#6231 item 11 CONTROL: a single press still repaints the toast when its hold is due', async () => {
  const h = harness();
  await h.click();
  h.timers[0]();
  assert.equal(h.slot.dataset.v, undefined);
});
