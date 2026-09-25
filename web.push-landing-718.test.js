'use strict';
/* #718 mobile: a push tap (or the Answer button) that opens an agent must SHOW the
   conversation on a phone, where the question is and where you answer. The page stacks at
   max-width 56rem (the .dbody rule), which put the question about two screens down on an
   iPhone SE (measured). detailRevealTalkOnPhone scrolls the Direct Message section into
   view on those ARRIVALS only. Measured with a sandboxed board in Chromium and WebKit
   (Playwright's engine build, not Safari): push link, question top 1036 -> 127, composer
   off -> on screen. This file pins the wiring and the behaviour. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('a push link arrival settles ONCE: reveal if the agent opened, else the board home and stop', () => {
  const i = html.indexOf('if (WANT_AGENT && !CURRENT && !WANT_AGENT_GONE) {');
  assert.ok(i > 0, 'the boot open is gated on WANT_AGENT_GONE');
  const block = html.slice(i, i + 900);
  // The poll runs every few seconds: the reveal must not (it pulled the page back each time).
  assert.match(block, /if \(!WANT_AGENT_SETTLED\) \{\n\s*WANT_AGENT_SETTLED = true;/);
  assert.match(block, /if \(CURRENT && CURRENT\.sessionName === WANT_AGENT\) detailRevealTalkOnPhone\(\);/);
  assert.match(block, /else \{ WANT_AGENT_GONE = true; if \(URL_TAB === 'detail'\) \{ showTab\('agents'\); syncUrl\(\); \} \}/);
  assert.match(html, /let WANT_AGENT_SETTLED = false;/);
  assert.match(html, /let WANT_AGENT_GONE = false;/);
});

test('the Answer button arrival reveals it too, right after opening the agent', () => {
  const i = html.indexOf('async function pjAnswerFrom(');
  assert.ok(i > 0, 'pjAnswerFrom exists');
  const body = html.slice(i, i + 6000);
  assert.match(body, /openDetail\(sessionName\);\n  detailRevealTalkOnPhone\(\);/);
});

test('it uses the SAME breakpoint that stacks the agent page', () => {
  assert.match(html, /@media \(max-width: 56rem\) \{\n  \.dbody \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  const fn = html.slice(html.indexOf('function detailRevealTalkOnPhone()'), html.indexOf('function detailRevealTalkOnPhone()') + 600);
  assert.match(fn, /matchMedia\('\(max-width: 56rem\)'\)/);
});

function lift(matches, talk) {
  const i = html.indexOf('function detailRevealTalkOnPhone()');
  const src = html.slice(i, html.indexOf('\n}\n', i) + 2);
  const window = { matchMedia: () => ({ matches }) };
  const detailSection = () => talk;
  return new Function('window', 'detailSection', src + '\nreturn detailRevealTalkOnPhone;')(window, detailSection);
}

test('on a phone it scrolls the Direct Message section to the top; on a computer it does nothing', () => {
  let calls = [];
  const talk = { hidden: false, scrollIntoView: (o) => calls.push(o) };
  lift(true, talk)();
  assert.deepEqual(calls, [{ block: 'start' }]);
  calls = [];
  lift(false, talk)();
  assert.deepEqual(calls, [], 'a computer is left where it is');
  lift(true, { hidden: true, scrollIntoView: () => calls.push('hidden') })();
  lift(true, null)();
  assert.deepEqual(calls, [], 'a hidden or missing section is left alone');
});
