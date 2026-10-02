'use strict';
/**
 * kosmos#4812: the Agents view lists the agents of this account's OTHER computers, read by this browser from
 * each of them. These run the SHIPPED oa* functions from web/index.html (lifted, as web.computers-switcher-4648
 * does) against a fake document.
 *
 *   node --test web.allagents-4812.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { makeDom } = require('./test-support/fake-dom');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
function constLine(name) {
  const at = PAGE.indexOf('const ' + name + ' = ');
  assert.ok(at >= 0, name + ' moved or renamed');
  return PAGE.slice(at, PAGE.indexOf('\n', at) + 1);
}
const SRC = [
  constLine('OA_READ_LIMIT_MS'),
  'const OA_SEEN = new Map();\n',
  slice('computerAddressOk'),
  slice('agoWords'),
  slice('oaEligible'),
  slice('oaOthers'),
  slice('oaClassify'),
  slice('oaRemember'),
  slice('oaAgentsOf'),
  slice('oaAgentHref'),
  slice('oaReadOne'),
  slice('oaNote'),
  slice('oaCard'),
  slice('oaGroup'),
  slice('oaGridShown'),
  slice('oaPaintKey'),
].join('\n');

/* One sandbox per test: the page's functions, a fake document, a fake fetch, and a sortAgents stand-in that
   sorts by name (the real one needs half the page; that it is CALLED with this computer's sort is asserted). */
function load(fetchImpl) {
  const t = makeDom();
  const calls = { sort: [] };
  const api = new Function('document', 'fetch', 'calls', `
    const STATE_COPY = { working: { label: 'Working' }, idle: { label: 'Idle' } };
    const AGENT_SORT = 'name';
    function sortAgents(list, mode, projects) { calls.sort.push([mode, projects]); return list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))); }
    ${SRC}
    return { oaEligible, oaOthers, oaClassify, oaRemember, oaAgentHref, oaReadOne, oaNote, oaCard, oaGroup, oaGridShown, oaPaintKey, OA_SEEN };
  `)(t.document, fetchImpl || (async () => { throw new Error('no fetch in this test'); }), calls);
  return { api, calls, d: t };
}

const LIST = {
  ok: true,
  domain: 'kosmosplus.com',
  computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true },
    { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true, lastSeen: 1000 },
    { name: 'pizzarama', address: 'pizzarama.kosmosplus.com', this: false, online: false, lastSeen: 1000 },
    { name: 'evil', address: 'evil.example', this: false, online: true },
  ],
};
const at = (hostname, protocol = 'https:') => ({ hostname, protocol });

test('eligible only on this computer\'s own Kosmos+ address over https', () => {
  const { api } = load();
  assert.equal(api.oaEligible(LIST, at('laptop.kosmosplus.com')), true, 'control: this computer\'s own address');
  assert.equal(api.oaEligible(LIST, at('LAPTOP.kosmosplus.com')), true, 'a hostname is case-insensitive');
  assert.equal(api.oaEligible(LIST, at('127.0.0.1', 'http:')), false, 'the app\'s board cannot read a sibling');
  assert.equal(api.oaEligible(LIST, at('laptop.kosmosplus.com', 'http:')), false, 'not over http');
  assert.equal(api.oaEligible(LIST, at('agent1s.kosmosplus.com')), false, 'another computer\'s address is not this one');
  assert.equal(api.oaEligible({ ...LIST, ok: false }, at('laptop.kosmosplus.com')), false, 'no answer, no section');
  assert.equal(api.oaEligible({ ...LIST, computers: LIST.computers.map((c) => ({ ...c, this: false })) }, at('laptop.kosmosplus.com')), false, 'no row marked this');
});

test('the other computers are the account\'s valid rows other than this one', () => {
  const { api } = load();
  assert.deepEqual(api.oaOthers(LIST).map((c) => c.name), ['agent1s', 'pizzarama'], 'this and a bad address are dropped');
});

test('classify: an agents list, a gate, or no answer', () => {
  const { api } = load();
  assert.equal(api.oaClassify(200, { agents: [] }), 'ok', 'control');
  assert.equal(api.oaClassify(200, null), 'notin', 'a 200 that is not a status (the gate\'s sign-in page)');
  assert.equal(api.oaClassify(200, { agents: 'x' }), 'notin');
  assert.equal(api.oaClassify(401, { error: 'not signed in' }), 'notin');
  assert.equal(api.oaClassify(403, null), 'notin');
  assert.equal(api.oaClassify(502, null), 'out');
  assert.equal(api.oaClassify(undefined, null), 'out');
});

