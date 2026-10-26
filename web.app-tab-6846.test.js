'use strict';

/**
 * #6846: the iPhone app's native tab bar opens a board section through window.kosmosAppTab, with a real press, so it
 * lands where a person's press lands. A press on a tab resets to the top of its section (topLevelReset in the #tabs
 * click handler); showTab alone would restore the last open project. Settings, which has no tab, is the user menu's
 * Your Profile. Every click tidier on the page (header menus, pickers) runs on that press as for a person.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const BACKDROPS = '.rm-back:not([hidden]), .fr-back:not([hidden]), .frc-back:not([hidden])';
const BLOCK = SCRIPT.match(/^if \(typeof window !== 'undefined'\) window\.kosmosAppTab = \(name\) => \{\n[\s\S]*?\n\};$/m);

function run(name, { tabs = ['agents', 'projects', 'tasks'], profile = true, inert = false, menuOpen = false, noTabs = false, backdrop = false, makers = ['new-agent', 'pj-new'] } = {}) {
  assert.ok(BLOCK, 'the page no longer publishes kosmosAppTab for the iPhone app');
  const calls = [];
  const win = {};
  const tabsEl = {
    closest: (sel) => { assert.equal(sel, '[inert]'); return inert ? {} : null; },
    querySelector: (sel) => {
      const m = sel.match(/^\.tab\[data-tab="([^"]*)"\]$/);
      assert.ok(m, 'unexpected selector ' + sel);
      return tabs.includes(m[1]) ? { click: () => calls.push('press ' + m[1]) } : null;
    },
  };
  const doc = {
    querySelector: (sel) => { assert.equal(sel, BACKDROPS, 'unexpected selector ' + sel); return backdrop ? {} : null; },
    getElementById: (id) => {
      if (id === 'tabs') return noTabs ? null : tabsEl;
      if (id === 'userpop-go-you') return profile ? { click: () => calls.push('press your profile') } : null;
      if (id === 'pnav') return { hidden: !menuOpen };
      if (id === 'new-agent' || id === 'pj-new') return makers.includes(id) ? { click: () => calls.push('make ' + id) } : null;
      throw new Error('unexpected id ' + id);
    },
  };
  new Function('window', 'document', 'pnavClose', BLOCK[0])(win, doc, (r) => calls.push('pnavClose ' + r));
  return { answer: win.kosmosAppTab(name), calls };
}

test('#6846: a native tab presses the board\'s own tab, so it lands at the top of the section', () => {
  for (const tab of ['agents', 'projects', 'tasks']) {
    const { answer, calls } = run(tab);
    assert.equal(answer, true, tab + ' was not opened');
    assert.deepEqual(calls, ['press ' + tab], tab + ' did not go through the press (showTab alone keeps the last project open)');
  }
});

test('#6846: Settings, which has no tab, is the user menu\'s Your Profile press, its first section', () => {
  const { answer, calls } = run('settings');
  assert.equal(answer, true);
  assert.deepEqual(calls, ['press your profile']);
  // Your Profile opens the first section, in place in the consolidated layout, else on the Settings tab.
  assert.match(SCRIPT, /'userpop-go-you': 'you',/, 'Your Profile no longer opens the first Settings section');
  assert.match(SCRIPT, /function userpopSettingsGo\(section\) \{[\s\S]{0,1200}?if \(document\.body\.classList\.contains\('consolidated'\)\) \{\n\s*if \(section\) SETTINGS_SEC = section;\n\s*openConsolidatedSettings\(\);\n\s*\} else \{\n\s*showTab\('settings'\);\n\s*if \(section\) settingsOpen\(section\);/,
    'the user menu changed how it opens Settings; check kosmosAppTab still lands where a press lands');
  assert.match(PAGE, /<button class="userpop-item" id="userpop-go-you" type="button">/, 'the board has no Your Profile item to press');
});

test('#6846: a name the board has no section for answers false and changes nothing', () => {
  for (const name of ['detail', 'create', 'joint', 'nope', '', 'agents"]', undefined, null, 7]) {
    const { answer, calls } = run(name);
    assert.equal(answer, false, String(name) + ' was answered as opened');
    assert.deepEqual(calls, [], String(name) + ' moved the board');
    assert.deepEqual(run(name, { menuOpen: true }).calls, [], String(name) + ' closed an open phone menu');
  }
  // CONTROL: a known section whose control is missing from the page is refused too, never a no-op reported as done.
  assert.equal(run('tasks', { tabs: ['agents', 'projects'] }).answer, false);
  assert.equal(run('settings', { profile: false }).answer, false);
});

test('#6846: the press it relies on still resets to the top of the section, and every tab it presses exists', () => {
  // The #tabs click handler runs topLevelReset before showTab; without that, the app would restore the last project.
  assert.match(SCRIPT, /document\.getElementById\('tabs'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,2500}?topLevelReset\(btn\.dataset\.tab\);[\s\S]{0,400}?showTab\(btn\.dataset\.tab\);/,
    'the tab press no longer resets before showTab');
  for (const tab of ['agents', 'projects', 'tasks']) {
    assert.match(PAGE, new RegExp('<button class="tab[^"]*" +data-tab="' + tab + '"'), 'the board has no ' + tab + ' tab button to press');
  }
});

test('#6846: the open phone menu closes first, giving focus back to what opened it (pnavClose(true))', () => {
  assert.deepEqual(run('projects', { menuOpen: true }).calls, ['pnavClose true', 'press projects']);
  assert.deepEqual(run('settings', { menuOpen: true }).calls, ['pnavClose true', 'press your profile']);
});

test('#6846: while first run, an update or a restart covers the board, nothing opens and the app is told so', () => {
  for (const name of ['agents', 'projects', 'tasks', 'settings']) {
    const { answer, calls } = run(name, { inert: true, menuOpen: true });
    assert.equal(answer, false, name + ' answered opened under a full-screen step');
    assert.deepEqual(calls, [], name + ' changed the board under a full-screen step');
  }
  assert.equal(run('settings', { noTabs: true }).answer, false, 'a page without the board answered opened');
  // The full-screen steps make the board inert this way; the door's check relies on it.
  // The rule, not one spelling: every body child but #firstrun (and anything else first run must keep pressable, such
  // as #6616's #stepup-ask) is made inert.
  assert.ok(/document\.querySelectorAll\('body > \*:not\(#firstrun\)(?::not\(#[\w-]+\))*'\)\.forEach\(\(el\) => \{ el\.inert = true; \}\);/.test(SCRIPT), 'first run no longer makes the board inert');
});

test('#6846: while a confirmation or other box has its backdrop up, nothing changes under it and the app is told so', () => {
  for (const name of ['agents', 'projects', 'tasks', 'settings']) {
    const { answer, calls } = run(name, { backdrop: true, menuOpen: true });
    assert.equal(answer, false, name + ' answered opened under an open box');
    assert.deepEqual(calls, [], name + ' changed the page under an open box');
  }
  // The selector is the board's own backdrop test (the keystroke guard), so a new kind of box is covered in both or neither.
  assert.ok(SCRIPT.includes("if (document.querySelector('" + BACKDROPS + "')) return;"),
    'the keystroke guard changed its backdrop test; keep kosmosAppTab in step');
});

test('#6846: an open header menu is not a refusal: the press closes it, as a person\'s press does', () => {
  // The fake document answers only the backdrop test; a refusal on open menus would ask it for another selector.
  assert.equal(run('projects').answer, true);
  // The user menu closes on a click anywhere outside it, which the press is.
  assert.match(SCRIPT, /document\.addEventListener\('click', \(e\) => \{\n\s*if \(menu\.hidden\) return;\n\s*if \(e\.target\.closest && e\.target\.closest\('#userpop'\)\) \{/,
    'the user menu no longer closes on a click elsewhere; kosmosAppTab relies on that');
});

/* kosmos#7266: the phone's + buttons ask the door for a create: the section's tab, then its create button. */
test('#7266: new-agent presses Agents, then the board\'s own New agent button', () => {
  const { answer, calls } = run('new-agent');
  assert.equal(answer, true);
  assert.deepEqual(calls, ['press agents', 'make new-agent']);
});

