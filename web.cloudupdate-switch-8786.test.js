'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8786 S2: on a Kosmos Cloud computer the "Update Kosmos automatically" switch is shown (it turns off the
 * nightly update, engine/cloudnightly.js), with words for what it does there. On any other Linux board it stays
 * hidden, as kosmos#7935 left it. The page's own functions are lifted and run as a Cloud box and as a plain Linux
 * board (the CONTROL), and a Mac.
 *
 *   node --test web.cloudupdate-switch-8786.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

const run = (names, body, env) => {
  const keys = Object.keys(env);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, page.liftAll(SCRIPT, names) + '\n' + body)(...keys.map((k) => env[k]));
};
const machine = (cloud, platform) => ({
  onCloudMachine: () => cloud,
  onLinux: (p) => (p || platform) === 'linux',
  onWindows: (p) => (p || platform) === 'win32',
});

/* An element inside the switch's row, as platformHides sees it. */
const inAutoRow = { closest: (sel) => (sel === '[data-linux-hide-unless-cloud]' ? {} : null) };

test('platformHides: the switch row is shown on a Cloud box, hidden on another Linux board and on Windows, shown on a Mac', () => {
  const hides = (cloud, platform) => run(['platformHides'], 'return platformHides(el);', Object.assign(machine(cloud, platform), { el: inAutoRow }));
  assert.equal(hides(true, 'linux'), false, 'a Cloud box shows it');
  assert.equal(hides(false, 'linux'), true, 'CONTROL: a plain Linux board hides it');
  assert.equal(hides(false, 'darwin'), false, 'a Mac shows it');
});

test('the row and its status line carry the attribute, and the CSS hides it on Linux only off a Cloud box', () => {
  assert.match(PAGE, /<div class="setrow" id="auto-row" style="margin-top:12px;" data-win-hide data-linux-hide-unless-cloud>/);
  assert.match(PAGE, /<p class="dhint" id="auto-msg" role="status" style="margin:8px 0 0;" data-win-hide data-linux-hide-unless-cloud><\/p>/);
  assert.match(PAGE, /html\[data-kosmos-platform="linux"\]:not\(\[data-kosmos-cloud\]\) \[data-linux-hide-unless-cloud\] \{ display: none !important; \}/);
  // The row is no longer under the plain Linux hide, which would win over the Cloud exception.
  const row = PAGE.slice(PAGE.indexOf('<div class="setrow" id="auto-row"'), PAGE.indexOf('id="auto-toggle"'));
  assert.doesNotMatch(row, /data-linux-hide[ >]/);
});

test('applyPlatformCopy gives the switch its nightly words on a Cloud box only', () => {
  const MAC_HINT = 'On by default. New versions install themselves, which takes a few seconds and reloads this board. Agents keep running throughout.';
  assert.ok(PAGE.includes('data-cloud-copy="autoHint">' + MAC_HINT + '</p>'), 'premise: the hint the Mac shows');
  const words = (cloud) => {
    const el = { textContent: MAC_HINT, getAttribute: () => 'autoHint' };
    const document = { documentElement: { setAttribute: () => {} } };
    const root = { querySelectorAll: (q) => (q === '[data-cloud-copy]' ? [el] : []) };
    run(['applyPlatformCopy', 'thisMachine'], 'applyPlatformCopy(root);', Object.assign(machine(cloud, 'linux'), {
      document, root, linuxCopy: () => '', window: undefined,
    }));
    return el.textContent;
  };
  assert.equal(words(true), 'On by default. Once a night, while no agent is working, the newest version installs itself and this board reloads. Turn this off and it stops updating itself.');
  assert.equal(words(false), MAC_HINT, 'CONTROL: off a Cloud box the words are left alone');
});

test('an unreadable setting on a Cloud box names no Install button; elsewhere the sentence is unchanged', () => {
  const said = (cloud) => {
    const els = {};
    const document = { getElementById: (id) => (els[id] = els[id] || { textContent: '', hidden: false, setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} } }) };
    run(['autoPaint'], 'autoPaint({ on: false, ok: false });', { document, onCloudMachine: () => cloud, paintSwitch: () => {} });
    return els['auto-msg'].textContent;
  };
  assert.equal(said(true), 'We could not read this setting, so it counts as off and nothing updates itself.');
  assert.equal(said(false), 'We could not read this setting, so updates will wait for you to press Install.', 'CONTROL');
});
