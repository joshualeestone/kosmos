'use strict';
/* #3960 (Josh, 2026-09-26): a "Get a key" link beside every provider API-key box, in Settings and
   first run, all read from ONE table (KEY_PAGES) so a moved key page is one edit. These tests read
   the shipped page: the table, the links, and that no key-page address lives anywhere else. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/** The table and its applier, run as the page has them. */
function keyPages() {
  const at = PAGE.indexOf('const KEY_PAGES = {');
  const end = PAGE.indexOf("document.querySelectorAll('[data-keypage]')", at);
  assert.ok(at > 0 && end > at, 'the key-page table moved; re-anchor');
  // eslint-disable-next-line no-new-func
  return new Function(PAGE.slice(at, end) + '\nreturn { KEY_PAGES, KEY_PAGE_WHO, keyPageLink };')();
}

test('#3960: the table names a key page for each provider that takes an API key, all https', () => {
  const { KEY_PAGES, KEY_PAGE_WHO } = keyPages();
  // The screen-reader names are read beside the addresses: the two must name the same providers.
  assert.deepEqual(Object.keys(KEY_PAGE_WHO).sort(), Object.keys(KEY_PAGES).sort(), 'a provider has an address but no name for screen readers, or the reverse');
  assert.deepEqual(Object.keys(KEY_PAGES).sort(), ['claude', 'google', 'openai', 'xai']);
  for (const [provider, url] of Object.entries(KEY_PAGES)) {
    assert.match(url, /^https:\/\/[a-z0-9.-]+\/\S+$/, provider + ': ' + url);
  }
  // The addresses checked on 2026-09-26 (see the table's comment): pinned, so a change is deliberate.
  // OpenAI's and xAI's are the least certain (bot-checked, taken from their own docs), so pinned too.
  assert.deepEqual(KEY_PAGES, {
    google: 'https://aistudio.google.com/apikey',
    xai: 'https://console.x.ai/team/default/api-keys',
    openai: 'https://platform.openai.com/api-keys',
    claude: 'https://platform.claude.com/settings/keys',
  });
});

/** The id of the nearest element before `at` whose id names a flow or a step. */
function container(at) {
  const before = PAGE.slice(0, at);
  const all = [...before.matchAll(/<div[^>]*\sid="([a-z0-9-]+-(?:flow|step))"/g)];
  return all.length ? all[all.length - 1][1] : null;
}

test('#3960: every API-key box has a Get a key link beside it', () => {
  // Each key box, and the link that belongs to it: Settings (three boxes; the Gemini/Grok box is
  // shared and follows its provider) and first run (three boxes).
  const pairs = [
    ['acct-apikey-key', 'acct-apikey-getkey', null],
    ['acct-claude-key', 'acct-claude-getkey', 'claude'],
    ['acct-openai-key', 'acct-openai-getkey', 'openai'],
    ['fr-openai-key', 'fr-openai-getkey', 'openai'],
    ['fr-gemini-key', 'fr-gemini-getkey', 'google'],
    ['fr-grok-key', 'fr-grok-getkey', 'xai'],
  ];
  for (const [box, link, provider] of pairs) {
    const b = PAGE.indexOf('id="' + box + '"');
    const l = PAGE.indexOf('id="' + link + '"');
    assert.ok(b > 0, 'the key box ' + box + ' is gone');
    assert.ok(l > 0, 'no Get a key link for ' + box);
    // Beside it: inside the same step (the nearest enclosing flow/step container), not somewhere else
    // on the page. Measured by container, not by distance: a comment between them is not distance.
    assert.equal(container(l), container(b), link + ' is not in the same step as ' + box);
    assert.ok(container(b), 'CONTROL: ' + box + ' sits inside a named step');
    const tag = PAGE.slice(PAGE.lastIndexOf('<a', l), PAGE.indexOf('>', l) + 1);
    assert.match(tag, /target="_blank"/, link + ' must open in the browser');
    assert.match(tag, /rel="noreferrer noopener"/, link + ' must not hand the page, or its address, to the opened tab');
    if (provider) assert.match(tag, new RegExp('data-keypage="' + provider + '"'), link + ' reads the wrong table row');
    else assert.doesNotMatch(tag, /data-keypage=/, 'the shared box\'s link is set per provider, not fixed');
  }
});

test('#3960: no key-page address is written anywhere else in the page', () => {
  const { KEY_PAGES } = keyPages();
  // The table's region starts at its own comment (which names addresses too) and ends with it.
  const at = PAGE.indexOf('/* #3960 (Josh, 2026-09-26');
  const tableEnd = PAGE.indexOf('};', PAGE.indexOf('const KEY_PAGES = {'));
  assert.ok(at > 0 && tableEnd > at, 'the table moved; re-anchor');
  const outside = PAGE.slice(0, at) + PAGE.slice(tableEnd);
  // Every provider's key-page domain, not only today's exact URLs, so an old hard-coded link cannot
  // hide. Key-page PATHS where the domain has other legitimate pages (OpenAI's billing, Claude's
  // console), so a future link to those is not mistaken for a stray key link.
  for (const needle of [...Object.values(KEY_PAGES), 'aistudio.google.com', 'console.x.ai', 'platform.openai.com/api-keys',
    'console.anthropic.com/settings/keys', 'platform.claude.com/settings/keys']) {
    assert.equal(outside.includes(needle), false, needle + ' is written outside the table');
  }
  // CONTROL: the scan reads the page (the table itself does hold them).
  assert.ok(PAGE.slice(at, tableEnd).includes('aistudio.google.com'));
});

test('#3960: keyPageLink points a link at the table, and hides it for a provider with none', () => {
  const { KEY_PAGES, keyPageLink } = keyPages();
  const el = () => { const said = { textContent: ' (opens the key page in your browser)' };
    return { hidden: false, attrs: {}, said, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => said }; };
  const g = el();
  keyPageLink(g, 'google');
  assert.deepEqual([g.hidden, g.attrs.href], [false, KEY_PAGES.google]);
  assert.equal(g.said.textContent, ' (opens Google’s key page in your browser)', 'the screen-reader text does not name the provider');
  const x = el();
  keyPageLink(x, 'xai');
  assert.equal(x.said.textContent, ' (opens xAI’s key page in your browser)');
  const none = el();
  keyPageLink(none, null);
  assert.deepEqual([none.hidden, none.attrs.href], [true, '#'], 'a link with nowhere to go was left showing');
  keyPageLink(null, 'google');   // a missing element is not an error
});

test('#3960: the shared Gemini/Grok box follows its provider, and every data-keypage link is set at load', () => {
  const show = PAGE.indexOf('function acctApikeyShow(which)');
  const body = PAGE.slice(show, PAGE.indexOf('\n}', show));
  assert.match(body, /keyPageLink\(document\.getElementById\('acct-apikey-getkey'\), ACCT_APIKEY_WHICH\)/);
  assert.match(PAGE, /document\.querySelectorAll\('\[data-keypage\]'\)\.forEach\(\(el\) => keyPageLink\(el, el\.dataset\.keypage\)\);/);
});
