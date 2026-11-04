'use strict';
/**
 * kosmos#7935: the board's update card on a platform that cannot replace itself (Linux). The real paintUpdateCard,
 * lifted from web/index.html, is fed the manual offer the real engine makes on a Linux look (engine/update.js), so the
 * two cannot drift: it shows the command, and never an [Update] button that only led to a refusal.
 *
 *   node --test web.linux-update-7935.test.js
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-linuxweb-'));
const update = require('./engine/update');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const NEWER = '99.0.0';

function paint(offer, manual, kept, focusedId) {
  const els = kept || {
    'upd-line': { textContent: '' },
    'upd-btn': { textContent: '', dataset: {}, hidden: false, disabled: false },
    'upd-channel': { hidden: true },
    'upd-download': { hidden: true, attrs: {}, getAttribute(n) { return this.attrs[n]; }, setAttribute(n, v) { this.attrs[n] = v; } },
    'upd-manual-steps': { hidden: true, innerHTML: '' },
    'upd-open-folder': { hidden: true },
    'upd-rollback': { hidden: true, textContent: '', dataset: {} },
    'upd-command-row': { hidden: true },
    'upd-command': { value: '', focused: false, focus() { this.focused = true; } },
    'upd-command-msg': { textContent: '' },
  };
  const doc = { activeElement: focusedId ? els[focusedId] : null, getElementById: (id) => els[id] || null, querySelector: () => ({ getAttribute: () => '0.0.0' }) };
  // eslint-disable-next-line no-new-func
  new Function('document', 'UPD_ASKED', 'UPD_CHECKING', 'ENGINE_STALE', 'OFFER', 'MANUAL',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'paintUpdateCard'])
    + '\npaintUpdateCard("0.0.0", OFFER, { looked: true, reached: true, readable: true }, MANUAL, "prod", null);')(doc, false, false, null, offer, manual);
  return els;
}

async function linuxLook() {
  update.resetCache();
  update.setPlatform('linux', 'x64');
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-linuxroot-'));
  fs.mkdirSync(nodePath.join(root, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(nodePath.join(root, 'app'), { recursive: true });
  fs.writeFileSync(nodePath.join(root, 'runtime', 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(nodePath.join(root, 'app', 'server.js'), '');
  update.setInstalledRoot(() => root);
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: NEWER, sha256: 'ab'.repeat(32),
    artifact: 'kosmos-linux-x64.tar.gz', versioned: `kosmos-${NEWER}-linux-x64.tar.gz`, arch: 'x64' }) }));
  await update.refresh();
}
test.afterEach(() => { update.setPlatform(null); update.setInstalledRoot(null); update.setFetcher(null); update.resetCache(); });

test('#7935: a Linux board shows the installer command and no [Update] button', async () => {
  await linuxLook();
  const manual = update.manualOffer();
  assert.ok(manual && manual.command, 'CONTROL: the engine made no Linux offer');
  const els = paint(update.installOffer(), manual);
  assert.equal(els['upd-line'].textContent, 'Version ' + NEWER + ' is ready. To update, run this in a terminal on this computer (Kosmos restarts when it is done):');
  assert.equal(els['upd-btn'].hidden, true, 'the [Update] or Check button is still offered beside the command');
  assert.equal(els['upd-command-row'].hidden, false, 'the command is not shown');
  assert.equal(els['upd-command'].value, manual.command);
  assert.equal(els['upd-download'].hidden, true, 'a Windows download link appeared');
});

test('#7935: the command row stays hidden for a normal in-app offer (the Mac)', () => {
  const els = paint({ version: NEWER }, null);
  assert.equal(els['upd-btn'].textContent, 'Update', 'CONTROL: the Mac offer arm');
  assert.equal(els['upd-command-row'].hidden, true, 'the command row shows on a normal offer');
});

test('#7935: a repaint after the update clears the command (the row does not stick)', async () => {
  await linuxLook();
  const els = paint(null, update.manualOffer());
  assert.equal(els['upd-command-row'].hidden, false, 'CONTROL: the command was not shown first');
  els['upd-command-msg'].textContent = 'Command copied.';
  paint({ version: NEWER }, null, els);
  assert.equal(els['upd-command-row'].hidden, true, 'the command row stayed up on the next paint');
  assert.equal(els['upd-command-msg'].textContent, '', '"Command copied." stayed under a card with no command');
});

test('#7935: the copy result survives the poll repainting the same command, and goes when the command changes', async () => {
  await linuxLook();
  const manual = update.manualOffer();
  const els = paint(null, manual);
  els['upd-command-msg'].textContent = 'Command copied.';
  paint(null, manual, els);   // the five-second poll, same command
  assert.equal(els['upd-command-msg'].textContent, 'Command copied.', 'the poll wiped the copy result under the same command');
  paint(null, { ...manual, command: manual.command + ' x' }, els);
  assert.equal(els['upd-command-msg'].textContent, '', 'a result stayed beside a different command');
});

test('#7935: focus on Check moves to the command field, not to the page, when Check is hidden', async () => {
  await linuxLook();
  const els = paint(null, update.manualOffer(), null, 'upd-btn');
  assert.equal(els['upd-command'].focused, true, 'focus fell to <body>');
  const quiet = paint(null, update.manualOffer(), null, null);
  assert.equal(quiet['upd-command'].focused, false, 'CONTROL: focus is not taken when the person was elsewhere');
});

test('#7935: the markup: a read-only field described by the status line, a Copy button, a status for its result', () => {
  assert.match(PAGE, /<div class="frow" id="upd-command-row" hidden>/);
  assert.match(PAGE, /<input class="tk-inp upd-command" id="upd-command" type="text" readonly spellcheck="false" aria-label="The command that updates Kosmos" aria-describedby="upd-line">/);
  assert.match(PAGE, /<button class="btn-quiet" type="button" id="upd-command-copy">Copy<\/button>/);
  assert.match(PAGE, /<p class="dhint" id="upd-command-msg" role="status"><\/p>/);
  assert.match(SCRIPT, /getElementById\('upd-command-copy'\)\.addEventListener\('click', updCopyCommand\)/);
  // The automatic-update switch promises installs a Linux board never makes, so it is hidden there (as on Windows).
  assert.match(PAGE, /<div class="setrow" id="auto-row" style="margin-top:12px;" data-win-hide data-linux-hide>/);
  assert.match(PAGE, /<p class="dhint" id="auto-msg" role="status" style="margin:8px 0 0;" data-win-hide data-linux-hide><\/p>/);
  assert.match(PAGE, /html\[data-kosmos-platform="linux"\] \[data-linux-hide\] \{ display: none !important; \}/, 'CONTROL: the Linux hide rule');
  assert.match(PAGE, /#upd-command-msg:empty \{ display: none; \}/);
});

/* The REAL updCopyCommand and the page's copy helpers, against a stub document: execCommand copies or refuses, the
   clipboard API copies, refuses or is absent. */
