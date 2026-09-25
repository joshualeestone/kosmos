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

function liftSettle(env) {
  const i = html.indexOf('function settleWantAgent()');
  const src = html.slice(i, html.indexOf('\n}\n', i) + 2);
  // Sloppy-mode `with` so the function's globals read and write this env object.
  return new Function('env', 'with (env) { ' + src + ' return settleWantAgent; }')(env);
}
// The golden board card the browser checks use (never a hand-built one): the link names it.
const CARD = require('./docs/browser-checks/fixtures/agent-card.json');
function board({ present }) {
  const env = { WANT_AGENT_GRACE_MS: 4000, WANT_AGENT: CARD.sessionName, CURRENT: null, WANT_AGENT_DONE: false, WANT_AGENT_FIRST_MISS: null, URL_TAB: 'detail',
    now: 1000, opens: 0, reveals: 0, tabs: [] };
  env.performance = { now: () => env.now };
  env.openDetail = (who) => { env.opens += 1; if (present() && who === CARD.sessionName) env.CURRENT = CARD; };
  env.detailRevealTalkOnPhone = () => { env.reveals += 1; };
  env.showTab = (t) => { env.tabs.push(t); env.URL_TAB = t; };
  return env;
}

test('the grace and hold windows are the named constants, at the values the tests drive', () => {
  assert.match(html, /const WANT_AGENT_GRACE_MS = 4000;/);
  assert.match(html, /const REVEAL_HOLD_MS = 4000;/);
  assert.match(html, /const REVEAL_HOLD_TICK_MS = 150;/);
  assert.match(html, /const REVEAL_HOLD_DRIFT_PX = 2;/, 'the lifted tests below pass 2 for it');
});

test('the poll calls settleWantAgent, and it is the only boot open of the link', () => {
  // Inside tick() itself, not merely somewhere in the page.
  const t0 = html.indexOf('async function tick() {');
  assert.ok(t0 > 0, 'tick() moved; re-anchor');
  const tickSrc = html.slice(t0, html.indexOf('\n}\n', t0));
  assert.match(tickSrc, /\n    settleWantAgent\(\);\n/);
  assert.doesNotMatch(html, /if \(WANT_AGENT && !CURRENT\)/, 'the old every-poll open is gone');
  const opens = html.match(/openDetail\(WANT_AGENT\)/g) || [];
  assert.equal(opens.length, 1, 'exactly one openDetail(WANT_AGENT), and it is in settleWantAgent');
  const fn = html.slice(html.indexOf('function settleWantAgent()'), html.indexOf('function settleWantAgent()') + 1200);
  assert.match(fn, /openDetail\(WANT_AGENT\)/);
});

test('an agent on the board opens once, reveals once, and is never reopened', () => {
  let here = true;
  const env = board({ present: () => here });
  const settle = liftSettle(env);
  settle();
  assert.equal(env.opens, 1); assert.equal(env.reveals, 1); assert.equal(env.WANT_AGENT_DONE, true);
  env.CURRENT = null;           // e.g. the person removed a different agent
  settle(); settle();
  assert.equal(env.opens, 1, 'a landed link is never reopened');
  assert.equal(env.reveals, 1);
});

test('two quick misses at boot are not "gone": an agent that appears on the 5s poll still opens, past the 4s grace', () => {
  let here = false;
  const env = board({ present: () => here });
  const settle = liftSettle(env);
  settle(); env.now += 100; settle();          // the two boot ticks, ~100ms apart
  assert.equal(env.WANT_AGENT_DONE, false); assert.deepEqual(env.tabs, []);
  here = true; env.now += 5000; settle();
  assert.equal(env.reveals, 1, 'it opened when it appeared');
  assert.deepEqual(env.tabs, []);
});

test('an agent still missing 4s after the first miss sends the link to the board home, once', () => {
  const env = board({ present: () => false });
  const settle = liftSettle(env);
  settle(); env.now += 3900; settle();
  assert.deepEqual(env.tabs, [], 'not before 4s');
  env.now += 200; settle();
  assert.deepEqual(env.tabs, ['agents']);
  assert.equal(env.WANT_AGENT_DONE, true);
  env.now += 10000; settle();
  assert.deepEqual(env.tabs, ['agents'], 'and it stops');
});

test('the Answer button arrival reveals it too, right after opening the agent', () => {
  const i = html.indexOf('async function pjAnswerFrom(');
  assert.ok(i > 0, 'pjAnswerFrom exists');
  const body = html.slice(i, i + 6000);
  // Only if this agent opened (it can have left the board since the card painted).
  assert.match(body, /openDetail\(sessionName\);\n  \/\/[^\n]*\n  if \(CURRENT && CURRENT\.sessionName === sessionName\) detailRevealTalkOnPhone\(\);/);
});

