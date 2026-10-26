'use strict';

/**
 * kosmos#7189: a room notice (a Kosmos note) keeps its line breaks, so the page draws them as breaks; the text is
 * escaped first, so a job's text (an email digest carries other people's words) cannot put markup on the page.
 *
 * The page's own script, evaluated whole with a DOM stub, as web.post-receipt.test.js does (see its pageScope for why
 * a whole-script harness and not a sliced function).
 *
 *   node --test web.noticelines-7189.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pjRoomRow() {
  // The single bare <script> is the app; non-greedy, so it stops at its own </script> (web.post-receipt.test.js).
  const src = PAGE.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(src, 'the page has no script block');
  const GEOMETRY = { scrollTop: 0, scrollHeight: 0, clientHeight: 0, offsetHeight: 0 };
  const el = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'textContent' || k === 'value' || k === 'innerHTML' ? '' : (k in GEOMETRY ? GEOMETRY[k] : el())),
    set: () => true,
    apply: () => el(),
  });
  const document = {
    getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el(),
    documentElement: el(), body: el(), readyState: 'complete',
  };
  const window = {
    addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { hash: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  // eslint-disable-next-line no-new-func
  return new Function(
    'document', 'window', 'navigator', 'fetch', 'setInterval', 'setTimeout',
    'clearInterval', 'EventSource', 'location', 'localStorage',
    src[1] + '\nreturn pjRoomRow;',
  )(document, window, {}, () => new Promise(() => {}), () => 0, () => 0, () => {},
    function EventSource() {}, window.location, window.localStorage);
}

const row = pjRoomRow();
const note = (text) => row({ kind: 'note', from: 'kosmos', project: 'p1', text, at: '2026-10-26T12:00:00.000Z' }, { id: 'p1', agents: [] });

test('a notice\'s line breaks are drawn as breaks in its band', () => {
  const html = note('email digest (automated notice): Email cleanup\n- inbox one: 3 unread\n\nend');
  assert.match(html, /^<div class="msg-valve">email digest \(automated notice\): Email cleanup<br>- inbox one: 3 unread<br><br>end/,
    'the lines were not drawn as breaks in the note band: ' + html.slice(0, 200));
  assert.doesNotMatch(html, /\n/, 'a raw line break reached the page, where it would draw as a space');
});

test('the words are escaped before the breaks go in, so a notice cannot put markup on the page', () => {
  const html = note('email digest (automated notice): <img src=x onerror=alert(1)>\n<b>bold</b>');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;<br>&lt;b&gt;bold&lt;/b&gt;'),
    'the notice\'s text was not escaped around its break: ' + html.slice(0, 200));
  assert.doesNotMatch(html, /<img|<b>/, 'markup from the notice reached the page');
});

test('CONTROL: a one-line note (every other Kosmos note) is drawn exactly as before, with no break', () => {
  const html = note('Cleo, Dana and Eli are on this project.');
  assert.match(html, /^<div class="msg-valve">Cleo, Dana and Eli are on this project\./);
  assert.doesNotMatch(html, /<br>/, 'a one-line note gained a break');
});
