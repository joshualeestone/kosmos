'use strict';
/**
 * #6231 item 5 (follow-up to #6214): the Update / Roll back dialog and the Kosmos switch offer "Stop the move" when the
 * board refuses them with a 409 that says moveStoppable. #6214 pins that wiring by matching the page's source; these run
 * the SHIPPED code paths from web/index.html against a fake document and fetch, so the offer is proved by behaviour:
 * it appears for moveStoppable, and not without it.
 *
 *   node --test web.movestop-offers-6231.test.js
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

function el(id) {
  return { id, textContent: '', hidden: false, disabled: false, style: {}, dataset: {}, focus() {}, setAttribute() {}, removeAttribute() {} };
}

const answer = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

/* The Kosmos switch: worldswSwitch, as web.world-switch-agents-1704.test.js runs it. */
async function runSwitch(body) {
  const els = new Proxy({}, { get: (t, id) => (t[id] = t[id] || el(id)) });
  const offers = [];
  const order = [];
  const platformLayer = require('./test-support/page').PLATFORM_COPY_FNS.map(slice).join('\n');
  const src = `let WORLDSW_SWITCHING = false;
${platformLayer}
${slice('worldswNotPausedNote')}
${slice('worldswSwitch')}
return worldswSwitch('w2', 'Side Project', 'keep');`;
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', 'worldsFetch', 'worldswFocusTrigger', 'worldswReconnect', 'clearStopMoveOffers', 'offerStopMove', src)(
    { getElementById: (id) => els[id], querySelectorAll: () => [] }, async () => { order.push('fetch'); return answer(409, body)(); },
    async () => {}, () => {}, async () => {},
    () => order.push('clear'), (after, say) => offers.push([after.id, say.id]),
  );
  return { offers, order, msg: els['worldsw-restart-msg'].textContent };
}

test('#6231: a switch the board refuses while a move is running offers to stop the move, under the switch\'s own line', async () => {
  const r = await runSwitch({ because: 'An account move is running.', moveStoppable: true });
  assert.deepEqual(r.offers, [['worldsw-restart-msg', 'worldsw-restart-msg']]);
  assert.match(r.msg, /An account move is running\./, 'the refusal is said where the offer is put');
  assert.deepEqual(r.order.slice(0, 2), ['clear', 'fetch'], 'a fresh switch does not take an earlier offer away before asking');
});

test('#6231 CONTROL: a 409 for anything else offers no stop', async () => {
  assert.deepEqual((await runSwitch({ because: 'Another Kosmos operation is in progress.' })).offers, []);
  assert.deepEqual((await runSwitch({ because: 'x', moveStoppable: false })).offers, []);
});

/* The Update / Roll back dialog: its uc-go click listener, lifted whole and clicked. */
const UC_AT = PAGE.indexOf("document.getElementById('uc-go').addEventListener('click', async () => {");
assert.ok(UC_AT >= 0, 'the Update dialog\'s uc-go listener moved or was renamed; re-anchor this test');
const UC = PAGE.slice(UC_AT, PAGE.indexOf('\n});\n', UC_AT) + 5);

async function runUpdate(mode, status, body) {
  const els = new Proxy({}, { get: (t, id) => (t[id] = t[id] || el(id)) });
  let click = null;
  els['uc-go'].addEventListener = (type, fn) => { if (type === 'click') click = fn; };
  const offers = [];
  const posted = [];
  const order = [];
  const fetch = async (url) => { posted.push(url); order.push('fetch'); return answer(status, body)(); };
  // eslint-disable-next-line no-new-func
  /* #7207: the press reads its dialog generation and the version and boot it was pressed on before its POST. */
  new Function('document', 'fetch', 'window', 'UPD_CONFIRM_MODE', 'SERVED_VERSION', 'clearStopMoveOffers', 'offerStopMove',
    'UPD_WAIT_GEN', 'LAST_VERSION', 'LAST_BOOTED_AT', UC)(
    { getElementById: (id) => els[id], activeElement: null }, fetch, { location: { reload() {} } }, mode, '0.7.50',
    () => order.push('clear'), (after, say) => offers.push([after.id, say.id]), 0, '0.7.50', 'boot-A',
  );
  assert.ok(click, 'the Update dialog\'s button listener was not lifted');
  await click();
  return { offers, posted, order, err: els['uc-err'] };
}

test('#6231: Update and Roll back refused while a move is running offer to stop the move, under the dialog\'s error line', async () => {
  const refused = { error: 'an account move is running; stop it or wait for it to finish', moveStoppable: true };
  for (const [mode, url] of [['update', '/api/update'], ['rollback', '/api/update/rollback']]) {
    const r = await runUpdate(mode, 409, refused);
    assert.deepEqual(r.posted, [url], `${mode}: the press did not reach its route`);
    assert.deepEqual(r.offers, [['uc-err', 'uc-err']], `${mode}: no stop offered`);
    assert.equal(r.err.hidden, false); assert.equal(r.err.textContent, refused.error);
    assert.deepEqual(r.order, ['clear', 'fetch'], `${mode}: a fresh press does not take an earlier offer away before asking`);
  }
});

test('#6231 CONTROL: Update refused for another reason, or not refused, offers no stop', async () => {
  assert.deepEqual((await runUpdate('update', 409, { error: 'an update is already running' })).offers, []);
  assert.deepEqual((await runUpdate('update', 500, { error: 'x', moveStoppable: true })).offers, [], 'only a 409 offers it');
  assert.deepEqual((await runUpdate('update', 409, { error: 'there is no update to install right now', moveStoppable: true })).offers, [],
    'the already-current answer turns the button into Reload instead');
});
