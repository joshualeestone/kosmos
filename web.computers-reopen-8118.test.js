'use strict';
/**
 * kosmos#8118 (Josh 11-06: "remembers the version of agents of the computer I was looking at"): at launch the Mac app
 * asks the page to go back to the computer the window was last on (computersReopen). These run the SHIPPED
 * computersReopen and computerAddressOk from web/index.html, with the switcher's list, the ticket path and the toast
 * stood in, and check each answer the app branches on (native-app reopenAnswerKeeps maps them): 'opening' only for a
 * computer the switcher itself would open; every other case stays home and says why.
 *
 *   node --test web.computers-reopen-8118.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
const REOPEN = (() => { const at = PAGE.indexOf('const COMPUTERS_REOPEN_MAX_MS = '); assert.ok(at >= 0, 'COMPUTERS_REOPEN_MAX_MS moved'); return PAGE.slice(at, PAGE.indexOf('\n', at) + 1); })() + slice('computersReopen');
const RE = slice('computerAddressOk') + slice('computersOpens') + slice('computersOlderSaid');

const DOMAIN = 'kosmosplus.com';
const MINI = { name: 'mini', address: 'mini.kosmosplus.com', online: true, instant: true };
const HERE = { name: 'laptop', address: 'laptop.kosmosplus.com', online: true, this: true };

/* The page's world for one reopen: what /api/remote/computers answers (or a throw), what is toasted, what is opened. */
function world(answer, { opening = false, during = null, hang = false } = {}) {
  const said = [];
  const opened = [];
  const listeners = {};
  const blurred = [];
  const document = {
    activeElement: { blur: () => { blurred.push(true); } },
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter((f) => f !== fn); },
  };
  const fetch = (url, opts) => {
    assert.equal(url, '/api/remote/computers', 'the reopen read something other than the switcher\'s list');
    if (during) for (const fn of (listeners[during.type || during] || [])) fn(typeof during === 'string' ? { type: during } : during);   // the person clicks or types while it is read
    if (hang) {
      return new Promise((_, rej) => { opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); });
    }
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ ok: true, json: async () => answer });
  };
  const early = [];
  // Round 3: the reopen says at once that it is going back; that toast is kept apart so each case checks its own.
  const msgToast = (t) => { (/^Going back to /.test(t) ? early : said).push(t); };   // 'Opening ...' lands in said
  const computersOpenWithTicket = (url, name, a) => { opened.push({ href: url.href, name, a }); };
  // eslint-disable-next-line no-new-func
  const run = new Function('fetch', 'msgToast', 'computersOpenWithTicket', 'computersOpening', 'document', 'setTimeout',
    RE + REOPEN + '\nreturn computersReopen;')(fetch, msgToast, computersOpenWithTicket, opening, document,
    hang ? (fn) => setTimeout(fn, 0) : setTimeout);   // a hung read meets the limit at once in the test
  return { run, said, opened, listeners, blurred, early };
}
const list = (computers, extra = {}) => ({ ok: true, domain: DOMAIN, computers, ...extra });

test('#8118: a computer the switcher would open is opened the same way (ticket path), by its own host', async () => {
  const w = world(list([HERE, MINI]));
  assert.equal(await w.run('Mini.KosmosPlus.com '), 'opening');
  assert.deepEqual(w.opened.map((o) => [o.href, o.name, o.a]), [['https://mini.kosmosplus.com/', 'mini', null]],
    'the reopen did not go through computersOpenWithTicket for that computer');
  assert.deepEqual(w.said, ['Opening mini...'], 'the "Going back" promise is not retired as the switch starts');
  assert.deepEqual(w.blurred, [true], 'the focused field kept focus while the ticket is made, so typing lands in it');
});

test('#8118: a computer no longer on the account is not opened, is said so, and the app is told to forget it', async () => {
  const w = world(list([HERE]));
  assert.equal(await w.run('mini.kosmosplus.com'), 'gone');
  assert.deepEqual(w.opened, []);
  assert.match(w.said.join('\n'), /is not on your Kosmos\+ account/);
});

test('#8118: this computer itself is home: nothing opened, staying said, the app forgets', async () => {
  const w = world(list([HERE, MINI]));
  assert.equal(await w.run('laptop.kosmosplus.com'), 'home');
  assert.deepEqual(w.opened, []);
  assert.deepEqual(w.said, ['Staying on this computer.'], 'the "Going back" toast is left up while the window stays');
});