test('it uses the SAME breakpoint that stacks the agent page', () => {
  assert.match(html, /@media \(max-width: 56rem\) \{\n  \.dbody \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  const fn = html.slice(html.indexOf('function detailRevealTalkOnPhone()'), html.indexOf('function detailRevealTalkOnPhone()') + 600);
  assert.match(fn, /matchMedia\(DETAIL_STACK_MQ\)/);
  assert.match(html, /const DETAIL_STACK_MQ = '\(max-width: 56rem\)';/);
});

function lift(matches, talk, env = {}) {
  const i = html.indexOf('function detailRevealTalkOnPhone()');
  const src = html.slice(i, html.indexOf('\n}\n', i) + 2);
  const listeners = {};
  const e = Object.assign({
    DETAIL_STACK_MQ: '(max-width: 56rem)', REVEAL_HOLD: null, REVEAL_HOLD_MS: 4000, REVEAL_HOLD_TICK_MS: 150, REVEAL_HOLD_DRIFT_PX: 2,
    // Read from the page, so the test holds the REAL list (a missing 'focusin' must fail it).
    REVEAL_HOLD_STOPS: JSON.parse(html.match(/const REVEAL_HOLD_STOPS = (\[[^\]]*\]);/)[1].replace(/'/g, '"')),
    detailSection: () => talk,
    window: { matchMedia: () => ({ matches }),
      // A listener is removed only by the same capture flag it was added with, as in a browser.
      addEventListener: (ev, fn, o) => { (listeners[ev] = listeners[ev] || []).push({ fn, cap: !!(o && (o === true || o.capture)) }); },
      removeEventListener: (ev, fn, o) => { const cap = !!(o && (o === true || o.capture)); listeners[ev] = (listeners[ev] || []).filter((l) => !(l.fn === fn && l.cap === cap)); } },
    performance: { now: () => e.now }, now: 0,
    timers: [],
    setInterval: (fn) => { e.timers.push(fn); return e.timers.length; },
    clearInterval: (id) => { e.timers[id - 1] = null; },
    listeners,
  }, env);
  return { run: new Function('env', 'with (env) { ' + src + ' return detailRevealTalkOnPhone; }')(e), env: e };
}

test('on a phone it scrolls the Direct Message section to the top; on a computer it does nothing', () => {
  let calls = [];
  const talk = { hidden: false, offsetParent: {}, scrollIntoView: (o) => calls.push(o), getBoundingClientRect: () => ({ top: 0 }) };
  lift(true, talk).run();
  assert.deepEqual(calls, [{ block: 'start' }]);
  calls = [];
  lift(false, talk).run();
  assert.deepEqual(calls, [], 'a wide window is left where it is');
  lift(true, { hidden: true, scrollIntoView: () => calls.push('hidden') }).run();
  lift(true, null).run();
  assert.deepEqual(calls, [], 'a hidden or missing section is left alone');
});

test('it holds the conversation in place while content above settles, until the person touches', () => {
  let top = 0; let scrolls = 0;
  const talk = { hidden: false, offsetParent: {}, scrollIntoView: () => { scrolls += 1; top = 0; }, getBoundingClientRect: () => ({ top }) };
  const { run, env } = lift(true, talk);
  run();
  assert.equal(scrolls, 1);
  top = 180; env.now = 500; env.timers[0]();          // the Files list painted above it (WebKit: no anchoring)
  assert.equal(scrolls, 2, 'put back where it was');
  env.listeners.touchstart.forEach((l) => l.fn());      // the person takes over
  assert.equal(env.timers[0], null, 'the watch stopped');
  const left = Object.entries(env.listeners).filter(([, ls]) => ls.length).map(([ev]) => ev);
  assert.deepEqual(left, [], 'every window listener the hold added is gone (same capture flag)');
  const { run: run2, env: env2 } = lift(true, talk);
  run2(); env2.now = 4100; top = 300; env2.timers[0]();
  assert.equal(env2.timers[0], null, 'and it stops on its own after 4 seconds');
});

test('any focus change ends the hold at once (the keyboard scrolls a focused composer; never fight it)', () => {
  let top = 0; let scrolls = 0;
  const talk = { hidden: false, offsetParent: {}, scrollIntoView: () => { scrolls += 1; top = 0; }, getBoundingClientRect: () => ({ top }) };
  const { run, env } = lift(true, talk);
  run();
  env.listeners.focusin.forEach((l) => l.fn());       // e.g. the Answer path focuses the composer
  // The cleared timer IS the guarantee: nothing can call the re-scroll once it is gone.
  assert.equal(env.timers[0], null, 'stopped by the focus');
  assert.equal(scrolls, 1, 'only the arrival scroll happened');
});

test('the hold stops when the section is no longer rendered (its panel was hidden)', () => {
  let top = 0; const talk = { hidden: false, offsetParent: {}, scrollIntoView: () => { top = 0; }, getBoundingClientRect: () => ({ top }) };
  const { run, env } = lift(true, talk);
  run(); talk.offsetParent = null; top = 90; env.now = 200; env.timers[0]();
  assert.equal(env.timers[0], null);
});

test('a link is spent once the person opens some other agent themselves', () => {
  const env = board({ present: () => false });
  const settle = liftSettle(env);
  settle();                                  // first miss
  env.CURRENT = Object.assign({}, CARD, {});  // they opened an agent on their own (the golden card, renamed below)
  env.CURRENT.sessionName = CARD.sessionName + '-other';
  settle();
  assert.equal(env.WANT_AGENT_DONE, true);
  env.CURRENT = null; settle();
  assert.equal(env.opens, 1, 'never reopened to pull them away');
});
