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

const BLOCK = SCRIPT.match(/^if \(typeof window !== 'undefined'\) window\.kosmosAppTab = \(name\) => \{\n[\s\S]*?\n\};$/m);

function run(name, { tabs = ['agents', 'projects', 'tasks'] } = {}) {
  assert.ok(BLOCK, 'the page no longer publishes kosmosAppTab for the iPhone app');
  const calls = [];
  const win = {};
  const doc = {
    querySelector: (sel) => {
      const m = sel.match(/^#tabs \.tab\[data-tab="([^"]*)"\]$/);
      assert.ok(m, 'unexpected selector ' + sel);
      return tabs.includes(m[1]) ? { click: () => calls.push('click ' + m[1]) } : null;
    },
  };
  new Function('window', 'document', 'showTab', 'settingsOpen', 'pnavClose', BLOCK[0])(
    win, doc, (t) => calls.push('showTab ' + t), (s) => calls.push('settingsOpen ' + s), (r) => calls.push('pnavClose ' + r));
  return { answer: win.kosmosAppTab(name), calls };
}

test('#6846: a native tab presses the board\'s own tab, so it lands at the top of the section', () => {
  for (const tab of ['agents', 'projects', 'tasks']) {
    const { answer, calls } = run(tab);
    assert.equal(answer, true, tab + ' was not opened');
    assert.deepEqual(calls, ['pnavClose false', 'click ' + tab], tab + ' did not go through the press (showTab alone keeps the last project open)');
  }
});

test('#6846: Settings, which has no tab, opens on its first section, as the phone menu opens it', () => {
  const { answer, calls } = run('settings');
  assert.equal(answer, true);
  assert.deepEqual(calls, ['pnavClose false', 'showTab settings', 'settingsOpen you']);
});

test('#6846: a name the board has no section for answers false and changes nothing', () => {
  for (const name of ['detail', 'create', 'joint', 'nope', '', 'agents"]', undefined]) {
    const { answer, calls } = run(name);
    assert.equal(answer, false, String(name) + ' was answered as opened');
    assert.deepEqual(calls.filter((c) => !c.startsWith('pnavClose')), [], String(name) + ' moved the board');
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
