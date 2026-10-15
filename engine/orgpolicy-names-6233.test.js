'use strict';

/**
 * #6233 (found in the #5622 Enterprise run): a company policy refusal names the provider as the screen does
 * ("OpenAI", "Google Gemini"), never by its internal id ('openai', 'google'), and an id it does not know never
 * reads as another vendor.
 *   node --test engine/orgpolicy-names-6233.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const orgpolicy = require('./orgpolicy');

// Every provider id a policy can name, with the name the screen's provider menus show for it.
const SCREEN = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  google: 'Google Gemini',
  antigravity: 'Google Gemini (Google subscription)',
  xai: 'xAI Grok',
  meta: 'Meta Muse',
  alibaba: 'Alibaba Qwen',
};

/* A policy that allows only `other`, with a model list on `id` too (for the two model sentences). */
const policyAgainst = (id) => ({ providers_allowed: [id === 'anthropic' ? 'openai' : 'anthropic'] });
const policyModels = (id) => ({ providers_allowed: [id], models_allowed: { [id]: ['only-this-one'] } });

test('#6233: every refusal names the provider as the screen does, never by its id', () => {
  for (const [id, name] of Object.entries(SCREEN)) {
    const sentences = [
      orgpolicy.allows({ provider: id, model: 'm' }, policyAgainst(id)).because,
      orgpolicy.allows({ provider: id }, policyModels(id)).because,
      orgpolicy.allows({ provider: id, model: 'another-model' }, policyModels(id)).because,
    ];
    for (const s of sentences) {
      assert.equal(typeof s, 'string', 'CONTROL: ' + id + ' was not refused, so this proves nothing');
      assert.ok(s.includes(name), id + ': the refusal does not say ' + JSON.stringify(name) + ': ' + s);
      assert.doesNotMatch(s, new RegExp('\\b' + id + '\\b'), id + ': the refusal prints the internal id: ' + s);
    }
  }
});

test('#6233: an id the names do not know reads "this provider", never another vendor', () => {
  for (const id of ['moonshot', 'some-new-vendor', '', undefined]) {
    const s = orgpolicy.allows({ provider: id, model: 'm' }, { providers_allowed: ['anthropic'] }).because;
    assert.match(s, /does not allow this provider for new agents/, 'unknown id ' + String(id) + ': ' + s);
    for (const name of Object.values(SCREEN)) assert.ok(!s.includes(name), 'unknown id ' + String(id) + ' was refused as ' + name);
  }
  // The inherited key of a plain object is not a provider name either.
  assert.match(orgpolicy.allows({ provider: 'toString' }, { providers_allowed: ['anthropic'] }).because, /this provider/);
});

test('#6233: the names are the provider menus\' own words (a rename on either side reds here)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const optionText = (value) => [...html.matchAll(new RegExp('<option value="' + value + '"[^>]*>([^<]*)', 'g'))].map((m) => m[1]);
  // The Add a provider menu says "Anthropic Claude" on its 'claude' row; the create menu's 'anthropic' row says "Anthropic / Claude".
  const menuValue = { anthropic: 'claude' };
  for (const [id, name] of Object.entries(SCREEN)) {
    const texts = optionText(menuValue[id] || id);
    assert.ok(texts.length > 0, 'CONTROL: no <option value="' + (menuValue[id] || id) + '"> in web/index.html');
    assert.ok(texts.some((t) => t === name || t.startsWith(name + ' ')), id + ': no provider menu row reads ' + JSON.stringify(name) + ' (it has ' + JSON.stringify(texts) + ')');
  }
});
