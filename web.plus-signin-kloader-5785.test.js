'use strict';
/* #5785 (Josh, 2026-10-10 14:00): the big K-to-circle loader (#2692) while Kosmos+ connects this computer. Source checks
   on web/index.html (comments stripped): they catch a revert or a lost wire. The design shots carry what it looks like. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const fnBody = (name) => {
  const at = code.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' is gone');
  const next = code.indexOf('\nfunction ', at + 10);
  const nextA = code.indexOf('\nasync function ', at + 10);
  const ends = [next, nextA].filter((x) => x > at);
  return code.slice(at, ends.length ? Math.min(...ends) : undefined);
};

test('#5785: the loader holder sits above the "Signing in..." heading in the sign-in card', () => {
  const card = code.slice(code.indexOf('<div id="plus-state2" hidden>'));
  assert.match(card, /^<div id="plus-state2" hidden>\s*<div id="plus-si-k" aria-hidden="true"><\/div>\s*<h3 id="plus-si-title">/);
  assert.match(code, /#plus-si-k canvas \{ width: 88px; height: 103px; display: block;/);
});

test('#5785: it is the existing branded loader (startKLoader on a fresh canvas), not a new one', () => {
  const start = fnBody('plusSiKStart');
  assert.match(start, /holder\.innerHTML = '<canvas width="176" height="206" aria-hidden="true"><\/canvas>';/);
  assert.match(start, /startKLoader\(holder\.firstElementChild\)/);
  // Removed, not hidden: startKLoader stops drawing only once its canvas leaves the page.
  assert.match(fnBody('plusSiKStop'), /holder\.textContent = ''/);
});

test('#5785: a register plays it instead of the small spinner, holds one whole loop, and removes it on the answer', () => {
  const reg = fnBody('plusSiDoRegister');   // review 5: the whole function, not a fixed slice past the post
  assert.match(reg, /plusSiPost\('\/api\/remote\/signin-register'/, 'CONTROL: the register function was found');
  // Review 5: running from the start, for both kinds (not only inside if (owned)).
  assert.match(reg, /PLUS_SI_REGISTERING = true;\s*if \(owned\) \{/);
  assert.match(reg, /if \(siSpin\) siSpin\.hidden = true;[^\n]*\n\s*plusSiKStart\(owned\);/, 'expected the small spinner hidden just before plusSiKStart');
  assert.doesNotMatch(reg, /siSpin\.hidden = !owned/, 'the small spinner is back beside the line during the register');
  assert.match(reg, /const kHoldMs = \(typeof window\.__kosmosRestartHoldMs === 'number' \? window\.__kosmosRestartHoldMs : RESTART_HOLD_MS\);/);
  assert.match(reg, /const siRestore = \(\) => \{[\s\S]{0,120}plusSiKStop\(\);/);
  // Review 1: after every hold, an answer for a sign-in that was left (Sign out, Start over) is dropped, and the register
  // counts as running until the hold ends (the status tick must not paint the connected view early).
  assert.match(reg, /const kEpoch = PLUS_SI_EPOCH;/);
  // Review 2: an error or refusal is not held; a success is, as a running register, for both kinds.
  assert.match(reg, /catch \(e\) \{ if \(kEpoch === PLUS_SI_EPOCH\) PLUS_SI_REGISTERING = false; siRestore\(\); if \(!owned\) plusSiMsg\(''\); throw e; \}/);
  assert.match(reg, /if \(r\.stale\) return;\s*if \(r\.ok\) \{\s*await kHold\(\);\s*if \(kEpoch !== PLUS_SI_EPOCH\) return;\s*\}\s*PLUS_SI_REGISTERING = false;/);
  assert.equal((reg.match(/await kHold\(\)/g) || []).length, 1, 'a second hold is back (a refusal or an error would wait out the loop)');
});

test('#5785: a step change ends the loader, as it ends the small spinner', () => {
  assert.match(fnBody('plusSiShow'), /if \(sp\) sp\.hidden = true; \}[^\n]*\n\s*plusSiKStop\(\);/);
});

test('#5785 review 1: a Sign out during a connect removes the loader (plusSiClear stops it)', () => {
  assert.match(fnBody('plusSiClear'), /plusSiKStop\(\);/);
});

test('#5785 review 1: the browser checks that drive a register skip the hold (the restart interstitial\'s seam)', () => {
  for (const f of ['render-plus-bought-4756.js', 'render-plus-signin-enter-0929.js', 'render-plus-signin-3478.js']) {
    const src = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', f), 'utf8');
    const pages = (src.match(/const page = await \w+\.newPage\(/g) || []).length;
    // Review 3: each seam right after ITS page, not just the same count somewhere in the file.
    const bound = (src.match(/const page = await \w+\.newPage\([^\n]*\);\n\s*await page\.addInitScript\(\(\) => \{ window\.__kosmosRestartHoldMs = 0; \}\);/g) || []).length;
    assert.ok(pages > 0, 'CONTROL: ' + f + ' opens a page');
    assert.equal(bound, pages, f + ': a page that drives a register would wait out the 4.4 s hold');
  }
});

test('#5785 Mona\'s review: centred while it connects, with the wait said, and both put back when it ends', () => {
  assert.match(code, /#plus-state2\.plus-si-busy #plus-si-title, #plus-state2\.plus-si-busy #plus-si-owned, #plus-state2\.plus-si-busy #plus-si-k-note \{ text-align: center; \}/);
  // Review 8: announced (the canvas is aria-hidden, so this line is how a screen reader hears the wait).
  assert.match(code, /<p class="plus-si-lead" id="plus-si-k-note" role="status" hidden>This takes about half a minute\.<\/p>/);
  assert.match(fnBody('plusSiKStart'), /card\.classList\.toggle\('plus-si-busy', !!centred\)[\s\S]*note\.hidden = false/);
  // Review 3: centred only for the automatic connect; a typed name keeps the card's left alignment.
  assert.match(code, /plusSiKStart\(owned\);/);
  assert.match(code, /#plus-si-k canvas \{[^}]*margin: 0 0 16px;[^}]*\}\s*#plus-state2\.plus-si-busy #plus-si-k canvas \{ margin: 0 auto 16px; \}/);
  assert.match(fnBody('plusSiKStop'), /card\.classList\.remove\('plus-si-busy'\)[\s\S]*note\.hidden = true/);
});

test('#5785 review 7: the #4608 sign-in check asserts the big loader during a connect, and that it goes after', () => {
  const src = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'render-plus-signin-3478.js'), 'utf8');
  assert.match(src, /during\.title === 'Signing in\.\.\.' && !during\.spin && during\.k && during\.note && during\.centred/);
  assert.match(src, /siAfter\.k === 0 && !siAfter\.note && !siAfter\.centred/);
  assert.doesNotMatch(src, /during\.spin && during\.k === 0/, 'the old #4608 arm (small ring, no K) is back');
});

test('#5785 review 7: a new sign-in (plusSiEnter) makes an older answer stale, as Start over and Sign out do', () => {
  assert.match(fnBody('plusSiEnter'), /PLUS_SI_EPOCH \+= 1;\s*plusSiClear\(\);/);
});

test('#5785 review 8: every sign-in epoch bump reachable during a register clears the register too (plusSiClear)', () => {
  // A held answer returns on an epoch change without clearing anything itself; that is only safe while every bump it
  // can meet calls plusSiClear. The one exception, the code step's resend, cannot happen during a register.
  const bumps = [...code.matchAll(/PLUS_SI_EPOCH \+= 1;/g)].map((m) => m.index);
  assert.ok(bumps.length >= 3, 'CONTROL: the epoch bumps were found');
  for (const at of bumps) {
    const fnAt = Math.max(code.lastIndexOf('\nfunction ', at), code.lastIndexOf('\nasync function ', at));
    const fnName = (/function (\w+)\(/.exec(code.slice(fnAt, fnAt + 80)) || [])[1];
    if (fnName === 'plusSiRequestCode') continue;   // the resend, on the code step only
    assert.match(code.slice(at, at + 400), /plusSiClear\(\);/, 'an epoch bump in ' + fnName + ' does not clear the register');
  }
});
