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
  const reg = code.slice(code.indexOf('async function plusSiDoRegister('), code.indexOf("plusSiPost('/api/remote/signin-register'") + 400);
  assert.ok(reg.length > 1000, 'CONTROL: the register function was found');
  assert.match(reg, /if \(siSpin\) siSpin\.hidden = true;[^\n]*\n\s*plusSiKStart\(\);/, 'the small spinner still shows during the register');
  assert.doesNotMatch(reg, /siSpin\.hidden = !owned/, 'the small spinner is back beside the line during the register');
  assert.match(reg, /const kHoldMs = \(typeof window\.__kosmosRestartHoldMs === 'number' \? window\.__kosmosRestartHoldMs : RESTART_HOLD_MS\);/);
  assert.match(reg, /const siRestore = \(\) => \{[\s\S]{0,120}plusSiKStop\(\);/);
  assert.match(reg, /catch \(e\) \{ await kHold\(\); siRestore\(\);/);
  assert.match(reg, /if \(r\.stale\) return;\s*await kHold\(\);/);
});

test('#5785: a step change ends the loader, as it ends the small spinner', () => {
  assert.match(fnBody('plusSiShow'), /if \(sp\) sp\.hidden = true; \}[^\n]*\n\s*plusSiKStop\(\);/);
});