test('remember: unreachable keeps the last list to grey, not let in drops it', () => {
  const { api } = load();
  const seen = new Map();
  api.oaRemember(seen, 'a', 'ok', [{ sessionName: 's' }], 5);
  assert.deepEqual(api.oaRemember(seen, 'a', 'out', null, 9), { state: 'out', agents: [{ sessionName: 's' }], at: 5 });
  assert.deepEqual(api.oaRemember(seen, 'a', 'blocked', null, 10), { state: 'blocked', agents: [{ sessionName: 's' }], at: 5 });
  assert.deepEqual(api.oaRemember(seen, 'a', 'notin', null, 11), { state: 'notin', agents: null, at: null }, 'a browser no longer let in must not keep showing agents');
  assert.deepEqual(api.oaRemember(seen, 'a', 'out', null, 12), { state: 'out', agents: null, at: null }, 'nothing kept after a not-let-in');
});

test('read: asks that computer with this browser\'s credentials and keeps only real agents', async () => {
  const asked = [];
  const optsSeen = [];
  const { api } = load(async (url, opts) => {
    asked.push([url, opts.credentials, opts.mode]);
    optsSeen.push(opts);
    return { status: 200, json: async () => ({ agents: [{ sessionName: 'angel', name: 'Angel' }, { sessionName: 'g', isGuide: true }, { name: 'nosession' }, null] }) };
  });
  const r = await api.oaReadOne(LIST.computers[1]);
  assert.deepEqual(asked, [['https://agent1s.kosmosplus.com/api/status', 'include', 'cors']]);
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.agents.map((a) => a.sessionName), ['angel'], 'guides and rows with no session are dropped');
  /* A simple GET with no header and no body, so the browser sends no preflight (the relay refuses one). The browser
     check cannot prove this: Playwright answers an intercepted preflight itself. */
  const o = optsSeen[0];
  assert.equal(o.method === undefined || o.method === 'GET', true, 'GET');
  assert.equal(o.headers, undefined, 'no headers: any would make the browser send a preflight');
  assert.equal(o.body, undefined, 'no body');
  assert.deepEqual(Object.keys(o).sort(), ['cache', 'credentials', 'mode', 'signal'], 'nothing else rides along');
});

test('read: rows keep only three string fields, so a malformed one cannot reach this board\'s sort', async () => {
  const { api } = load(async () => ({ status: 200, json: async () => ({ agents: [
    { sessionName: 'a', name: 'Ann', state: 'idle', role: 42, runner: { x: 1 }, profile: null },
    { sessionName: 'b', name: { not: 'text' }, state: 7 },
  ] }) }));
  const r = await api.oaReadOne(LIST.computers[1]);
  assert.deepEqual(r.agents, [
    { sessionName: 'a', name: 'Ann', state: 'idle' },
    { sessionName: 'b', name: '', state: '' },
  ]);
});

