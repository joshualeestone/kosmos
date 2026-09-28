'use strict';

/**
 * #4356: the first screen asks whether this computer runs agents or connects to agents on another
 * computer.
 *
 * Josh's copy rule (on the card, 2026-09-28): the screen is the Kosmos logo, the heading "How would
 * you like to set up Kosmos on this computer?" and the buttons, nothing else: no subtitle,
 * disclaimer, helper line or footer. Three buttons since Josh's 10:31 ruling: "Run agents on this
 * computer", "Connect to agents on another computer" and "Run agents here and connect to other
 * computers" (the third one's words are Splinter's proposal). So the first tests pin the screen's
 * visible text as exactly the heading and those three labels, and the logo as present. The rest lift the page's own functions and run them: when the screen shows, and
 * what each button tells the Mac app.
 *
 *   node --test web.firstrun-choice-4356.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const HEADING = 'How would you like to set up Kosmos on this computer?';
const RUN = 'Run agents on this computer';
const CONNECT = 'Connect to agents on another computer';
const BOTH = 'Run agents here and connect to other computers';

/* The screen's markup: from its opening tag to the matching close, counted by <div> depth, so a
   line added anywhere inside it is inside what the tests read. */
function screen() {
  const start = PAGE.indexOf('<div class="frc-back" id="fr-choice"');
  assert.notEqual(start, -1, 'the #4356 first screen (#fr-choice) is gone from web/index.html');
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m; (m = tag.exec(PAGE));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return PAGE.slice(start, tag.lastIndex);
  }
  assert.fail('the first screen\'s <div> never closes');
}

/* What a person sees: the text between tags, comments and tags removed, split into its runs. */
function visibleText(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]*>/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

test('#4356: the instrument is reading the page', () => {
  assert.ok(PAGE.length > 100000, 'web/index.html read back only ' + PAGE.length + ' bytes');
  assert.ok(screen().length > 200, 'the first screen read back almost empty');
});

test('#4356: the first screen\'s visible text is exactly the heading and the three button labels', () => {
  assert.deepEqual(visibleText(screen()), [HEADING, RUN, CONNECT, BOTH]);
});

test('#4356: the Kosmos logo is at the top, and nothing else is an image or carries hidden text', () => {
  const html = screen().replace(/<!--[\s\S]*?-->/g, '');
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  assert.equal(imgs.length, 1, 'the screen has ' + imgs.length + ' images; it has the logo and nothing else');
  assert.match(imgs[0], /class="frc-logo" src="data:image\/png;base64,[A-Za-z0-9+\/=]{1000,}" alt="Kosmos"/, 'the image is not the Kosmos mark');
  assert.ok(html.indexOf('<img') < html.indexOf('<h1'), 'the logo is not above the heading');
  // Text a person cannot see still reaches a screen reader, which is "extra text" by another road.
  assert.doesNotMatch(html, /class="[^"]*\bvh\b|aria-description|title="|placeholder=/, 'the screen carries text nobody sees');
  assert.match(html, /<h1 class="frc-title" id="frc-title">/);
});

test('#4356: the K is drawn at no more than its native size on a 2x screen, so it never looks soft', () => {
  const b64 = screen().match(/class="frc-logo" src="data:image\/png;base64,([^"]+)"/)[1];
  const png = Buffer.from(b64, 'base64');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const css = PAGE.match(/\.frc-logo \{ width: ([\d.]+)px; height: ([\d.]+)px;/);
  assert.ok(css, 'the K has no fixed CSS size, so a layout could stretch it');
  assert.ok(Number(css[1]) * 2 <= w && Number(css[2]) * 2 <= h, 'the K is drawn at ' + css[1] + 'x' + css[2] + ' from a ' + w + 'x' + h + ' image: soft on a 2x screen');
  assert.doesNotMatch(PAGE, /\.frc-logo \{[^}]*(max-width|%|vw)/, 'the K scales with the window');
});

