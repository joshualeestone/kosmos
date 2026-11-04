'use strict';

/**
 * kosmos#7938: a board whose newer version comes only as a manual offer (`updateManual`: Windows in a folder the in-app
 * updater refuses, and Linux once its in-app path is off) showed no notice outside Settings, Updates. It now shows the
 * same "An update is available" chip, saying where to install it, with no button: nothing in the toast installs. On a
 * Kosmos+ view it names the Kosmos computer. The install offer, when there is one, keeps its own chip and button.
 *
 *   node --test web.manualtoast-7938.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* The real renderUpdateToast, lifted from the page, with the page served at its own version (not stale). */
function toast({ offer = null, manual = null, later = null, remote = false, updating = false, slot = { dataset: {}, innerHTML: '' } } = {}) {
  const buttons = [];
  const doc = {
    getElementById: (id) => (id === 'utoast-slot' ? slot : { addEventListener: () => buttons.push(id), focus() {}, hidden: true }),
    querySelector: () => ({ getAttribute: () => '0.7.88' }),
  };
  new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterSuppresses', 'UPD_CONFIRM_OPENER', 'OFFER', 'ENGINE_STALE', 'offlineRemoteView', 'MANUAL',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'updateNothingToLose', 'updateSafeReload', 'renderUpdateToast'])
    + '\nrenderUpdateToast(OFFER, MANUAL);')(doc, (x) => String(x), updating, '0.7.88', (v) => later === v, null, offer, null, () => remote, manual);
  return { html: slot.innerHTML, v: slot.dataset.v, buttons, slot };
}

const MANUAL = { version: '0.7.89', download: 'https://example.invalid/kosmos-0.7.89-win-x64.zip' };

test('#7938: a manual offer with no install offer shows the chip, says where to install it, and has no button', () => {
  const t = toast({ manual: MANUAL });
  assert.match(t.html, /An update is available: Settings, Updates shows how to install it/);
  assert.doesNotMatch(t.html, /<button/, 'the manual chip offers a button');
  assert.deepEqual(t.buttons, [], 'a listener was wired');
  assert.equal(t.v, 'manual:0.7.89');
});

test('#7938: CONTROL: no manual offer and no install offer shows nothing (as before)', () => {
  assert.equal(toast({}).html, '');
});

test('#7938: on a Kosmos+ view the chip names the Kosmos computer', () => {
  const t = toast({ manual: MANUAL, remote: true });
  assert.match(t.html, /install it on your Kosmos computer, in Settings, Updates/);
  assert.doesNotMatch(t.html, /<button/);
  assert.equal(t.v, 'manual:0.7.89:remote');
});

test('#7938: an install offer keeps its own chip and Update button, whatever the manual offer says', () => {
  const t = toast({ offer: { version: '0.7.89' }, manual: MANUAL });
  assert.match(t.html, /An update is available<\/span>/);
  assert.match(t.html, /id="ut-install"/, 'the install offer lost its button');
  assert.doesNotMatch(t.html, /Settings, Updates/);
});

test('#7938: Later on that version quiets the manual chip too; an update under way shows nothing', () => {
  assert.equal(toast({ manual: MANUAL, later: '0.7.89' }).html, '');
  assert.equal(toast({ manual: MANUAL, updating: true }).html, '');
  assert.notEqual(toast({ manual: MANUAL, later: '0.7.88' }).html, '', 'CONTROL: Later on another version does not quiet it');
});

test('#7938: the chip is drawn once per version and place, and goes when the manual offer goes', () => {
  const slot = { dataset: {}, innerHTML: '' };
  toast({ manual: MANUAL, slot });
  slot.innerHTML += '<!--kept-->';
  toast({ manual: MANUAL, slot });
  assert.match(slot.innerHTML, /<!--kept-->/, 'redrawn for the same version');
  toast({ manual: { ...MANUAL, version: '0.7.90' }, slot });
  assert.doesNotMatch(slot.innerHTML, /<!--kept-->/, 'not redrawn for a newer version');
  toast({ slot });
  assert.equal(slot.innerHTML, '', 'still shown with no offer left');
});

test('#7938: both callers pass the manual offer to the toast', () => {
  assert.ok(SCRIPT.includes('renderUpdateToast(data.update, data.updateManual);'), 'the status read');
  assert.ok(SCRIPT.includes('renderUpdateToast(out.offer, out.manual);'), 'the update check');
});
