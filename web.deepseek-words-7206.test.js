'use strict';
/**
 * #7206: the page's words for a guide running on DeepSeek when its own model fails (asbFallbackWords). A DeepSeek
 * account is a key, with no sign-in to renew: a refused key is never "choose Sign in again" (engine/accountproblem.js
 * says the same on the board's side). The board names the provider (providerName, from accountproblem), so the guide's
 * runner (claude) never decides it.
 *
 *   node --test web.deepseek-words-7206.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
// eslint-disable-next-line no-new-func
const words = new Function('ASB_FALLBACK_PROVIDER', page.lift(SCRIPT, 'asbFallbackWords') + '\nreturn asbFallbackWords;')({ claude: 'Claude', codex: 'OpenAI' });

test('#7206: a DeepSeek guide whose key is refused is told to check the key, never to sign in again', () => {
  const s = words({ problem: 'auth_failed', runner: 'claude', providerName: 'DeepSeek' });
  assert.match(s, /^Your DeepSeek account isn't answering/);
  assert.match(s, /DeepSeek key is no longer accepted: check the DeepSeek account in Settings, AI Models\./);
  assert.doesNotMatch(s, /Sign in again|sign-in/, s);
  // CONTROL: a Claude guide on the same runner keeps its sign-in words.
  assert.match(words({ problem: 'auth_failed', runner: 'claude', providerName: 'Claude' }), /Its Claude sign-in has stopped working/);
});

test('#7206: a DeepSeek guide at its limit is told to add credits with DeepSeek (its account has a balance)', () => {
  assert.match(words({ problem: 'rate_limited', runner: 'claude', providerName: 'DeepSeek' }), /Add credits with DeepSeek, or wait/);
});
