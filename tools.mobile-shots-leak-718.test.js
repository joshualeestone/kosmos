'use strict';
/**
 * #718: the mobile-shots leak guard's checks can fire, one kind at a time.
 *
 * The gate proves two arms end to end (tools/browser-checks.sh: the accounts preflight
 * and the pre-shot page scan). The post-shot rescan and the report scan use the same
 * `hitsIn` over different text, and the home, key and email checks inside it had no
 * control of their own. This plants each kind in a string and asserts it is caught,
 * with a clean control that must come back empty, and asserts the message carries no
 * characters of what it found (it lands in shared gate logs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { hitsIn } = require('./docs/browser-checks/lib-leak-guard.js');

test('#718 leak guard: product text and example addresses are clean (the control)', () => {
  assert.deepEqual(hitsIn('Write to owner@example.com or team@example.org; the key field shows sk-ant- until you paste one.'), []);
});

test('#718 leak guard: an email the board injected is caught', () => {
  assert.equal(hitsIn('Role: reach me at someone@real-company.io').length, 1);
});

test('#718 leak guard: OpenAI / Anthropic, Gemini and Grok keys are each caught', () => {
  assert.equal(hitsIn('key sk-proj-abcdefghijklmnop').length, 1);
  assert.equal(hitsIn('key AIzaSyA1234567890abcdefghij').length, 1);
  assert.equal(hitsIn('key xai-ABCDEFGHIJKLMNOPQRSTUV').length, 1);
});

test('#718 leak guard: GitHub tokens are caught (each kind), and near misses are not', () => {
  const tail36 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
    assert.equal(hitsIn('token ' + prefix + tail36).length, 1, prefix);
  }
  assert.equal(hitsIn('token github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz').length, 1, 'github_pat_');
  // Near misses: too short, no underscore, the bare words.
  assert.deepEqual(hitsIn('ghp_short gh_' + tail36 + ' ghx_' + tail36 + ' github_pat_ github_pat_abc'), []);
});

test('#718 leak guard: Stripe secret and restricted keys are caught (each kind), and near misses are not', () => {
  for (const prefix of ['sk_live_', 'sk_test_', 'rk_live_', 'rk_test_']) {
    assert.equal(hitsIn('key ' + prefix + '51HxAbCdEfGhIjKlMn').length, 1, prefix);
  }
  // Near misses: the publishable key (pk_, not a secret), a too-short tail, the bare prefix.
  assert.deepEqual(hitsIn('pk_live_51HxAbCdEfGhIjKlMn sk_live_short sk_live_ rk_prod_51HxAbCdEfGhIjKlMn'), []);
});

test('#718 leak guard: this Mac\'s home path is caught in any case', () => {
  const home = os.homedir();
  // The home check itself, not the user-name check that also matches a path containing the login.
  const isHome = (h) => h.startsWith('home:');
  assert.ok(hitsIn('saved to ' + home + '/Documents').some(isHome), 'home path');
  assert.ok(hitsIn('saved to ' + home.toUpperCase() + '/DOCUMENTS').some(isHome), 'home path in another case');
});

test('#718 leak guard: two different hits of one length count as two', () => {
  assert.equal(hitsIn('aa@secret1.io and bb@secret2.io').length, 2);
});

test('#718 leak guard: a message says what kind and how long, never any of its characters', () => {
  for (const m of hitsIn('someone@secret-corp.io sk-proj-zyxwvutsrqponm')) {
    assert.doesNotMatch(m, /secret|corp|someone|proj|zyx/, m);
  }
});