function copyRig({ exec = false, clip } = {}) {
  const field = { value: "'/h/bin/kosmos' update --if-newer --install", selected: false, focused: false,
    focus() { this.focused = true; doc.activeElement = this; }, select() { this.selected = true; },
    setSelectionRange() { this.selected = true; } };
  const msg = { textContent: '' };
  const btn = { isConnected: true, focus() { doc.activeElement = this; } };
  const els = { 'upd-command': field, 'upd-command-msg': msg, 'upd-command-copy': btn };
  const doc = {
    activeElement: btn, body: { appendChild() {} },
    getElementById: (id) => els[id] || null,
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
    execCommand: () => exec,
  };
  const nav = clip === undefined ? {} : { clipboard: { writeText: clip } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'navigator', 'MSG_MENU_MAC',
    page.liftAll(SCRIPT, ['copyKeysWord', 'selectAllKeysWord', 'copyRefusedLine', 'copyFocusStillOn', 'selectForCopy',
      'copyTextViaExec', 'copyTextOrdered', 'updCopyCommand']) + '\nreturn updCopyCommand;')(doc, nav, false);
  return { run: fn, field, msg };
}

test('#7935: Copy copies the command, and says so', async () => {
  const r = copyRig({ exec: true });
  await r.run();
  assert.equal(r.msg.textContent, 'Command copied.');
  const viaClip = copyRig({ exec: false, clip: async () => {} });
  await viaClip.run();
  assert.equal(viaClip.msg.textContent, 'Command copied.', 'the clipboard API path');
});

test('#7935: a refused copy selects the field and says how to copy the COMMAND', async () => {
  const r = copyRig({ exec: false, clip: async () => { throw new Error('denied'); } });
  await r.run();
  assert.equal(r.field.selected, true, 'the field was not selected for a manual copy');
  assert.match(r.msg.textContent, /^Kosmos could not copy it\. (Select|Click) the command/, r.msg.textContent);
  assert.doesNotMatch(r.msg.textContent, /the code/);
});

test('#7935: a command replaced while the copy runs says nothing about the old one', async () => {
  let release;
  const r = copyRig({ exec: false, clip: () => new Promise((ok) => { release = ok; }) });
  const pending = r.run();
  r.field.value = 'something else';
  release();
  await pending;
  assert.equal(r.msg.textContent, '', 'a result was written for a command no longer shown');
});