test('#4356: the three buttons are the only controls, and each one\'s accessible name is its label', () => {
  const html = screen().replace(/<!--[\s\S]*?-->/g, '');
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(buttons.map((b) => visibleText(b[2]).join(' ')), [RUN, CONNECT, BOTH]);
  // The art is decoration: hidden from screen readers, so each button's name is its label alone.
  for (const [, , inner] of buttons) {
    for (const svg of inner.match(/<svg\b[^>]*>/g) || []) assert.match(svg, /aria-hidden="true"/, 'a button\'s art would be read out as part of its name');
    assert.doesNotMatch(inner, /<(title|desc|text)\b/, 'the art carries words');
  }
  for (const [, attrs] of buttons) assert.doesNotMatch(attrs, /aria-label/, 'an aria-label would give a button a name that differs from its label');
  assert.deepEqual(buttons.map((b) => (b[1].match(/data-mode="([^"]*)"/) || [])[1]), ['run', 'connect', 'both']);
  assert.doesNotMatch(html, /<(a|input|select|textarea)\b/, 'the screen has a control besides the two buttons');
});

/* ---- behaviour: the page's own functions, lifted and run ---------------------------------- */

function lift(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from web/index.html');
  const open = PAGE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(at, i + 1);
  }
  assert.fail(name + ' never closes');
}

function world({ search = '', bridge = true, throws = false, windows = false } = {}) {
  const posted = [];
  const btn = (mode) => ({ dataset: { mode }, disabled: false, onclick: null, focused: false, focus() { this.focused = true; } });
  const btns = [btn('run'), btn('connect'), btn('both')];
  const el = { hidden: true, querySelectorAll: () => btns };
  const siblings = [{ id: 'grid', inert: false }, { id: 'firstrun', inert: false }];
  const cover = { hidden: false };
  const replaced = [];
  const ctx = {
    URL,
    history: { state: null, replaceState(st, title, url) { replaced.push(url); } },
    location: { search, href: 'http://127.0.0.1:16180/' + search + (search ? '&' : '?') + 'token=t' },
    URLSearchParams,
    Promise,
    document: {
      getElementById: (id) => (id === 'fr-choice' ? el : id === 'boot-cover' ? cover : null),
      querySelectorAll: (sel) => (sel === 'body > *:not(#fr-choice)' ? siblings : []),
    },
    window: windows
      ? { chrome: { webview: { postMessage(m) { if (throws) throw new Error('no app'); posted.push(m); } } } }
      : { webkit: bridge ? { messageHandlers: { kosmosMode: { postMessage(m) { if (throws) throw new Error('no app'); posted.push(m); } } } } : undefined },
  };
  vm.createContext(ctx);
  vm.runInContext(['var FR_CHOICE_WATCH = null;', lift('revealBoot'), lift('frChoiceBridge'), lift('frChoiceWanted'), lift('frChoiceForget'), lift('frChoiceInert'), lift('frChoose')].join('\n'), ctx);
  return { ctx, posted, btns, el, cover, replaced, siblings };
}

test('#4356: the screen shows only in the Mac app, and only when the app says no choice is stored', () => {
  assert.equal(world({ search: '?mode=unset' }).ctx.frChoiceWanted(false), true, 'a fresh Mac does not ask');
  assert.equal(world({ search: '?mode=unset' }).ctx.frChoiceWanted(true), false, 'a Mac that finished first run before this change would be asked again');
  assert.equal(world({ search: '?mode=unreadable' }).ctx.frChoiceWanted(true), true, 'an unreadable choice must ask again, never quietly become one');
  assert.equal(world({ search: '' }).ctx.frChoiceWanted(false), false, 'a Mac that has chosen is asked again');
  assert.equal(world({ search: '?mode=run' }).ctx.frChoiceWanted(false), false);
  assert.equal(world({ search: '?mode=unset', bridge: false }).ctx.frChoiceWanted(false), false, 'a browser shows a Connect button that cannot do anything');
});

test('#4356: the Windows app (WebView2) is a bridge too, told { kosmosMode } like its { kosmosBadge }', async () => {
  const w = world({ search: '?mode=unset', windows: true });
  assert.equal(w.ctx.frChoiceWanted(false), true, 'the Windows app never shows the first screen (#4381)');
  assert.equal(world({ search: '', windows: true }).ctx.frChoiceWanted(false), false, 'an older Windows app, which puts no ?mode=, would show it');
  const choice = w.ctx.frChoose();
  w.btns[2].onclick();
  assert.equal(await choice, 'both');
  assert.deepEqual(JSON.parse(JSON.stringify(w.posted)), [{ kosmosMode: 'both' }]);
  // A plain Chrome has window.chrome but no webview: not a bridge.
  const chrome = { location: { search: '?mode=unset' }, URLSearchParams, window: { chrome: {} } };
  vm.createContext(chrome);
  vm.runInContext(lift('frChoiceBridge') + '\n' + lift('frChoiceWanted'), chrome);
  assert.equal(chrome.frChoiceWanted(false), false, 'plain Chrome shows a first screen whose buttons reach nothing');
});

test('#4356: Run agents tells the app "run", hides the screen and lets first run carry on', async () => {
  const w = world({ search: '?mode=unset' });
  const choice = w.ctx.frChoose();
  assert.equal(w.el.hidden, false, 'the screen did not show');
  assert.ok(w.siblings.every((n) => n.inert), 'the board under the screen is reachable by Tab and screen readers');
  assert.equal(w.cover.hidden, true, 'the boot cover stays over the screen');
  assert.equal(w.btns[0].focused, false, 'the approved screen shows no focus ring on load; Tab reaches the first button');
  w.btns[0].onclick();
  assert.equal(await choice, 'run');
  assert.deepEqual(w.posted, ['run']);
  assert.equal(w.el.hidden, true);
  assert.deepEqual(w.replaced, ['/?token=t'], 'a Reload would ask again, and the app no longer listens');
  assert.ok(w.siblings.every((n) => !n.inert), 'the page stays inert after the screen went');
});

test('#4356: Run agents here and connect tells the app "both", hides the screen, and keeps ?mode=both for the end of first run', async () => {
  const w = world({ search: '?mode=unset' });
  const choice = w.ctx.frChoose();
  w.btns[2].onclick();
  assert.equal(await choice, 'both');
  assert.deepEqual(w.posted, ['both']);
  assert.equal(w.el.hidden, true);
  assert.deepEqual(w.replaced, ['/?mode=both&token=t'], 'a relaunch-free first run would not know to end at Kosmos Plus sign-in');
});

test('#4356: Connect tells the app "connect" and leaves the screen up, buttons off, while the app switches', async () => {
  const w = world({ search: '?mode=unset' });
  const choice = w.ctx.frChoose();
  w.btns[1].onclick();
  assert.equal(await choice, 'connect');
  assert.deepEqual(w.posted, ['connect']);
  assert.equal(w.el.hidden, false, 'the board would flash up under a Mac that is switching away from it');
  assert.ok(w.btns.every((b) => b.disabled), 'a second press could tell the app "run" mid-switch');
  assert.ok(w.siblings.every((n) => n.inert), 'the board comes back to life under a Mac that is switching away');
});

test('#4356: if the app cannot be told, Connect does nothing rather than leave dead buttons', async () => {
  const w = world({ search: '?mode=unset', throws: true });
  let settled = false;
  w.ctx.frChoose().then(() => { settled = true; });
  w.btns[1].onclick();
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, 'the page went on as if the Mac had switched');
  assert.deepEqual(w.replaced, [], 'the address forgot a choice the app never heard');
  assert.ok(w.btns.every((b) => !b.disabled), 'the buttons are left disabled with nothing happening');
});

