'use strict';
/* kosmos#5877: first run on a Linux board (a server reached in a browser) walks only the steps that are not about a
 * desktop Mac. The step list and its hops are the page's own functions, run with the served platform set; the panes a
 * Linux board keeps are read as the person would see them (markup, comments, styles and scripts removed).
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

test('#5877: a deep link to a skipped Mac step on Linux lands on the next step a Linux board walks', () => {
  for (const [skipped, lands] of [[2, 5], [3, 5], [4, 5], [7, 8]]) {
    assert.equal(wizard('linux', `frStepAfter(${skipped})`), lands, `step ${skipped}`);
  }
});

test('#5877 CONTROL: a Mac and a Windows board walk what they walked before', () => {
  assert.deepEqual(wizard('darwin', 'frStepSequence()'), [1, 5, 2, 3, 4, 6, 7, 8, 9]);
  assert.deepEqual(wizard('win32', 'frStepSequence()'), [1, 5, 3, 6, 7, 8, 9]);
  assert.deepEqual(wizard(undefined, 'frStepSequence()'), [1, 5, 2, 3, 4, 6, 7, 8, 9], 'an unstamped page read as Linux');
});

/* A pane's words as the person sees them: the pane's own markup, with comments, styles and scripts removed. */
function paneText(n) {
  const start = PAGE.indexOf(`<div class="fr-pane" id="fr-pane-${n}"`);
  assert.ok(start > -1, `fr-pane-${n} is gone`);
  const next = PAGE.indexOf('<div class="fr-pane" id="fr-pane-', start + 10);
  const end = next > -1 ? next : PAGE.indexOf('</section>', start);
  return PAGE.slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
const MAC_WORDS = /\b(Dock|Applications folder|Finder|macOS|this Mac|System Settings|Keychain)\b|\bsleep/i;

test('#5877: the steps a Linux board walks say nothing about a desktop Mac', () => {
  for (const n of wizard('linux', 'frStepSequence()')) {
    const words = paneText(n);
    assert.ok(words.trim().length > 20, `step ${n} read as empty: the reader missed it`);
    assert.doesNotMatch(words, MAC_WORDS, `step ${n} names a Mac thing on a Linux board`);
  }
});

test('#5877 CONTROL: the reader does find Mac words in the steps a Linux board skips', () => {
  assert.match(paneText(7), MAC_WORDS, 'the Success step no longer names the Dock: the reader cannot see Mac words');
  assert.match(paneText(3), MAC_WORDS, 'the Automation step no longer mentions sleep: the reader cannot see Mac words');
});
