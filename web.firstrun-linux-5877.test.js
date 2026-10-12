'use strict';
/* kosmos#5877: first run on a Linux board (a server reached in a browser) walks only the steps that are not about a
 * desktop Mac. The step list and its hops are the page's own functions, run with the served platform set; the panes a
 * Linux board keeps are read as served markup (comments, styles and scripts removed). Text a painter writes into them
 * at run time is not rendered here; the one Linux-specific painter arm (pane 5's sign-in hatch) is read below.
 *   node --test web.firstrun-linux-5877.test.js */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const LAYER = page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS);

function docFor(platform) {
  return { querySelector: (sel) => (sel === 'meta[name="kosmos-platform"]' && platform !== undefined ? { getAttribute: () => platform } : null), getElementById: () => null };
}
function wizard(platform, expr) {
  // eslint-disable-next-line no-new-func
  return new Function('document', 'FR_STEPS', LAYER + '\nreturn ' + expr + ';')(docFor(platform), 9);
}

test('#5877: a Linux board walks Welcome, Model, Help make Kosmos better, About you and Your agents', () => {
  assert.deepEqual(wizard('linux', 'frStepSequence()'), [1, 5, 6, 8, 9]);
  assert.deepEqual([1, 5, 6, 8].map((s) => wizard('linux', `frStepAfter(${s})`)), [5, 6, 8, 9], 'a Next hop lands outside the Linux steps');
  assert.equal(wizard('linux', 'frStepProgress(6)'), 2 / 4, 'progress counts only the steps a Linux board walks');
  assert.equal(wizard('linux', 'frStepProgress(9)'), 1);
});

test('#5877: a deep link to a skipped Mac step on Linux lands on the next-numbered step a Linux board walks (as Windows does)', () => {
  for (const [skipped, lands] of [[2, 5], [3, 5], [4, 5], [7, 8]]) {
    assert.equal(wizard('linux', `frStepAfter(${skipped})`), lands, `step ${skipped}`);
  }
});

test('#5877 CONTROL: a Mac and a Windows board walk what they walked before', () => {
  assert.deepEqual(wizard('darwin', 'frStepSequence()'), [1, 5, 2, 3, 4, 6, 7, 8, 9]);
  assert.deepEqual(wizard('win32', 'frStepSequence()'), [1, 5, 3, 6, 7, 8, 9]);
  assert.deepEqual(wizard(undefined, 'frStepSequence()'), [1, 5, 2, 3, 4, 6, 7, 8, 9], 'an unstamped page read as Linux');
});

/* A pane's served words: from its opening div to the div that closes it (counted, so pane 9 does not run on into
   the next screen), with comments, styles and scripts removed. */
function paneText(n) {
  const start = PAGE.indexOf(`<div class="fr-pane" id="fr-pane-${n}"`);
  assert.ok(start > -1, `fr-pane-${n} is gone`);
  const src = PAGE.slice(start).replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  const tag = /<(\/?)div\b[^>]*>/g;
  let depth = 0; let end = -1; let m;
  while ((m = tag.exec(src))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { end = m.index + m[0].length; break; }
  }
  assert.ok(end > 0, `could not find where fr-pane-${n} ends`);
  return src.slice(0, end)
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
/* Mac words in any case, plus the Mac app's name "Terminal" (case-sensitive, since "a terminal" on a server is right). */
const MAC_WORDS_ANY_CASE = /\b(dock|applications folder|finder|macos|mac|system settings|keychain|spotlight|launchpad|menu bar)\b|\bsleep/i;
const macWord = (text) => { const m = text.match(MAC_WORDS_ANY_CASE) || text.match(/\bTerminal\b/); return m ? m[0] : null; };

test('#5877: the steps a Linux board walks say nothing about a desktop Mac', () => {
  for (const n of wizard('linux', 'frStepSequence()')) {
    const words = paneText(n);
    assert.ok(words.trim().length > 20, `step ${n} read as empty: the reader missed it`);
    assert.equal(macWord(words), null, `step ${n} names a Mac thing on a Linux board`);
  }
});

test('#5877: pane 9 is read to its own end, not into the next screen', () => {
  const nine = paneText(9);
  assert.ok(nine.length < 4000, 'pane 9 read on past its end: ' + nine.length + ' characters');
  assert.doesNotMatch(nine, /Create a Single Agent|Load folder/, 'pane 9 read into the Create panel');
});

test('#5877: the sign-in hatch pane 5 paints on a Linux board names no Mac thing', () => {
  const at = SCRIPT.indexOf("'<details class=\"fr-hatch\"><summary>Have a shell on the server?</summary>'");
  assert.ok(at > -1, 'the Linux sign-in hatch moved: point this check at it');
  const arm = SCRIPT.slice(at, SCRIPT.indexOf('</details>', at)).replace(/'\s*\+\s*'/g, '').replace(/<[^>]+>/g, ' ');
  assert.match(arm, /SSH/, 'CONTROL: read the Linux arm');
  assert.equal(macWord(arm), null, 'the Linux sign-in hatch names a Mac thing');
});

test('#5877 CONTROL: the reader does find Mac words in the steps a Linux board skips', () => {
  assert.ok(macWord(paneText(7)), 'the Success step no longer names the Dock: the reader cannot see Mac words');
  assert.ok(macWord(paneText(3)), 'the Automation step no longer mentions sleep: the reader cannot see Mac words');
  assert.equal(macWord(' open Terminal, type '), 'Terminal', 'CONTROL: the Mac app name Terminal is caught');
  assert.equal(macWord(' Sleep settings '), 'Sleep', 'CONTROL: a capitalised Mac word is caught');
  assert.equal(macWord(' Open a terminal there, over SSH '), null, 'CONTROL: "a terminal" on a server is not a Mac word');
});

/* Pane 9's scan list, painted for real: the "Could not scan Documents, Downloads, or Desktop" line is a macOS folder
   permission result, and a Linux board (no such permission) reports those folders unavailable too, so it must not say it. */
function paintScan(platform) {
  const title = { textContent: '' };
  const box = { innerHTML: '' };
  const stubs = {
    importAddsDropStuck: () => {}, frScanOffer: () => [], frImportOffer: () => [{ file: '/x/a.md' }],
    scanRowsHtml: () => '', foundImportRowsHtml: () => '<div>row</div>', importNamesKept: () => null, importNamesRestore: () => {},
    frActions: () => {}, frFinish: () => {}, showTab: () => {}, FR_SCAN: { bounded: { tccUnavailable: true } },
  };
  const doc = Object.assign(docFor(platform), { getElementById: (id) => (id === 'fr-fleet-title' ? title : id === 'fr-fleet' ? box : null) });
  // eslint-disable-next-line no-new-func
  new Function('document', ...Object.keys(stubs), LAYER + '\n' + page.lift(SCRIPT, 'frPaintScan') + '\nfrPaintScan();')(doc, ...Object.values(stubs));
  return box.innerHTML;
}

test('#5877: pane 9 on a Linux board does not say it could not scan Documents, Downloads or Desktop', () => {
  assert.doesNotMatch(paintScan('linux'), /Documents, Downloads, or Desktop/);
  assert.match(paintScan('darwin'), /Could not scan Documents, Downloads, or Desktop this time/, 'CONTROL: a Mac still says it');
});

test('#5877: the Create panel\'s scan list holds the same line back on a Linux board', () => {
  const fn = page.lift(SCRIPT, 'populateFoundImports');
  assert.match(fn, /const tccOut = !onLinux\(\) && /, 'the Create panel says the macOS folder line on Linux');
});
