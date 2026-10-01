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
  assert.doesNotMatch(html, /<(a|input|select|textarea)\b/, 'the screen has a control besides the three buttons');
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

function world({ search = '', bridge = true, throws = false, windows = false, host = '127.0.0.1' } = {}) {
  const posted = [];
  const btn = (mode) => ({ dataset: { mode }, disabled: false, onclick: null, focused: false, focus() { this.focused = true; } });
  const btns = [btn('run'), btn('connect'), btn('both')];
  const el = { hidden: true, querySelectorAll: () => btns };
  const siblings = [{ nodeType: 1, id: 'grid', inert: false }, { nodeType: 1, id: 'firstrun', inert: false }, { nodeType: 1, id: 'held-already', inert: true }];
  const cover = { hidden: false };
  const replaced = [];
  const ctx = {
    URL,
    history: { state: null, replaceState(st, title, url) { replaced.push(url); } },
    location: { search, hostname: host, href: 'http://' + host + ':16180/' + search + (search ? '&' : '?') + 'token=t' },
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
  vm.runInContext(['var FR_CHOICE_WATCH = null; var FR_CHOICE_INERTED = []; var FR_CHOICE_CONNECTING = false; var FR_CHOICE_PENDING = false;', lift('revealBoot'), lift('frChoiceHold'), lift('frChoiceBridge'), lift('frChoiceWanted'), lift('frChoiceForget'), lift('frChoiceInert'), lift('frChoose')].join('\n'), ctx);
  return { ctx, posted, btns, el, cover, replaced, siblings };
}

test('#4356: the screen shows only in the Mac app, and only when the app says no choice is stored', () => {
  assert.equal(world({ search: '?mode=unset' }).ctx.frChoiceWanted(false), true, 'a fresh Mac does not ask');
  assert.equal(world({ search: '?mode=unset' }).ctx.frChoiceWanted(true), false, 'a Mac that finished first run before this change would be asked again');
  assert.equal(world({ search: '?mode=unreadable' }).ctx.frChoiceWanted(true), true, 'an unreadable choice must ask again, never quietly become one');
  assert.equal(world({ search: '' }).ctx.frChoiceWanted(false), false, 'a Mac that has chosen is asked again');
  assert.equal(world({ search: '?mode=run' }).ctx.frChoiceWanted(false), false);
  assert.equal(world({ search: '?mode=unset', bridge: false }).ctx.frChoiceWanted(false), false, 'a browser shows a Connect button that cannot do anything');
  assert.equal(world({ search: '?mode=unreadable', host: 'josh.kosmosplus.com' }).ctx.frChoiceWanted(true), false,
    'a crafted ?mode= raises the first screen over another computer\'s board');
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
  const chrome = { location: { search: '?mode=unset', hostname: '127.0.0.1' }, URLSearchParams, window: { chrome: {} } };
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
  assert.ok(w.siblings.slice(0, 2).every((n) => !n.inert), 'the page stays inert after the screen went');
  assert.equal(w.siblings[2].inert, true, 'an element another screen (#4343\'s restart screen) held inert was let go by this one');
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

test('#4356: if the app cannot be told, both still ends this first run at the Kosmos Plus sign-in', async () => {
  const w = world({ search: '?mode=unset', throws: true });
  const choice = w.ctx.frChoose();
  w.btns[2].onclick();
  assert.equal(await choice, 'both');
  assert.deepEqual(w.replaced, ['/?mode=both&token=t'], 'a failed post loses the last step the button promised');
  const r = world({ search: '?mode=unset', throws: true });
  const rc = r.ctx.frChoose();
  r.btns[0].onclick();
  assert.equal(await rc, 'run');
  assert.deepEqual(r.replaced, [], 'a run the app never heard would stop being asked on Reload');
});

test('#4356: if the app cannot be told, Connect does nothing rather than leave dead buttons', async () => {
  const w = world({ search: '?mode=unset', throws: true });
  let settled = false;
  w.ctx.frChoose().then(() => { settled = true; });
  w.btns[1].onclick();
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, 'the page went on as if the Mac had switched');
  assert.deepEqual(w.replaced, [], 'the address forgot a choice the app never heard');
  assert.ok(w.btns.every((b) => !b.disabled), 'the buttons went dead though nothing was sent, and nothing will happen');
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

test('#4356: tips, What\'s New and the setup assistant all count the first screen as covering the board', () => {
  // The tour started under the screen, took focus and was recorded as seen unseen (review round 3);
  // the setup assistant's layer did the same (round 4).
  // #4820 removed the Community notice, and cnHeld / cnCovered with it.
  for (const fn of ['tipModalOpen', 'wnCovered']) assert.match(lift(fn), /\.frc-back:not\(\[hidden\]\)/, fn + ' does not know the first screen');
  // The type-to-focus handler that steals a keystroke into the composer bails under every covering backdrop.
  assert.match(PAGE, /if \(document\.querySelector\('\.rm-back:not\(\[hidden\]\), \.fr-back:not\(\[hidden\]\), \.frc-back:not\(\[hidden\]\)'\)\) return;\n\s+const c = activeComposer\(\);/);
  // Every covering check that knows first run's .fr-back also knows the first screen.
  const frOnly = (PAGE.match(/\.fr-back:not\(\[hidden\]\)[^'"]*['"]/g) || []).filter((m) => !/\.frc-back/.test(m));
  assert.deepEqual(frOnly, [], 'a check that knows first run does not know the first screen');
  // By-id guards (getElementById('firstrun') ... hidden) the sweep above cannot see: each one was read
  // for #4356. tipsTick is followed by tipModalOpen(), which knows the screen; asbShows checks
  // #fr-choice itself; asbScreen only names the screen for a helper that asbShows already hides.
  // A new one fails here until someone reads it the same way.
  const byId = (PAGE.match(/const fr = document\.getElementById\('firstrun'\);\n\s+if \(fr && !fr\.hidden\)/g) || []).length;
  assert.equal(byId, 3, 'a new first-run guard by id: check it knows the first screen, then update this count');
  assert.match(lift('asbShows'), /const frc = document\.getElementById\('fr-choice'\);\n\s+if \(frc && !frc\.hidden\) return false;/, 'asbShows does not know the first screen');
  // And anything appended to <body> while the screen is up goes inert too.
  assert.match(lift('frChoiceInert'), /new MutationObserver\([\s\S]*frChoiceHold\(n\)[\s\S]*observe\(document\.body, \{ childList: true \}\)/);
});

test('#4356: a layer appended to <body> while the screen is up goes inert, and the watch stops after', () => {
  let observed = null;
  let callback = null;
  class MO { constructor(cb) { callback = cb; } observe(target, opts) { observed = { target, opts }; } disconnect() { observed = 'disconnected'; } }
  const body = { id: 'body' };
  const ctx = { MutationObserver: MO, document: { body, querySelectorAll: () => [] } };
  vm.createContext(ctx);
  vm.runInContext('var FR_CHOICE_WATCH = null; var FR_CHOICE_INERTED = [];\n' + lift('frChoiceHold') + '\n' + lift('frChoiceInert'), ctx);
  ctx.frChoiceInert(true);
  assert.equal(observed && observed.target, body, 'nothing watches <body> while the screen is up');
  assert.equal(observed.opts.childList, true);
  const layer = { nodeType: 1, id: 'asblayer', inert: false };
  const screen = { nodeType: 1, id: 'fr-choice', inert: false };
  callback([{ addedNodes: [layer, screen, { nodeType: 3 }] }]);
  assert.equal(layer.inert, true, 'a layer appended under the screen takes focus from behind it');
  assert.equal(screen.inert, false, 'the screen itself went inert');
  ctx.frChoiceInert(false);
  assert.equal(observed, 'disconnected', 'the watch outlives the screen and inerts the board');
  assert.equal(layer.inert, false, 'a layer this screen held is not given back');
});

test('#4356: an update over the first screen hides the screen, so its overlay is seen, not dead buttons', () => {
  const at = PAGE.indexOf("document.querySelectorAll('body > *:not(.upd-back)').forEach((el) => { el.inert = true; });");
  assert.notEqual(at, -1, 'the update overlay code moved');
  const before = PAGE.slice(Math.max(0, at - 1200), at);
  assert.match(before, /if \(frc && !frc\.hidden\) \{ frc\.hidden = true; if \(typeof frChoiceInert === 'function'\) frChoiceInert\(false\); \}[\s\S]*document\.body\.appendChild\(back\);/);
});

test('#4356: #4343\'s restart screen stands down while Connect stops the board, and otherwise shows over the first screen', () => {
  const paint = lift('paintRestartScreen');
  assert.match(paint, /\(typeof FR_CHOICE_CONNECTING !== 'undefined' && FR_CHOICE_CONNECTING\)\) \{\n\s+BOARD_NO_ANSWER_SINCE = null;/,
    'a person who chose Connect is told "Kosmos requires a full restart" while it stops its board on purpose');
  assert.match(paint, /if \(frc && !frc\.hidden\) \{\n\s+frc\.hidden = true;\n\s+if \(typeof frChoiceInert === 'function'\) frChoiceInert\(false\);[\s\S]{0,160}\} \}\n\s+RESTART_SCREEN_RETURN = document\.activeElement;/,
    'a board that is really down leaves the first screen\'s buttons dead over it');
  assert.match(lift('frChoose'), /FR_CHOICE_CONNECTING = true;/);
});

test('#4356: a restart screen that clears without a reload gives back a first screen still waiting', () => {
  const paint = lift('paintRestartScreen');
  assert.match(paint, /if \(typeof FR_CHOICE_PENDING !== 'undefined' && FR_CHOICE_PENDING\) FR_CHOICE_HIDDEN_BY_RESTART = true;/);
  assert.match(paint, /if \(frc && FR_CHOICE_PENDING && typeof frChoiceInert === 'function'\) \{ frc\.hidden = false; frChoiceInert\(true\); \}/,
    'the board recovers and first run never opens: the choice it awaits is hidden for good');
  const choose = lift('frChoose');
  assert.match(choose, /FR_CHOICE_PENDING = true;\n\s+el\.hidden = false;/);
  assert.match(choose, /if \(mode !== 'connect' \|\| told\) FR_CHOICE_PENDING = false;/);
});

test('#4356: the restart screen, run for real: it hides a waiting first screen, and gives it back when the board answers', () => {
  // A small DOM: <body> with the board, the wizard and the first screen as its children. The restart
  // screen appends its own backdrop; the lifted functions are the page's, only their helpers stubbed.
  const mkEl = (id, extra = {}) => ({ nodeType: 1, id, hidden: false, inert: false, classList: { contains: () => false }, ...extra });
  const board = mkEl('grid'), wizard = mkEl('firstrun', { hidden: true }), frc = mkEl('fr-choice');
  const kids = [board, wizard, frc];
  let back = null;
  const doc = {
    body: { appendChild(n) { kids.push(n); } },
    documentElement: { classList: { add() {}, remove() {} } },
    activeElement: null,
    getElementById: (id) => kids.find((k) => k.id === id) || null,
    querySelector: (sel) => (sel === '.restart-back' ? (kids.includes(back) ? back : null) : null),
    querySelectorAll: (sel) => (sel === 'body > *' ? kids.slice() : sel === 'body > *:not(#fr-choice)' ? kids.filter((k) => k.id !== 'fr-choice') : []),
    createElement: () => {
      const holder = {};
      Object.defineProperty(holder, 'innerHTML', { set() {
        back = mkEl('restart-screen', { classList: { contains: (c) => c === 'restart-back' }, remove() { kids.splice(kids.indexOf(back), 1); },
          querySelector: () => ({ focus() {} }) });
        holder.firstElementChild = back;
      } });
      return holder;
    },
  };
  let now = 1000;
  const ctx = {
    document: doc, location: { protocol: 'http:', host: '127.0.0.1:1' }, Date: { now: () => now }, console: { info() {} },
    MutationObserver: undefined,
    offlineRemoteView: () => false, bakedVersion: () => '0.0.0', platformCopy: (k, mac) => mac, restartHowMac: () => '',
    asSentence: (s) => s, startKLoader() {},
  };
  vm.createContext(ctx);
  vm.runInContext([
    'var UPDATING_NOW = false, WORLDSW_SWITCHING = false, RESTART_SCREEN_AFTER_MS = 15000;',
    'var BOARD_NO_ANSWER_SINCE = null, RESTART_SCREEN_INERTED = [], RESTART_SCREEN_WATCH = null, RESTART_SCREEN_RETURN = null;',
    'var FR_CHOICE_WATCH = null, FR_CHOICE_INERTED = [], FR_CHOICE_CONNECTING = false, FR_CHOICE_PENDING = false, FR_CHOICE_HIDDEN_BY_RESTART = false;',
    lift('frChoiceHold'), lift('frChoiceInert'), lift('restartScreenInert'), lift('paintRestartScreen'),
  ].join('\n'), ctx);

  // The first screen is up and waiting (what frChoose does): pending, the page held.
  vm.runInContext('FR_CHOICE_PENDING = true; frChoiceInert(true);', ctx);
  assert.equal(board.inert, true);
  // The board stops answering, long enough for the restart screen.
  ctx.paintRestartScreen(true, false); now += 16000; ctx.paintRestartScreen(true, false);
  assert.ok(kids.includes(back), 'the restart screen did not show');
  assert.equal(frc.hidden, true, 'the first screen stays over a board that is down, its buttons dead');
  assert.equal(frc.inert, true, 'the restart screen does not hold the hidden first screen');
  assert.equal(vm.runInContext('FR_CHOICE_HIDDEN_BY_RESTART', ctx), true);
  // The board answers again, with no reload.
  ctx.paintRestartScreen(false, false);
  assert.ok(!kids.includes(back), 'the restart screen stayed');
  assert.equal(frc.hidden, false, 'THE FIRST SCREEN IS NOT GIVEN BACK: first run waits on it forever');
  assert.equal(frc.inert, false, 'the given-back first screen is still inert');
  assert.equal(board.inert, true, 'the board under the given-back first screen is live');
  assert.equal(vm.runInContext('FR_CHOICE_HIDDEN_BY_RESTART', ctx), false, 'the flag is stuck');

  // CONTROL: with no answer pending (answered before the restart screen), nothing comes back.
  vm.runInContext('frChoiceInert(false); FR_CHOICE_PENDING = false;', ctx);
  frc.hidden = true; board.inert = false; now += 1;
  ctx.paintRestartScreen(true, false); now += 16000; ctx.paintRestartScreen(true, false);
  ctx.paintRestartScreen(false, false);
  assert.equal(frc.hidden, true, 'an answered first screen came back');
  assert.equal(board.inert, false, 'the board stays held after the restart screen cleared');
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
