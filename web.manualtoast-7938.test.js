'use strict';

/**
 * kosmos#7938: a board whose newer version comes only as a manual offer (`updateManual`: Windows in a folder the in-app
 * updater refuses, and Linux once its in-app path is off) showed no notice outside Settings, Updates. It now shows the
 * chip, saying where to install it, with no button: nothing in the toast installs. Over Kosmos+ it names the Kosmos
 * computer. The install offer, when there is one, keeps its own chip and button.
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
  /* The real kplusRemote too, against the page's address (review 1: the remote arm must be reachable on a Windows board). */
  const location = { hostname: remote ? 'kosmos.example-kplus.invalid' : '127.0.0.1' };
  new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterSuppresses', 'UPD_CONFIRM_OPENER', 'OFFER', 'ENGINE_STALE', 'location', 'MANUAL',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'updateNothingToLose', 'updateSafeReload', 'kplusRemote', 'renderUpdateToast'])
    + '\nrenderUpdateToast(OFFER, MANUAL);')(doc, (x) => String(x), updating, '0.7.88', (v) => later === v, null, offer, null, location, manual);
  return { html: slot.innerHTML, v: slot.dataset.v, buttons, slot };
}

const MANUAL = { version: '0.7.89', download: 'https://example.invalid/kosmos-0.7.89-win-x64.zip' };

test('#7938: a manual offer with no install offer shows the chip, says where to install it, and has no button', () => {
  const t = toast({ manual: MANUAL });
  assert.match(t.html, /<span class="uchip-t">An update is available in Settings, Updates<\/span>/);
  assert.match(t.html, /class="uchip noact"/, 'the no-button chip lost its even padding class');
  assert.doesNotMatch(t.html, /<button/, 'the manual chip offers a button');
  assert.deepEqual(t.buttons, [], 'a listener was wired');
  assert.equal(t.v, 'manual:0.7.89');
});

test('#7938: CONTROL: no manual offer and no install offer shows nothing (as before)', () => {
  assert.equal(toast({}).html, '');
});

test('#7938: on a Kosmos+ view the chip names the Kosmos computer', () => {
  const t = toast({ manual: MANUAL, remote: true });
  assert.match(t.html, /Install the update on your Kosmos computer/);
  assert.doesNotMatch(t.html, /<button/);
  assert.equal(t.v, 'manual:0.7.89:remote');
});

test('#7938: an install offer keeps its own chip and Update button, whatever the manual offer says', () => {
  const t = toast({ offer: { version: '0.7.89' }, manual: MANUAL });
  assert.match(t.html, /An update is available<\/span>/);
  assert.match(t.html, /id="ut-install"/, 'the install offer lost its button');
  assert.doesNotMatch(t.html, /in Settings|Kosmos computer/);
});

test('#7938: a Later already stored for that version (from an earlier install offer) quiets the manual chip; an update under way shows nothing', () => {
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

test('#7938: a Linux manual offer, which carries a command and no download (#7935), shows the chip too', () => {
  const t = toast({ manual: { version: '0.7.89', command: 'curl -fsSL https://example.invalid/install.sh | bash' } });
  assert.match(t.html, /<span class="uchip-t">An update is available in Settings, Updates<\/span>/);
  assert.doesNotMatch(t.html, /curl|example\.invalid/, 'the command itself stays on the Settings card');
});

test('#7938 review 1: a manual offer with neither a download nor a command shows nothing (the card has no manual arm for it)', () => {
  assert.equal(toast({ manual: { version: '0.7.89' } }).html, '');
});

test('#7938 review 1: the chip text stays short enough for the pill (the stack is 460px at most, the chip does not wrap)', () => {
  for (const remote of [false, true]) {
    const m = toast({ manual: MANUAL, remote }).html.match(/<span class="uchip-t">([^<]*)<\/span>/);
    assert.ok(m, 'no chip text');
    assert.ok(m[1].length <= 45, 'chip text too long for the pill: ' + m[1].length + ' chars: ' + m[1]);
  }
});

test('#7938 review 2: the toast and the Settings card ask the same rule for a complete manual offer', () => {
  assert.ok(SCRIPT.includes('} else if (manual && manual.version && manual.command) {'), 'the card has no command arm');
  assert.ok(SCRIPT.includes('} else if (manual && manual.version && manual.download) {'), 'the card has no download arm');
  assert.ok(SCRIPT.includes('manual && manual.version && (manual.command || manual.download) ? manual : null'), 'the toast does not follow both arms');
});