test('#4356: first run ends at the existing Kosmos Plus sign-in only for "both"', () => {
  const ctx = { location: { search: '' }, URLSearchParams, calls: [] };
  vm.createContext(ctx);
  vm.runInContext('var FR_FORCED = false;\n' + lift('frPlusLast') + '\n' + lift('frPlusSignIn')
    + '\nfunction showTab(t) { calls.push("tab:" + t); } function settingsGo(s) { calls.push("sec:" + s); } function plusSiEnter() { calls.push("signin"); }', ctx);
  for (const [search, want] of [['?mode=both', true], ['?mode=both&token=t', true], ['', false], ['?mode=run', false], ['?mode=unset', false], ['?mode=connect', false]]) {
    ctx.location.search = search;
    assert.equal(ctx.frPlusLast(), want, search || '(no query)');
  }
  ctx.location.search = '?mode=both';
  vm.runInContext('FR_FORCED = true', ctx);
  assert.equal(ctx.frPlusLast(), false, 'a re-run of setup from Settings ends at the sign-in again on every both computer');
  assert.match(lift('firstRunBoot'), /FR_FORCED = !!force;/);
  ctx.frPlusSignIn();
  assert.deepEqual(ctx.calls, ['tab:settings', 'sec:plus', 'signin'], 'not the Settings sign-in that already exists');
  assert.match(lift('frEnd'), /frClose\(\);\n\s+if \(frPlusLast\(\)\) frPlusSignIn\(\); else then\(\);/,
    'first run does not end at the sign-in, or ends there for every choice');
  // Every way first run closes goes through frEnd: the saved ending, and Carry on anyway after a
  // save that failed (which once skipped the sign-in).
  assert.match(lift('frFinish'), /if \(ok \|\| FR_FORGOT\) \{ frEnd\(then\); return; \}/);
  assert.match(lift('frFinish'), /label: 'Carry on anyway', go: \(\) => frEnd\(then\)/);
  assert.doesNotMatch(lift('frFinish'), /frClose\(\); then\(\)/, 'a way out of first run skips the last step');
});