test('read: no readable answer is blocked from an online computer, out from an offline one', async () => {
  const { api } = load(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal((await api.oaReadOne(LIST.computers[1])).state, 'blocked');
  assert.equal((await api.oaReadOne(LIST.computers[2])).state, 'out');
});

test('note: says which of the four it is, with this page\'s own last read for one not connected', () => {
  const { api } = load();
  const c = LIST.computers[2];
  const now = 1000 * 1000 + 3 * 3600 * 1000;
  assert.equal(api.oaNote(c, undefined, now), 'Reading its agents...');
  assert.equal(api.oaNote(c, { state: 'ok' }, now), '');
  assert.match(api.oaNote(c, { state: 'notin' }, now), /not let in on pizzarama/);
  const read = now - 3 * 3600 * 1000;
  assert.equal(api.oaNote(c, { state: 'out', agents: [{}], at: read }, now), 'Not connected, this page last read it 3 hours ago. Showing what this page last read.');
  assert.equal(api.oaNote(c, { state: 'out', agents: null, at: null }, now), 'Not connected.', 'the coordinator\'s lastSeen (refreshed daily) is never shown as a time');
  assert.equal(api.oaNote({ ...c, lastSeen: null }, { state: 'out', agents: null }, now), 'Not connected.', 'never a made-up time');
  assert.match(api.oaNote(LIST.computers[1], { state: 'blocked', agents: null }, now), /online but did not let this page read/);
});

test('cards: a link to the agent on ITS computer, built from the address, names as text', () => {
  const { api } = load();
  const c = LIST.computers[1];
  const card = api.oaCard({ sessionName: 'a b/<x>', name: '<img src=x onerror=alert(1)>', state: 'working' }, c, false);
  assert.equal(card.tagName, 'A');
  assert.equal(card.href, 'https://agent1s.kosmosplus.com/?agent=a%20b%2F%3Cx%3E');
  assert.equal(card.rel, 'noopener noreferrer');
  assert.equal(card.children[0].textContent, '<img src=x onerror=alert(1)>', 'kept as text');
  assert.equal(card.children[1].textContent, 'agent1s · Working');
  const off = api.oaCard({ sessionName: 's', name: 'S', state: 'working' }, c, true);
  assert.equal(off.tagName, 'DIV', 'a greyed card is not a link');
  assert.equal(off.className, 'oa-card oa-off');
  assert.equal(off.children[1].textContent, 'agent1s', 'no live state word on a stale card');
});

test('group: sorted with this board\'s sort, greyed when not current, gate shows no agents', () => {
  const { api, calls } = load();
  const c = LIST.computers[1];
  const two = [{ sessionName: 'z', name: 'Zed' }, { sessionName: 'a', name: 'Ann' }];
  const ok = api.oaGroup(c, { state: 'ok', agents: two }, 0);
  const cards = ok.querySelectorAll('.oa-card');
  assert.deepEqual(cards.map((x) => x.children[0].textContent), ['Ann', 'Zed']);
  assert.deepEqual(calls.sort[0], ['name', []], 'this board\'s sort, with no projects (they are this board\'s)');
  assert.ok(cards.every((x) => x.tagName === 'A'));
  const stale = api.oaGroup(c, { state: 'blocked', agents: two }, 0);
  assert.ok(stale.querySelectorAll('.oa-card').every((x) => x.className === 'oa-card oa-off'));
  const gate = api.oaGroup(c, { state: 'notin', agents: null }, 0);
  assert.equal(gate.querySelectorAll('.oa-card').length, 0);
  assert.equal(gate.querySelectorAll('.oa-open').length, 1, 'an Open link to sign in there');
  const out = api.oaGroup(LIST.computers[2], { state: 'out', agents: null }, 0);
  assert.equal(out.querySelectorAll('.oa-open').length, 0, 'no link to a computer that is not connected');
  const empty = api.oaGroup(c, { state: 'ok', agents: [] }, 0);
  assert.match(empty.textContent, /No agents on agent1s\./);
});

test('the section reads and shows only while the grid is on screen, a hidden holder included', () => {
  const { api, d } = load();
  const panel = d.add('panel-cons-agents');
  const grid = d.create('div');
  panel.appendChild(grid);
  assert.equal(api.oaGridShown(grid), true, 'control: shown');
  panel.hidden = true;
  assert.equal(api.oaGridShown(grid), false, 'the consolidated view hides its panel, not the grid');
  panel.hidden = false; grid.hidden = true;
  assert.equal(api.oaGridShown(grid), false);
  assert.equal(api.oaGridShown(null), false);
});

test('paint key: unchanged rounds give the same key, so focus is not taken off a card', () => {
  const { api } = load();
  const others = api.oaOthers(LIST);
  const seen = new Map([['agent1s.kosmosplus.com', { state: 'ok', agents: [{ sessionName: 'a', name: 'A', state: 'idle' }], at: 5 }]]);
  const k1 = api.oaPaintKey(others, seen, 10000, 'name');
  assert.equal(api.oaPaintKey(others, new Map(seen), 25000, 'name'), k1, 'a second round with the same answers repaints nothing');
  seen.set('agent1s.kosmosplus.com', { state: 'ok', agents: [{ sessionName: 'a', name: 'A', state: 'working' }], at: 25 });
  assert.notEqual(api.oaPaintKey(others, seen, 25000, 'name'), k1, 'a state change repaints');
  assert.notEqual(api.oaPaintKey(others, new Map(), 25000, 'name'), k1, 'a computer back to reading repaints');
  assert.notEqual(api.oaPaintKey(others, seen, 25000, 'role'), api.oaPaintKey(others, seen, 25000, 'name'), 'a sort change repaints');
});
