'use strict';
/**
 * kosmos#7198 review 8: a login notice repaints when the board stops naming its folder. The notice's Refresh login
 * carries the folder it opens Sign in again for (data-adv-dir); the page repaints only when the notices' signature
 * moves, and the folder was not in it, so a folder the board no longer names (its row removed from another device)
 * stayed on the button for the notice's whole life.
 *
 *   node --test web.loginadvdir-7198.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

/** The shipped paintLoginAdvisories over a fake slot; the helpers it calls that are not under test are stubbed. */
function load() {
  const slot = { innerHTML: '', dataset: {}, querySelectorAll: () => [] };
  const src = [
    'const esc = (s) => String(s);',
    'const loginAdvWorksUntil = () => null;',
    'const loginAdvWhen = () => "";',
    'const loginAdvPrune = () => {};',
    'const loginAdvDismissed = () => [];',
    'const loginAdvSyncCovered = () => {};',
    'const loginAdvGo = () => {};',
    'const loginAdvDismiss = () => {};',
    lift(SCRIPT, 'paintLoginAdvisories'),
    'return paintLoginAdvisories;',
  ].join('\n');
  const paint = new Function('document', src)({ getElementById: (id) => (id === 'login-adv-slot' ? slot : null) });
  return { paint, slot };
}
const adv = (dir) => ({ severity: 'warn', daysLeft: 2, expired: false, service: 'Claude Code-credentials-abc', email: 'a@example.com',
  agents: ['mona'], names: ['Mona'], provider: 'Claude', dir });
const dirsOf = (html) => [...html.matchAll(/class="uprime login-adv-go" data-adv-dir="([^"]*)"/g)].map((m) => m[1]);

test('#7198 review 8: the board stops naming the folder, and the notice\'s Refresh login drops it', () => {
  const { paint, slot } = load();
  paint([adv('/home/.claude-x')]);
  assert.deepEqual(dirsOf(slot.innerHTML), ['/home/.claude-x'], 'CONTROL: the first paint carries the folder');
  paint([adv(null)]);
  assert.deepEqual(dirsOf(slot.innerHTML), [''], 'the notice kept a folder the board no longer names');
});

test('#7198 review 8: the same notice with the same folder does not repaint (the signature still holds)', () => {
  const { paint, slot } = load();
  paint([adv('/home/.claude-x')]);
  slot.innerHTML = 'UNTOUCHED';
  paint([adv('/home/.claude-x')]);
  assert.equal(slot.innerHTML, 'UNTOUCHED', 'an unchanged notice repainted, so a poll would rebuild it every tick');
});
