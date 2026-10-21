'use strict';

/**
 * #6846: the iPhone app's native tab bar opens a board section through window.kosmosAppTab, the way the board's
 * phone menu does. A press on a real tab resets to the top of its section (topLevelReset in the #tabs click
 * handler); showTab alone would restore the last open project, so the app must arrive through the press.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const POPOVERS = '[aria-haspopup][aria-expanded="true"]:not(#kplus-menu):not(#burger), #worldsw-btn[aria-expanded="true"]';
const BLOCK = SCRIPT.match(/^if \(typeof window !== 'undefined'\) window\.kosmosAppTab = \(name\) => \{\n[\s\S]*?\n\};$/m);

function run(name, { tabs = ['agents', 'projects', 'tasks'], inert = false, menuOpen = false, noTabs = false, backdrop = false, consolidated = false, popover = false } = {}) {
  assert.ok(BLOCK, 'the page no longer publishes kosmosAppTab for the iPhone app');
  const calls = [];
  const win = {};
  const tabsEl = {
    closest: (sel) => { assert.equal(sel, '[inert]'); return inert ? {} : null; },
    querySelector: (sel) => {
      const m = sel.match(/^\.tab\[data-tab="([^"]*)"\]$/);
      assert.ok(m, 'unexpected selector ' + sel);
      return tabs.includes(m[1]) ? { click: () => calls.push('click ' + m[1]) } : null;
    },
  };
  const doc = {
    body: { classList: { contains: (c) => c === 'consolidated' && consolidated } },
    querySelector: (sel) => {
      if (sel === '.rm-back:not([hidden]), .fr-back:not([hidden]), .frc-back:not([hidden])') return backdrop ? {} : null;
      if (sel === POPOVERS) return popover ? {} : null;
      throw new Error('unexpected selector ' + sel);
    },
    getElementById: (id) => {
      if (id === 'tabs') return noTabs ? null : tabsEl;
      if (id === 'pnav') return { hidden: !menuOpen };
      if (id === 'kplus-menu') return { focus: () => calls.push('focus menu button') };
      throw new Error('unexpected id ' + id);
    },
  };
  const scope = { SETTINGS_SEC: 'models' };
  new Function('window', 'document', 'showTab', 'settingsOpen', 'pnavClose', 'burgerClose', 'openConsolidatedSettings', 'scope',
    'with (scope) {\n' + BLOCK[0] + '\n}')(
    win, doc, (t) => calls.push('showTab ' + t), (s) => calls.push('settingsOpen ' + s), (r) => calls.push('pnavClose ' + r),
    () => calls.push('burgerClose'), () => calls.push('openConsolidatedSettings ' + scope.SETTINGS_SEC), scope);
  return { answer: win.kosmosAppTab(name), calls };
}

test('#6846: a native tab presses the board\'s own tab, so it lands at the top of the section', () => {
  for (const tab of ['agents', 'projects', 'tasks']) {
    const { answer, calls } = run(tab);
    assert.equal(answer, true, tab + ' was not opened');
    assert.deepEqual(calls, ['click ' + tab], tab + ' did not go through the press (showTab alone keeps the last project open)');
  }
});

test('#6846: Settings, which has no tab, opens on its first section, as the phone menu opens it', () => {
  const { answer, calls } = run('settings');
  assert.equal(answer, true);
  assert.deepEqual(calls, ['burgerClose', 'showTab settings', 'settingsOpen you']);
});

test('#6846: a name the board has no section for answers false and changes nothing', () => {
  for (const name of ['detail', 'create', 'joint', 'nope', '', 'agents"]', undefined]) {
    const { answer, calls } = run(name);
    assert.equal(answer, false, String(name) + ' was answered as opened');
    assert.deepEqual(calls, [], String(name) + ' moved the board');
    assert.deepEqual(run(name, { menuOpen: true }).calls, [], String(name) + ' closed an open phone menu');
  }
  // CONTROL: a known tab whose button is missing from the page is refused too, never a silent no-op reported as done.
  assert.equal(run('tasks', { tabs: ['agents', 'projects'] }).answer, false);
});

test('#6846: the press it relies on still resets to the top of the section, and every tab it presses exists', () => {
  // The #tabs click handler runs topLevelReset before showTab; without that, the app would restore the last project.
  assert.match(SCRIPT, /document\.getElementById\('tabs'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,2500}?topLevelReset\(btn\.dataset\.tab\);[\s\S]{0,400}?showTab\(btn\.dataset\.tab\);/,
    'the tab press no longer resets before showTab');
  for (const tab of ['agents', 'projects', 'tasks']) {
    assert.match(PAGE, new RegExp('<button class="tab[^"]*" +data-tab="' + tab + '"'), 'the board has no ' + tab + ' tab button to press');
  }
  assert.ok(SCRIPT.includes("const BUTTONLESS = ['detail', 'create', 'settings'];"), 'Settings gained or lost its button; kosmosAppTab assumes it has none');
});

test('#6846: the open phone menu closes first and gives focus back to its button, as its own choices do', () => {
  assert.deepEqual(run('projects', { menuOpen: true }).calls, ['pnavClose false', 'focus menu button', 'click projects']);
  assert.deepEqual(run('settings', { menuOpen: true }).calls, ['pnavClose false', 'focus menu button', 'burgerClose', 'showTab settings', 'settingsOpen you']);
});

test('#6846: while first run, an update or a restart covers the board, nothing opens and the app is told so', () => {
  for (const name of ['agents', 'projects', 'tasks', 'settings']) {
    const { answer, calls } = run(name, { inert: true, menuOpen: true });
    assert.equal(answer, false, name + ' answered opened under a full-screen step');
    assert.deepEqual(calls, [], name + ' changed the board under a full-screen step');
  }
  assert.equal(run('settings', { noTabs: true }).answer, false, 'a page without the board answered opened');
  // The full-screen steps make the board inert this way; the door's check relies on it.
  assert.ok(SCRIPT.includes("document.querySelectorAll('body > *:not(#firstrun)').forEach((el) => { el.inert = true; });"), 'first run no longer makes the board inert');
});

test('#6846: while a confirmation or other box has its backdrop up, nothing changes under it and the app is told so', () => {
  for (const name of ['agents', 'projects', 'tasks', 'settings']) {
    const { answer, calls } = run(name, { backdrop: true, menuOpen: true });
    assert.equal(answer, false, name + ' answered opened under an open box');
    assert.deepEqual(calls, [], name + ' changed the page under an open box');
  }
  // The selector is the board's own backdrop test (the keystroke guard), so a new kind of box is covered in both or neither.
  assert.ok(SCRIPT.includes("if (document.querySelector('.rm-back:not([hidden]), .fr-back:not([hidden]), .frc-back:not([hidden])')) return;"),
    'the keystroke guard changed its backdrop test; keep kosmosAppTab in step');
});

test('#6846: Settings opens in place in the consolidated layout, as the user menu opens it', () => {
  const { answer, calls } = run('settings', { consolidated: true });
  assert.equal(answer, true);
  assert.deepEqual(calls, ['openConsolidatedSettings you'], 'Settings left the consolidated layout, or opened on the last section');
  assert.match(SCRIPT, /function userpopSettingsGo\(section\) \{[\s\S]{0,1200}?if \(document\.body\.classList\.contains\('consolidated'\)\) \{\n\s*if \(section\) SETTINGS_SEC = section;\n\s*openConsolidatedSettings\(\);/,
    'the user menu changed how it opens Settings; keep kosmosAppTab in step');
});

test('#6846: while a header menu is open over the page, nothing changes under it and the app is told so', () => {
  for (const name of ['agents', 'projects', 'tasks', 'settings']) {
    const { answer, calls } = run(name, { popover: true });
    assert.equal(answer, false, name + ' answered opened under an open header menu');
    assert.deepEqual(calls, [], name + ' changed the page under an open header menu');
  }
  // The same open-menu test the tips use, less the two menus the door handles itself (the phone menu it closes, the
  // burger the press closes). If the tips' test grows, look at whether this one should too.
  assert.ok(SCRIPT.includes("return !!document.querySelector('[aria-haspopup][aria-expanded=\"true\"], #burger[aria-expanded=\"true\"], #worldsw-btn[aria-expanded=\"true\"]');"),
    'tipMenuOpen changed its open-menu test; keep kosmosAppTab in step');
});