test('#4356: tips, the Community notice, What\'s New and the setup assistant all count the first screen as covering the board', () => {
  // The tour started under the screen, took focus and was recorded as seen unseen (review round 3);
  // the setup assistant's layer did the same (round 4).
  for (const fn of ['tipModalOpen', 'cnHeld', 'wnCovered']) assert.match(lift(fn), /\.frc-back:not\(\[hidden\]\)/, fn + ' does not know the first screen');
  assert.match(lift('asbShows'), /const frc = document\.getElementById\('fr-choice'\);\n\s+if \(frc && !frc\.hidden\) return false;/, 'asbShows does not know the first screen');
  // And anything appended to <body> while the screen is up goes inert too.
  assert.match(lift('frChoiceInert'), /new MutationObserver\([\s\S]*n\.inert = true;[\s\S]*observe\(document\.body, \{ childList: true \}\)/);
});

test('#4356: the address keeper carries ?mode=, or first run never sees it', () => {
  // syncUrl rebuilds the query from the page's own state at boot; a key it does not carry is gone
  // before firstRunBoot reads it. That is how the first screen went missing in the browser check.
  const sync = lift('syncUrl');
  assert.match(sync, /for \(const k of \['limit', 'first-run', 'mode'\]\)/);
});

test('#4356: first run asks for the choice before the wizard, and a Connect ends it there', () => {
  const boot = lift('firstRunBoot');
  const ask = boot.indexOf("const chose = frChoiceWanted(state.done) ? await frChoose() : null;");
  assert.notEqual(ask, -1, 'firstRunBoot does not ask for the choice');
  assert.match(boot, /if \(chose === 'connect'\) return;/, 'first run goes on after Connect');
  const done = boot.indexOf("if (state.done && !force) { if (chose === 'both') frPlusSignIn(); return; }");
  assert.notEqual(done, -1, 'a finished Mac that chooses both again never reaches the Kosmos Plus sign-in');
  assert.ok(ask < done, 'a Mac that finished first run with an unreadable choice is never asked');
  assert.ok(ask < boot.indexOf('frOpen();'), 'the wizard opens before the choice');
});
