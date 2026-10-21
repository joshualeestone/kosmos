'use strict';

/**
 * #6846 part c: inside the iPhone app with its native tab bar (html.kapptabs, set by the app), the Kosmos+ bar is the
 * app's own header: this computer's name on the left when there is another computer to switch to (Josh #6396), the
 * person's face on the right, both opening the phone menu (#pnav) at a level, and the menu giving focus back to the
 * control that opened it. The look is checked in a browser (docs/browser-checks/render-apptabs-6846.js); this file
 * checks the painter, the opening and the closing against fakes, and pins the CSS that scopes it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function el(extra) {
  const attrs = {};
  return Object.assign({ hidden: false, textContent: '', innerHTML: '', laidOut: true, focused: 0,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    getClientRects() { return this.laidOut ? [{}] : []; }, focus() { this.focused += 1; } }, extra || {});
}

function paint({ name, openable, you, face = '<span class="youtint">J</span>', bar = true }) {
  const els = { 'kapp-comp': el(), 'kapp-comp-name': el(), 'kapp-me': el() };
  const doc = { getElementById: (id) => (bar ? els[id] || null : null) };
  new Function('document', 'THIS_COMPUTER_NAME', 'COMPUTERS_OPENABLE', 'YOU_NAME', 'youFaceHtml',
    page.liftAll(SCRIPT, ['kappHeadPaint']) + '\nkappHeadPaint();')(doc, name, openable, you, () => face);
  return els;
}

test('#6846: the switcher shows only when there is another computer to go to (Josh #6396), named as the board names it', () => {
  const two = paint({ name: 'Studio Mac', openable: true, you: 'Josh' });
  assert.equal(two['kapp-comp'].hidden, false);
  assert.equal(two['kapp-comp-name'].textContent, 'Studio Mac');
  assert.equal(two['kapp-comp'].getAttribute('aria-label'), 'Your computers. This computer: Studio Mac');
  const one = paint({ name: 'Studio Mac', openable: false, you: 'Josh' });
  assert.equal(one['kapp-comp'].hidden, true, 'one computer showed the switcher; Josh #6396 says nothing goes there');
  // An answer not in yet: hidden, and never an empty name if it shows later.
  const none = paint({ name: '', openable: false, you: 'Josh' });
  assert.equal(none['kapp-comp'].hidden, true);
  assert.equal(none['kapp-comp-name'].textContent, 'This computer');
});

test('#6846: the person\'s menu shows their face and is named for them', () => {
  const p = paint({ name: 'Studio Mac', openable: true, you: 'Josh', face: '<img src="/me.png" alt="">' });
  assert.equal(p['kapp-me'].innerHTML, '<img src="/me.png" alt="">');
  assert.equal(p['kapp-me'].getAttribute('aria-label'), 'Menu, Josh');
  assert.equal(paint({ name: '', openable: false, you: '' })['kapp-me'].getAttribute('aria-label'), 'Menu, You');
  // Before the bar exists (a page off Kosmos+), painting is a no-op, not a crash.
  assert.doesNotThrow(() => paint({ name: 'x', openable: true, you: 'y', bar: false }));
});

test('#6846: the painter runs whenever its facts change: after each computers answer, and with the user menu\'s face', () => {
  assert.match(SCRIPT, /function worldswOneKosmos\(\) \{\n\s*kappHeadPaint\(\);/, 'a computers answer no longer repaints the app header');
  assert.match(SCRIPT, /if \(upName\) upName\.textContent = who;\n\s*kappHeadPaint\(\);/, 'the face no longer repaints the app header');
  assert.match(SCRIPT, /document\.documentElement\.classList\.add\('kremote'\);[^\n]*\n\s*kappHeadPaint\(\);/, 'the bar is drawn without painting its app controls');
});

function opener() {
  const calls = [];
  const nav = el({ hidden: true });
  const twoLines = el();
  const doc = { getElementById: (id) => (id === 'pnav' ? nav : id === 'kplus-menu' ? twoLines : null),
    documentElement: { classList: { remove() {} } } };
  const scope = { PNAV_OPENER: null };
  const fns = {
    pnavOpen: () => { calls.push('open'); nav.hidden = false; },
    pnavTo: (lv, by) => calls.push('to ' + lv + (by ? ' by ' + by.id : '')),
    pnavSettle: () => {}, pnavOpened: () => {},
  };
  const src = page.liftAll(SCRIPT, ['kappOpenAt', 'pnavClose']);
  const api = new Function('document', 'scope', 'pnavOpen', 'pnavTo', 'pnavSettle', 'pnavOpened',
    'with (scope) {\n' + src + '\nreturn { kappOpenAt, pnavClose };\n}')(doc, scope, fns.pnavOpen, fns.pnavTo, fns.pnavSettle, fns.pnavOpened);
  return { api, calls, nav, twoLines, scope };
}

test('#6846: the face opens the menu at Settings, the switcher at Switch Computers by way of Settings', () => {
  const a = opener();
  const me = el({ id: 'kapp-me' });
  a.api.kappOpenAt(['settings'], me);
  assert.deepEqual(a.calls, ['open', 'to settings by kapp-me']);
  assert.equal(me.getAttribute('aria-expanded'), 'true');
  assert.equal(a.scope.PNAV_OPENER, me, 'the opener was not remembered');
  const b = opener();
  b.api.kappOpenAt(['settings', 'computers'], el({ id: 'kapp-comp' }));
  assert.deepEqual(b.calls, ['open', 'to settings by kapp-comp', 'to computers by kapp-comp']);
  // Already open: nothing happens (a second tap cannot stack levels).
  b.calls.length = 0;
  b.api.kappOpenAt(['settings'], el({ id: 'kapp-me' }));
  assert.deepEqual(b.calls, []);
});

test('#6846: closing gives focus back to the app header control that opened the menu, else the two lines', () => {
  const a = opener();
  const me = el({ id: 'kapp-me' });
  a.api.kappOpenAt(['settings'], me);
  a.api.pnavClose(true);
  assert.equal(me.focused, 1, 'focus did not go back to the face');
  assert.equal(a.twoLines.focused, 0, 'focus went to the two lines, which the app hides');
  assert.equal(me.getAttribute('aria-expanded'), 'false');
  assert.equal(a.scope.PNAV_OPENER, null, 'the opener outlived the menu');
  // CONTROL: opened by the two lines (no opener), focus goes to them, as before.
  const b = opener();
  b.nav.hidden = false;
  b.api.pnavClose(true);
  assert.equal(b.twoLines.focused, 1);
  // An opener no longer on screen (the app bar gone at a wider width) falls back to the two lines.
  const c = opener();
  const gone = el({ id: 'kapp-me', laidOut: false });
  c.api.kappOpenAt(['settings'], gone);
  c.api.pnavClose(true);
  assert.equal(gone.focused, 0);
  assert.equal(c.twoLines.focused, 1);
  // Closing without refocus moves nothing.
  const d = opener();
  const me2 = el({ id: 'kapp-me' });
  d.api.kappOpenAt(['settings'], me2);
  d.api.pnavClose(false);
  assert.equal(me2.focused + d.twoLines.focused, 0);
});

test('#6846: the app header is scoped to the app (kapptabs) on a phone over Kosmos+, and is never drawn elsewhere', () => {
  // Inside the #4823 phone block, keyed on both classes.
  const block = SCRIPT === PAGE ? '' : PAGE.slice(PAGE.indexOf('html.kremote .apphead header .headleft { gap: 8px; }'));
  assert.ok(block, 'the #4823 phone header block moved');
  const end = block.indexOf('\n}\n');
  const inPhone = block.slice(0, end);
  for (const rule of ['html.kremote.kapptabs .kplus-bar { height: 44px; min-height: 44px; }',
    'html.kremote.kapptabs .kplus-bar-mark, html.kremote.kapptabs .kplus-bar-menu { display: none; }']) {
    assert.ok(inPhone.includes(rule), 'missing inside the phone block: ' + rule);
  }
  assert.ok(PAGE.includes('.kapp-comp, .kapp-me { display: none; }'), 'the controls are drawn off the app');
  assert.match(PAGE, /@media \(max-width: 40rem\), \(hover: none\) and \(orientation: landscape\) and \(max-height: 30rem\) and \(max-width: 56rem\) \{\n\s*html\.kremote \.kplus-bar \{/,
    'the phone block is no longer the #4823 phone query');
});