test('#8118: signed out of Kosmos+ (or remote access off) stays home and says so, never a sign-in dead end', async () => {
  const w = world({ ok: false, signedIn: false });
  assert.equal(await w.run('mini.kosmosplus.com'), 'signed-out');
  assert.deepEqual(w.opened, []);
  assert.match(w.said.join('\n'), /signed out of Kosmos\+ or remote access is off/);
  assert.doesNotMatch(w.said.join('\n'), /top-left menu/, 'signed out, the menu has no computers to switch to');
});

test('#8118: off, updating, or unable to take the instant switch: stays home, names the computer, says why', async () => {
  for (const [row, want, words] of [
    [{ ...MINI, online: false }, 'offline', /mini is not connected/],
    [{ ...MINI, updating: true }, 'updating', /mini is updating/],
    [{ ...MINI, instant: false }, 'not-instant', /mini is on an older Kosmos/],
  ]) {
    const w = world(list([HERE, row]));
    assert.equal(await w.run('mini.kosmosplus.com'), want);
    assert.deepEqual(w.opened, [], want + ' opened the computer anyway');
    assert.match(w.said.join('\n'), words, want + ' did not say why: ' + w.said.join(' | '));
  }
});

test('#8118: a host under another domain is not this account\'s computer: gone, so the app forgets it', async () => {
  const w = world(list([HERE, { ...MINI, address: 'mini.example.com' }]));
  assert.equal(await w.run('mini.example.com'), 'gone');
  assert.deepEqual(w.opened, []);
});

test('#8118: the person clicks, types, scrolls, touches, drops or dictates while the list is read: no switch, staying said', async () => {
  for (const k of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'drop', 'input']) {
    const w = world(list([HERE, MINI]), { during: k });
    assert.equal(await w.run('mini.kosmosplus.com'), 'touched', k + ' did not stop the reopen');
    assert.deepEqual(w.opened, [], k + ': the window was pulled away while they worked here');
    assert.deepEqual(w.said, ['Staying on this computer.'], k + ': staying is not said');
    assert.deepEqual(Object.values(w.listeners).flat(), [], 'the listeners were left on the page');
  }
  // CONTROL: with no click, the same reopen opens, so the test can see the difference.
  assert.equal(await world(list([HERE, MINI])).run('mini.kosmosplus.com'), 'opening');
});

test('#8118: a list that does not answer in time stays home and says so', async () => {
  const w = world(null, { hang: true });
  assert.equal(await w.run('mini.kosmosplus.com'), 'slow');
  assert.deepEqual(w.opened, []);
  assert.match(w.said.join('\n'), /took too long to answer/);
});

test('#8118: when the list cannot be read, nothing opens', async () => {
  for (const [answer, host] of [
    [new Error('board not answering'), 'mini.kosmosplus.com'],
    [{ ok: false }, 'mini.kosmosplus.com'],
  ]) {
    const w = world(answer);
    assert.equal(await w.run(host), 'unknown');
    assert.deepEqual(w.opened, []);
    assert.match(w.said.join('\n'), /could not check your other computers/);
  }
  assert.equal(await world(list([HERE, MINI])).run(''), 'bad', 'an empty host should not even read the list');
});

test('#8118: a switch already under way is left alone', async () => {
  const w = world(list([HERE, MINI]), { opening: true });
  assert.equal(await w.run('mini.kosmosplus.com'), 'busy');
  assert.deepEqual(w.opened, []);
});

test('#8118: the click and the reopen share one switch AND one rule, so "what the switcher would open" cannot drift', () => {
  const click = slice('computersOpenClick');
  assert.match(click, /computersOpenWithTicket\(url, name, a\)/, 'the switcher click no longer goes through the shared switch');
  assert.match(click, /computersOlderSaid\(name, url\.host\)/, 'the click types its own older-Kosmos sentence again');
  assert.match(slice('computersOpenWithTicket'), /\/api\/remote\/open-ticket/, 'the shared switch no longer asks for a ticket');
  assert.match(slice('computersRender'), /const opens = computersOpens\(c\);/, 'the menu decides links by its own copy of the rule');
  assert.match(REOPEN, /if \(!computersOpens\(c\)\) \{ say\('Staying on this computer\.'\); return 'unknown'; \}/, 'the reopen no longer ends on the switcher\'s rule');
});

