'use strict';

/**
 * #3492: the "Write a handoff, then restart" option on the restart confirm
 * dialog. This covers the PAGE side:
 *  - the third button exists in the modal and openRestartModal manages it;
 *  - the handler wires the three primitives (ask -> poll status -> restart ->
 *    pickup) and never restarts on a maybe;
 *  - the DRY generalization holds: sendWakeHello reports success only on a
 *    PLACED delivery through an injected deliver fn, and deliverPickup returns
 *    the verdict object.
 *
 * The engine prompts/freshness are in engine/handoff-restart.test.js; the routes
 * in server.handoff-restart-3492.test.js.
 *
 *   node --test web.handoff-restart-3492.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

test('the third button is in the restart modal actions', () => {
  // The button lives in rm-acts alongside rst-keep / rst-go.
  const acts = PAGE.slice(PAGE.indexOf('id="rst-modal"'));
  const actsBlock = acts.slice(0, acts.indexOf('</div>', acts.indexOf('rm-acts')) + 6);
  assert.match(actsBlock, /id="rst-handoff-go"/, 'the third button exists');
  assert.match(actsBlock, /id="rst-keep"/);
  assert.match(actsBlock, /id="rst-go"/);
  // A clear working label naming both halves of the action.
  assert.match(actsBlock, /Write a handoff, then restart/);
});

test('openRestartModal resets the third button every open', () => {
  const src = page.lift(SCRIPT, 'openRestartModal');
  assert.match(src, /rst-handoff-go/, 'openRestartModal touches the third button');
  // It must un-hide AND re-enable it, or a prior run that disabled it leaves it dead.
  assert.match(src, /hgo\.hidden = false/);
  assert.match(src, /hgo\.disabled = false/);
});

test('the handler wires all three primitives and does NOT restart on a maybe', () => {
  const h = SCRIPT.slice(SCRIPT.indexOf("getElementById('rst-handoff-go').addEventListener"));
  const body = h.slice(0, h.indexOf('#5 insurance')); // up to the next handler's banner
  assert.match(body, /handoff-restart\/ask/, 'phase 1: ask');
  assert.match(body, /handoff-restart\/status\?baseline=/, 'phase 2: poll status with a baseline');
  assert.match(body, /\/restart'/, 'phase 3: restart');
  assert.match(body, /deliverPickup\(name\)/, 'phase 4: pickup via deliverPickup');
  // 🛑 the two gates that keep a restart off a maybe: a PLACED ask and a fresh handoff.
  assert.match(body, /delivery\.state === 'placed'/, 'proceeds only on a PLACED ask');
  assert.match(body, /st\.fresh === true/, 'proceeds only on a confirmed-fresh handoff');
  // On the not-confirmed paths it restores the confirm view rather than restarting.
  assert.match(body, /has not finished its handoff yet/, 'timeout falls back to the person, not a restart');
});

test('the handoff-wait constants are overridable (test seam) and sane', () => {
  assert.match(SCRIPT, /let HANDOFF_WAIT_MS = \d+/);
  assert.match(SCRIPT, /let HANDOFF_POLL_MS = \d+/);
});

test('the plain rst-go handler also hides AND disables the third button', () => {
  // Without this, a plain Restart plays its interstitial with rst-handoff-go left
  // live behind it, and a click there launches the handoff flow concurrently.
  const h = SCRIPT.slice(SCRIPT.indexOf("getElementById('rst-go').addEventListener"));
  const body = h.slice(0, h.indexOf('\n});'));
  assert.match(body, /const hgo = document\.getElementById\('rst-handoff-go'\)/, 'rst-go references the third button');
  assert.match(body, /hgo\.hidden = !on/, 'rst-go showConfirm hides the third button with the rest');
  assert.match(body, /hgo\.disabled = true/, 'rst-go disables the third button on entry');
  assert.match(body, /hgo\.disabled = false/, 'rst-go re-enables it in restoreConfirm/success');
});

test('the handoff flow is abortable during the wait: keep live, RST_BUSY deferred to the restart', () => {
  const h = SCRIPT.slice(SCRIPT.indexOf("getElementById('rst-handoff-go').addEventListener"));
  const body = h.slice(0, h.indexOf('#5 insurance'));
  // A dismissed() guard exists and is checked in the loop.
  assert.match(body, /const dismissed = \(\) =>/, 'a dismissed() guard is defined');
  assert.match(body, /if \(dismissed\(\)\) return;/, 'the loop bails on dismissal');
  // keep stays visible at entry (not hidden with the rest), and RST_BUSY is set only at the restart.
  assert.match(body, /keep\.hidden = false;/, 'Leave-it-running stays visible during the wait');
  // The commit point: RST_BUSY becomes true and keep is hidden together, at phase 3.
  const commit = body.indexOf('RST_BUSY = true;');
  assert.ok(commit > -1, 'RST_BUSY is set at the restart commit');
  assert.match(body.slice(commit, commit + 120), /keep\.hidden = true;/, 'keep is hidden at the same commit point');
});

// --- behavioral: the DRY generalization ---

function liftFn(name, deps) {
  const argNames = Object.keys(deps);
  const args = argNames.map((k) => deps[k]);
  // eslint-disable-next-line no-new-func
  return new Function(...argNames, page.lift(SCRIPT, name) + '\nreturn ' + name + ';')(...args);
}

test('sendWakeHello reports success ONLY on a PLACED delivery, through an injected deliver', async () => {
  const seq = { bob: 7 };
  const sendWakeHello = liftFn('sendWakeHello', { fetch: async () => { throw new Error('fetch should not be called on the deliver path'); }, RESTART_HELLO_SEQ: seq });

  let said = null;
  await sendWakeHello('bob', 7, (t) => { said = t; }, 'SAID', 'MANUAL', async () => ({ state: 'placed' }));
  assert.equal(said, 'SAID', 'placed -> the success line');

  said = null;
  await sendWakeHello('bob', 7, (t) => { said = t; }, 'SAID', 'MANUAL', async () => ({ state: 'unconfirmed' }));
  assert.equal(said, 'MANUAL', 'unconfirmed -> the manual line (never a false success)');

  said = null;
  await sendWakeHello('bob', 7, (t) => { said = t; }, 'SAID', 'MANUAL', async () => null);
  assert.equal(said, 'MANUAL', 'no verdict -> the manual line');
});

test('sendWakeHello with a deliver that throws still reports the manual line', async () => {
  const seq = { bob: 1 };
  const sendWakeHello = liftFn('sendWakeHello', { fetch: async () => { throw new Error('unused'); }, RESTART_HELLO_SEQ: seq });
  let said = null;
  await sendWakeHello('bob', 1, (t) => { said = t; }, 'SAID', 'MANUAL', async () => { throw new Error('deliver blew up'); });
  assert.equal(said, 'MANUAL');
});

test('sendWakeHello does nothing once a newer restart supersedes its token', async () => {
  const seq = { bob: 9 };  // current token is 9
  const sendWakeHello = liftFn('sendWakeHello', { fetch: async () => { throw new Error('unused'); }, RESTART_HELLO_SEQ: seq });
  let said = 'untouched';
  await sendWakeHello('bob', 8, (t) => { said = t; }, 'SAID', 'MANUAL', async () => ({ state: 'placed' }));
  assert.equal(said, 'untouched', 'a stale token reports nothing');
});

test('deliverPickup returns the delivery verdict on ok, null otherwise', async () => {
  let calledPath = null;
  const okFetch = async (p) => { calledPath = p; return { ok: true, json: async () => ({ delivery: { state: 'placed' } }) }; };
  const deliverPickup = liftFn('deliverPickup', { fetch: okFetch });
  const v = await deliverPickup('carol');
  assert.deepEqual(v, { state: 'placed' });
  assert.match(calledPath, /\/api\/agent\/carol\/handoff-restart\/pickup$/, 'posts to the pickup route');

  const badFetch = async () => ({ ok: false, json: async () => ({ error: 'nope' }) });
  const deliverPickup2 = liftFn('deliverPickup', { fetch: badFetch });
  assert.equal(await deliverPickup2('carol'), null, 'a non-ok response yields null (no false success)');
});

test('the new user-facing strings carry no em dash (house style)', () => {
  const h = SCRIPT.slice(SCRIPT.indexOf("getElementById('rst-handoff-go').addEventListener"));
  const body = h.slice(0, h.indexOf('#5 insurance'));
  assert.doesNotMatch(body, /—/, 'no em dash in the handler strings');
  // and the button label in the markup
  const acts = PAGE.slice(PAGE.indexOf('id="rst-modal"'), PAGE.indexOf('id="chg-modal"'));
  assert.doesNotMatch(acts, /—/, 'no em dash in the modal markup');
});
