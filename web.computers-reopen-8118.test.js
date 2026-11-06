'use strict';
/**
 * kosmos#8118 (Josh 11-06: "remembers the version of agents of the computer I was looking at"): at launch the Mac app
 * asks the page to go back to the computer the window was last on (computersReopen). These run the SHIPPED
 * computersReopen and computerAddressOk from web/index.html, with the switcher's list, the ticket path and the toast
 * stood in, and check each answer the app branches on: 'opening' only for a computer the switcher itself would open,
 * 'gone' and 'home' (the app forgets the host), and every other case stays home and says why.
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
const REOPEN = slice('computersReopen');
const RE = slice('computerAddressOk');

const DOMAIN = 'kosmosplus.com';
const MINI = { name: 'mini', address: 'mini.kosmosplus.com', online: true, instant: true };
const HERE = { name: 'laptop', address: 'laptop.kosmosplus.com', online: true, this: true };

/* The page's world for one reopen: what /api/remote/computers answers (or a throw), what is toasted, what is opened. */
function world(answer, { opening = false } = {}) {
  const said = [];
  const opened = [];
  const fetch = async (url) => {
    assert.equal(url, '/api/remote/computers', 'the reopen read something other than the switcher\'s list');
    if (answer instanceof Error) throw answer;
    return { ok: true, json: async () => answer };
  };
  const msgToast = (t) => { said.push(t); };
  const computersOpenWithTicket = (url, name, a) => { opened.push({ href: url.href, name, a }); };
  // eslint-disable-next-line no-new-func
  const run = new Function('fetch', 'msgToast', 'computersOpenWithTicket', 'computersOpening',
    RE + REOPEN + '\nreturn computersReopen;')(fetch, msgToast, computersOpenWithTicket, opening);
  return { run, said, opened };
}
const list = (computers, extra = {}) => ({ ok: true, domain: DOMAIN, computers, ...extra });

test('#8118: a computer the switcher would open is opened the same way (ticket path), by its own host', async () => {
  const w = world(list([HERE, MINI]));
  assert.equal(await w.run('Mini.KosmosPlus.com '), 'opening');
  assert.deepEqual(w.opened.map((o) => [o.href, o.name, o.a]), [['https://mini.kosmosplus.com/', 'mini', null]],
    'the reopen did not go through computersOpenWithTicket for that computer');
  assert.deepEqual(w.said, [], 'an opening reopen should say nothing; the switching screen shows');
});

test('#8118: a computer no longer on the account is not opened, is said so, and the app is told to forget it', async () => {
  const w = world(list([HERE]));
  assert.equal(await w.run('mini.kosmosplus.com'), 'gone');
  assert.deepEqual(w.opened, []);
  assert.match(w.said.join('\n'), /no longer on your Kosmos\+ account/);
});

test('#8118: this computer itself is home: nothing opened, nothing said, the app forgets', async () => {
  const w = world(list([HERE, MINI]));
  assert.equal(await w.run('laptop.kosmosplus.com'), 'home');
  assert.deepEqual(w.opened, []);
  assert.deepEqual(w.said, []);
});

test('#8118: signed out of Kosmos+ stays home and says so (never a sign-in dead end), and the host is kept', async () => {
  const w = world({ ok: false, signedIn: false });
  assert.equal(await w.run('mini.kosmosplus.com'), 'signed-out');
  assert.deepEqual(w.opened, []);
  assert.match(w.said.join('\n'), /signed out of Kosmos\+/);
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

test('#8118: when the list cannot be read, or the host is not this account\'s kind of address, nothing opens', async () => {
  for (const [answer, host] of [
    [new Error('board not answering'), 'mini.kosmosplus.com'],
    [{ ok: false }, 'mini.kosmosplus.com'],
    [list([HERE, MINI]), 'mini.example.com'],
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

test('#8118: the click and the reopen share one switch (computersOpenWithTicket), so they cannot drift', () => {
  const click = slice('computersOpenClick');
  assert.match(click, /computersOpenWithTicket\(url, name, a\)/, 'the switcher click no longer goes through the shared switch');
  assert.match(slice('computersOpenWithTicket'), /\/api\/remote\/open-ticket/, 'the shared switch no longer asks for a ticket');
});
