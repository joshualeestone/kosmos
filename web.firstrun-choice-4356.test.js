'use strict';

/**
 * #4356: the first screen asks whether this computer runs agents or connects to agents on another
 * computer.
 *
 * Josh's copy rule (on the card, 2026-09-28): the screen is the Kosmos logo, the heading "How would
 * you like to set up Kosmos on this computer?" and two buttons, "Run agents on this computer" and
 * "Connect to agents on another computer". Nothing else: no subtitle, disclaimer, helper line or
 * footer. So the first tests pin the screen's visible text as exactly those three strings, and the
 * logo as present. The rest lift the page's own functions and run them: when the screen shows, and
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

test('#4356: the first screen\'s visible text is exactly the heading and the two button labels', () => {
  assert.deepEqual(visibleText(screen()), [HEADING, RUN, CONNECT]);
});

test('#4356: the Kosmos logo is at the top, and nothing else is an image or carries hidden text', () => {
  const html = screen().replace(/<!--[\s\S]*?-->/g, '');
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  assert.equal(imgs.length, 1, 'the screen has ' + imgs.length + ' images; it has the logo and nothing else');
  assert.match(imgs[0], /src="\/icons\/kosmos-192\.png"/, 'the image is not the Kosmos logo');
  assert.ok(html.indexOf('<img') < html.indexOf('<h1'), 'the logo is not above the heading');
  // Text a person cannot see still reaches a screen reader, which is "extra text" by another road.
  assert.doesNotMatch(html, /class="[^"]*\bvh\b|aria-description|title="|placeholder=/, 'the screen carries text nobody sees');
  assert.match(html, /<h1 class="frc-title" id="frc-title">/);
});

test('#4356: the two buttons are the only controls, and each one\'s accessible name is its label', () => {
  const html = screen().replace(/<!--[\s\S]*?-->/g, '');
  const buttons = [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
  assert.deepEqual(buttons.map((b) => b[2].trim()), [RUN, CONNECT]);
  for (const [, attrs] of buttons) assert.doesNotMatch(attrs, /aria-label/, 'an aria-label would give a button a name that differs from its label');
  assert.deepEqual(buttons.map((b) => (b[1].match(/data-mode="([^"]*)"/) || [])[1]), ['run', 'connect']);
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

function world({ search = '', bridge = true, throws = false } = {}) {
  const posted = [];
  const btn = (mode) => ({ dataset: { mode }, disabled: false, onclick: null, focused: false, focus() { this.focused = true; } });
  const btns = [btn('run'), btn('connect')];
  const el = { hidden: true, querySelectorAll: () => btns };
  const cover = { hidden: false };
  const ctx = {
    location: { search },
    URLSearchParams,
    Promise,
    document: { getElementById: (id) => (id === 'fr-choice' ? el : id === 'boot-cover' ? cover : null) },
    window: { webkit: bridge ? { messageHandlers: { kosmosMode: { postMessage(m) { if (throws) throw new Error('no app'); posted.push(m); } } } } : undefined },
  };
  vm.createContext(ctx);
  vm.runInContext([lift('revealBoot'), lift('frChoiceBridge'), lift('frChoiceWanted'), lift('frChoose')].join('\n'), ctx);
  return { ctx, posted, btns, el, cover };
}

test('#4356: the screen shows only in the Mac app, and only when the app says no choice is stored', () => {
  assert.equal(world({ search: '?mode=unset' }).ctx.frChoiceWanted(false), true, 'a fresh Mac does not ask');
  assert.equal(world({ search: '?mode=unset' }).ctx.frChoiceWanted(true), false, 'a Mac that finished first run before this change would be asked again');
  assert.equal(world({ search: '?mode=unreadable' }).ctx.frChoiceWanted(true), true, 'an unreadable choice must ask again, never quietly become one');
  assert.equal(world({ search: '' }).ctx.frChoiceWanted(false), false, 'a Mac that has chosen is asked again');
  assert.equal(world({ search: '?mode=run' }).ctx.frChoiceWanted(false), false);
  assert.equal(world({ search: '?mode=unset', bridge: false }).ctx.frChoiceWanted(false), false, 'a browser shows a Connect button that cannot do anything');
});

test('#4356: Run agents tells the app "run", hides the screen and lets first run carry on', async () => {
  const w = world({ search: '?mode=unset' });
  const choice = w.ctx.frChoose();
  assert.equal(w.el.hidden, false, 'the screen did not show');
  assert.equal(w.cover.hidden, true, 'the boot cover stays over the screen');
  assert.equal(w.btns[0].focused, true, 'nothing has focus, so a keyboard user starts nowhere');
  w.btns[0].onclick();
  assert.equal(await choice, 'run');
  assert.deepEqual(w.posted, ['run']);
  assert.equal(w.el.hidden, true);
});

test('#4356: Connect tells the app "connect" and leaves the screen up, buttons off, while the app switches', async () => {
  const w = world({ search: '?mode=unset' });
  const choice = w.ctx.frChoose();
  w.btns[1].onclick();
  assert.equal(await choice, 'connect');
  assert.deepEqual(w.posted, ['connect']);
  assert.equal(w.el.hidden, false, 'the board would flash up under a Mac that is switching away from it');
  assert.ok(w.btns.every((b) => b.disabled), 'a second press could tell the app "run" mid-switch');
});

test('#4356: if the app cannot be told, Connect does nothing rather than leave dead buttons', async () => {
  const w = world({ search: '?mode=unset', throws: true });
  let settled = false;
  w.ctx.frChoose().then(() => { settled = true; });
  w.btns[1].onclick();
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, 'the page went on as if the Mac had switched');
  assert.ok(w.btns.every((b) => !b.disabled), 'the buttons are left disabled with nothing happening');
});

test('#4356: first run asks for the choice before the wizard, and a Connect ends it there', () => {
  const boot = lift('firstRunBoot');
  const ask = boot.indexOf("if (frChoiceWanted(state.done) && (await frChoose()) === 'connect') return;");
  assert.notEqual(ask, -1, 'firstRunBoot does not ask for the choice, or goes on after Connect');
  assert.ok(ask < boot.indexOf('if (state.done && !force) return;'), 'a Mac that finished first run with an unreadable choice is never asked');
  assert.ok(ask < boot.indexOf('frOpen();'), 'the wizard opens before the choice');
});