test('#7266: new-project presses Projects, then the board\'s own add-project button', () => {
  const { answer, calls } = run('new-project');
  assert.equal(answer, true);
  assert.deepEqual(calls, ['press projects', 'make pj-new']);
});

test('#7266: a create whose button is missing answers false and presses nothing', () => {
  const { answer, calls } = run('new-project', { makers: ['new-agent'] });
  assert.equal(answer, false);
  assert.deepEqual(calls, []);
});

test('#7266: a create waits behind a box or a covered board, as a section press does', () => {
  assert.equal(run('new-agent', { backdrop: true }).answer, false);
  assert.equal(run('new-agent', { inert: true }).answer, false);
  assert.deepEqual(run('new-agent', { backdrop: true }).calls, []);
});

test('#7266: the open phone menu closes before a create, as before a section press', () => {
  assert.deepEqual(run('new-agent', { menuOpen: true }).calls, ['pnavClose true', 'press agents', 'make new-agent']);
});

test('#7266: the buttons the door presses are on the page, and the app asks for exactly these names', () => {
  assert.match(PAGE, /id="new-agent"/);
  assert.match(PAGE, /id="pj-new"/);
  const swift = fs.readFileSync(nodePath.join(__dirname, 'ios', 'Kosmos', 'ShellLogic.swift'), 'utf8');
  assert.match(swift, /enum Create: String \{ case agent = "new-agent", project = "new-project" \}/);
});
