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

function paint({ name, openable, you, face = '<span class="youtint">J</span>', bar = true, before, app = true }) {
  const els = { 'kapp-comp': el(), 'kapp-comp-name': el(), 'kapp-me': el() };
  if (before) before(els);
  els['kplus-bar'] = el();
  const doc = { getElementById: (id) => (bar ? els[id] || null : null), get activeElement() { return els.active || null; },
    documentElement: { classList: { contains: (c) => c === 'kapptabs' && app } } };
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

test('#6846: the person\'s menu shows their face and is named for what it opens and whose it is', () => {
  const p = paint({ name: 'Studio Mac', openable: true, you: 'Josh', face: '<img src="/me.png" alt="">' });
  assert.equal(p['kapp-me'].innerHTML, '<img src="/me.png" alt="">');
  assert.equal(p['kapp-me'].getAttribute('aria-label'), 'Settings, Josh');
  assert.equal(paint({ name: '', openable: false, you: '' })['kapp-me'].getAttribute('aria-label'), 'Settings, You');
  // Before the bar exists (a page off Kosmos+), painting is a no-op, not a crash.
  assert.doesNotThrow(() => paint({ name: 'x', openable: true, you: 'y', bar: false }));
});

test('#6846: in the app the bar is named Kosmos, not a remote session; off the app it keeps its name', () => {
  assert.equal(paint({ name: 'x', openable: true, you: 'J' })['kplus-bar'].getAttribute('aria-label'), 'Kosmos');
  assert.equal(paint({ name: 'x', openable: true, you: 'J', app: false })['kplus-bar'].getAttribute('aria-label'), 'Kosmos+ remote session');
  assert.ok(SCRIPT.includes("bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Kosmos+ remote session');"), 'kplusBar no longer names the bar as kappHeadPaint assumes off the app');
});

test('#6846: back to one computer while the switcher has focus, focus moves to the face; the face is not rewritten unchanged', () => {
  const p = paint({ name: 'Studio Mac', openable: false, you: 'Josh', before: (els) => { els.active = els['kapp-comp']; } });
  assert.equal(p['kapp-comp'].hidden, true);
  assert.equal(p['kapp-me'].focused, 1, 'focus fell to the page when the switcher went');
  // CONTROL: the switcher hidden already (focus elsewhere), nothing moves.
  const q = paint({ name: 'Studio Mac', openable: false, you: 'Josh', before: (els) => { els['kapp-comp'].hidden = true; els.active = els['kapp-comp']; } });
  assert.equal(q['kapp-me'].focused, 0);
  // The same face is left alone (a picture is not reloaded on every computers answer).
  let writes = 0;
  const r = paint({ name: 'x', openable: true, you: 'Josh', face: '<img src="/me.png" alt="">', before: (els) => {
    let html = '<img src="/me.png" alt="">';
    Object.defineProperty(els['kapp-me'], 'innerHTML', { get: () => html, set: (v) => { writes += 1; html = v; } });
  } });
  assert.equal(writes, 0, 'an unchanged face was written again');
  assert.equal(r['kapp-me'].innerHTML, '<img src="/me.png" alt="">');
});

test('#6846: the painter runs whenever its facts change: after each computers answer, and with the user menu\'s face', () => {
  assert.match(SCRIPT, /function worldswOneKosmos\(\) \{\n\s*if \(typeof kappHeadPaint === 'function'\) kappHeadPaint\(\);/, 'a computers answer no longer repaints the app header');
  assert.match(SCRIPT, /if \(upName\) upName\.textContent = who;\n\s*if \(typeof kappHeadPaint === 'function'\) kappHeadPaint\(\);/, 'the face no longer repaints the app header');
  assert.match(SCRIPT, /document\.documentElement\.classList\.add\('kremote'\);[^\n]*\n\s*kappHeadPaint\(\);/, 'the bar is drawn without painting its app controls');
});

function level(name) {
  const items = [el({ id: name + '-first', tagName: 'BUTTON' })];
  return el({ dataset: { level: name }, className: 'pnav-level', hidden: name !== 'main', querySelector: () => items[0], first: items[0] });
}
function opener() {
  const calls = [];
  const levels = { main: level('main'), settings: level('settings'), computers: level('computers') };
  const goSettings = el({ id: 'go-settings' });
  const switchComputers = el({ id: 'pnav-computers' });
  const nav = el({ hidden: true, querySelectorAll: () => Object.values(levels), classList: { toggle: (c, on) => calls.push('deep ' + on) },
    querySelector: (sel) => { assert.equal(sel, '[data-pnav-go="settings"]'); return goSettings; } });
  const twoLines = el();
  const face = el({ id: 'kapp-me' });
  const back = el({ tabIndex: -1 });
  const ids = { pnav: nav, 'kplus-menu': twoLines, 'kapp-me': face, 'pnav-back': back, 'pnav-computers': switchComputers };
  const doc = { getElementById: (id) => ids[id] || null, documentElement: { classList: { remove() {} } } };
  const scope = { PNAV_OPENER: null, PNAV_TRAIL: ['main'], PNAV_FROM: [] };
  const fns = {
    pnavOpen: (quiet) => { calls.push('open' + (quiet === true ? ' quiet' : '')); nav.hidden = false; levels.main.hidden = false; scope.PNAV_TRAIL = ['main']; scope.PNAV_FROM = []; },
    pnavFill: (lv) => calls.push('fill ' + lv),
    pnavLevel: (lv) => levels[lv],
    computersFetch: () => { calls.push('read computers'); return Promise.resolve(); },
    pnavSettle: () => {}, pnavOpened: () => calls.push('opened'),
  };
  const src = page.liftAll(SCRIPT, ['kappOpenAt', 'pnavClose', 'pnavReturnFocus']);
  const api = new Function('document', 'scope', 'pnavOpen', 'pnavFill', 'pnavLevel', 'computersFetch', 'pnavSettle', 'pnavOpened',
    'with (scope) {\n' + src + '\nreturn { kappOpenAt, pnavClose, pnavReturnFocus };\n}')(doc, scope, fns.pnavOpen, fns.pnavFill, fns.pnavLevel, fns.computersFetch, fns.pnavSettle, fns.pnavOpened);
  return { api, calls, nav, levels, twoLines, face, back, scope, ids, goSettings, switchComputers };
}

test('#6846: the face opens the menu straight at Settings, never passing through the first level', () => {
  const a = opener();
  a.api.kappOpenAt(['settings'], a.face);
  assert.deepEqual(a.calls, ['open quiet', 'opened', 'fill settings', 'deep true'], 'opened by way of an animated walk, or focused the first level on the way');
  assert.deepEqual(a.scope.PNAV_FROM, [a.goSettings], 'Back would not land on Settings');
  assert.equal(a.levels.main.hidden, true);
  assert.equal(a.levels.settings.hidden, false);
  assert.deepEqual(a.scope.PNAV_TRAIL, ['main', 'settings']);
  assert.equal(a.back.tabIndex, 0);
  assert.equal(a.back.getAttribute('aria-label'), 'Main menu');
  assert.equal(a.levels.settings.first.focused, 1, 'focus did not land on the level\'s first item');
  assert.equal(a.face.getAttribute('aria-expanded'), 'true');
  assert.equal(a.scope.PNAV_OPENER, a.face);
});

test('#6846: the switcher opens straight at Switch Computers, reading the computers as the level opens; Back walks to Settings', () => {
  const b = opener();
  const comp = el({ id: 'kapp-comp' });
  b.api.kappOpenAt(['settings', 'computers'], comp);
  assert.deepEqual(b.calls, ['open quiet', 'opened', 'fill settings', 'read computers', 'fill computers', 'deep true']);
  assert.deepEqual(b.scope.PNAV_TRAIL, ['main', 'settings', 'computers']);
  assert.equal(b.levels.computers.hidden, false);
  assert.equal(b.levels.settings.hidden, true);
  assert.equal(b.back.getAttribute('aria-label'), 'Back to Settings');
  assert.deepEqual(b.scope.PNAV_FROM, [b.goSettings, b.switchComputers], 'Back would not land on Settings, then Switch Computers');
  // Already open: nothing happens (a second tap cannot stack levels).
  b.calls.length = 0;
  b.api.kappOpenAt(['settings'], b.face);
  assert.deepEqual(b.calls, []);
});

test('#6846: closing gives focus back to the app header control that opened the menu, else the face, else the two lines', () => {
  const a = opener();
  a.api.kappOpenAt(['settings'], a.face);
  a.api.pnavClose(true);
  assert.equal(a.face.focused, 1, 'focus did not go back to the face');
  assert.equal(a.twoLines.focused, 0, 'focus went to the two lines, which the app hides');
  assert.equal(a.face.getAttribute('aria-expanded'), 'false');
  assert.equal(a.scope.PNAV_OPENER, null, 'the opener outlived the menu');
  // An opener no longer on screen (the switcher hidden by a fresh answer while the menu was open) falls to the face.
  const c = opener();
  const gone = el({ id: 'kapp-comp', laidOut: false });
  c.api.kappOpenAt(['settings', 'computers'], gone);
  c.api.pnavClose(true);
  assert.equal(gone.focused, 0);
  assert.equal(c.face.focused, 1);
  // CONTROL: off the app (no face on screen), opened by the two lines, focus goes to them, as before.
  const b = opener();
  b.face.laidOut = false;
  b.nav.hidden = false;
  b.api.pnavClose(true);
  assert.equal(b.twoLines.focused, 1);
  // Closing without refocus moves nothing.
  const d = opener();
  d.api.kappOpenAt(['settings'], d.face);
  d.levels.settings.first.focused = 0;
  d.api.pnavClose(false);
  assert.equal(d.face.focused + d.twoLines.focused, 0);
});

test('#6846: choosing an item in the menu gives focus back to its opener, not to the hidden two lines', () => {
  // Both item handlers (a tab, a Settings section) close without refocus and then return focus to the opener taken first.
  const m = SCRIPT.match(/nav\.addEventListener\('click', \(e\) => \{\n\s*const tab = e\.target\.closest\('\[data-pnav-tab\]'\);[\s\S]*?\n {2}\}\);/);
  assert.ok(m, 'the menu click handler moved');
  assert.equal((m[0].match(/const opener = PNAV_OPENER;\n\s*pnavClose\(false\);/g) || []).length, 2, 'an item handler closes without taking the opener first');
  assert.equal((m[0].match(/pnavReturnFocus\(opener\);/g) || []).length, 2, 'an item handler does not give focus back to the opener');
  assert.ok(!/getElementById\('kplus-menu'\)\.focus/.test(m[0]), 'an item handler still focuses the two lines, hidden in the app');
  // The page's other focus fallbacks know the face as well.
  assert.equal((SCRIPT.match(/'\.kplus-bar-menu', '#kapp-me', '\.apphead h1'\]/g) || []).length, 5); // 5 with #6587's service key notice
  assert.ok(!SCRIPT.includes("'.kplus-bar-menu', '.apphead h1']"), 'a focus fallback skips the face');
});

test('#6846: the app header is scoped to the app (kapptabs) on a phone over Kosmos+, and is never drawn elsewhere', () => {
  // Inside the #4823 phone block, keyed on both classes.
  const at = PAGE.indexOf('html.kremote .apphead header .headleft { gap: 8px; }');
  assert.ok(at >= 0, 'the #4823 phone header block moved');
  const block = PAGE.slice(at);
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