test('#8118: the shared rule decides last: a row the switcher would not link is never opened', async () => {
  // A field the reopen does not check by name (here, the rule tightened to need a name), seen through computersOpens.
  const w = world(list([HERE, MINI]));
  const tight = new Function('fetch', 'msgToast', 'computersOpenWithTicket', 'computersOpening', 'document', 'setTimeout',
    RE.replace('return !!c && c.this !== true', 'return !!c && c.name === "never" && c.this !== true') + REOPEN + '\nreturn computersReopen;')(
    async () => ({ ok: true, json: async () => list([HERE, MINI]) }), () => {}, () => { throw new Error('opened'); }, false, undefined, setTimeout);
  assert.equal(await tight('mini.kosmosplus.com'), 'unknown', 'a row the switcher would not link was opened');
  assert.equal(await w.run('mini.kosmosplus.com'), 'opening', 'CONTROL: with the shipped rule the same row opens');
});

test('#8118: the shared switch with no clicked link (a reopen) opens with a ticket and marks nothing', async () => {
  const OPENT = slice('computersOpenWithTicket');
  const went = [];
  let screen = null;
  const fetch = async (url, opts) => {
    assert.equal(url, '/api/remote/open-ticket');
    assert.deepEqual(JSON.parse(opts.body), { address: 'mini.kosmosplus.com' });
    return { ok: true, json: async () => ({ ticket: 'T'.repeat(24) }) };
  };
  // eslint-disable-next-line no-new-func
  const go = new Function('fetch', 'computersSwitchingScreen', 'computersGo', 'AbortController', 'setTimeout', 'clearTimeout',
    'let computersOpening = false;\n' + OPENT + '\nreturn (u, n, a) => { computersOpenWithTicket(u, n, a); return () => computersOpening; };')(
    fetch, (n) => { screen = n; }, (to) => { went.push(to); }, AbortController, setTimeout, clearTimeout);
  const opening = go(new URL('https://mini.kosmosplus.com/'), 'mini', null);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(screen, 'mini', 'the switching screen did not show for a reopen');
  assert.deepEqual(went, ['https://mini.kosmosplus.com/#kpt=' + 'T'.repeat(24)]);
  assert.equal(opening(), false, 'the switch did not settle');
});

test('#8118 (round 3): the reopen says at once where it is going and how to stay, before the list answers', async () => {
  const w = world(list([HERE, MINI]));
  const p = w.run('mini.kosmosplus.com');
  assert.deepEqual(w.early, ['Going back to mini, the computer you were looking at. Click, type or scroll here to stay on this computer.'],
    'nothing is said while the list is read, so the switch lands as a surprise');
  assert.equal(await p, 'opening');
});

test('#8118: the wait is the route\'s own limit (30 s, OA_COMPUTERS_LIMIT_MS), not shorter', () => {
  const v = (name) => Number((PAGE.match(new RegExp('const ' + name + ' = (\\d+);')) || [])[1]);
  assert.equal(v('COMPUTERS_REOPEN_MAX_MS'), 30000, 'the reopen limit changed');
  assert.ok(v('COMPUTERS_REOPEN_MAX_MS') >= v('OA_COMPUTERS_LIMIT_MS'), 'the reopen gives up before the route can answer');
});

test('#8118 (review 6): a modifier key alone is not a choice to stay', async () => {
  for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) {
    const w = world(list([HERE, MINI]), { during: { type: 'keydown', key } });
    assert.equal(await w.run('mini.kosmosplus.com'), 'opening', key + ' alone stopped the reopen');
  }
  // CONTROL: a real key does stop it.
  assert.equal(await world(list([HERE, MINI]), { during: { type: 'keydown', key: 'a' } }).run('mini.kosmosplus.com'), 'touched');
});

test('#8118 (review 7): staying is said the moment the person clicks, and the list read is let go', async () => {
  let aborted = false;
  const said = [];
  const listeners = {};
  const document = {
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter((f) => f !== fn); },
  };
  let release;
  const fetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => { aborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    release = () => resolve({ ok: true, json: async () => list([HERE, MINI]) });
  });
  const run = new Function('fetch', 'msgToast', 'computersOpenWithTicket', 'computersOpening', 'document', 'setTimeout',
    RE + REOPEN + '\nreturn computersReopen;')(fetch, (t) => said.push(t), () => { throw new Error('opened'); }, false, document, setTimeout);
  const p = run('mini.kosmosplus.com');
  listeners.pointerdown[0]({ type: 'pointerdown' });
  assert.ok(said.includes('Staying on this computer.'), 'staying is not said until the list answers');
  assert.equal(aborted, true, 'the list read is still waited on after the person chose to stay');
  assert.equal(await p, 'touched');
  assert.equal(said.filter((t) => t === 'Staying on this computer.').length, 1, 'staying is said twice');
  void release;
});
