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

/* The agent cards another computer's /api/status returns are the board's own cards, so these tests take REAL ones from
   test-support/fleet (fixture-discipline: a hand-written card can carry fields the producer never emits). `over` sets
   fields on a real card: a different name or state, or a hostile value another computer might send. */
const os = require('node:os');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'allagents-4812-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const fleet = require('./test-support/fleet');
const CARDS = new Map();
function card(name, over) {
  if (!CARDS.has(name)) {
    const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
    CARDS.set(name, board.agents[0]);
    fleet.restore();
  }
  return Object.assign(JSON.parse(JSON.stringify(CARDS.get(name))), over || {});
}

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
  constLine('OA_MAX_AGENTS'),
  constLine('OA_STALE_MS'),
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
  slice('oaStale'),
  slice('oaNote'),
  slice('oaCard'),
  slice('oaGroup'),
  slice('oaGridShown'),
  slice('oaHost'),
  slice('oaGroupKey'),
].join('\n');

/* One sandbox per test: the page's functions, a fake document, a fake fetch, and a sortAgents stand-in that
   sorts by name (the real one needs half the page; that it is CALLED with this computer's sort is asserted). */
function load(fetchImpl) {
  const t = makeDom();
  const calls = { sort: [] };
  const api = new Function('document', 'fetch', 'calls', 'OA_LISTED', `
    let OA_COMPUTERS = OA_LISTED;   // the reads keep only computers still on the list
    const STATE_COPY = { working: { label: 'Working' }, idle: { label: 'Idle' } };
    const AGENT_SORT = 'name';
    function sortAgents(list, mode, projects) { calls.sort.push([mode, projects]); return list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))); }
    ${SRC}
    return { oaEligible, oaOthers, oaClassify, oaRemember, oaAgentHref, oaReadOne, oaNote, oaCard, oaGroup, oaGridShown, oaHost, oaGroupKey, oaStale, OA_SEEN };
  `)(t.document, fetchImpl || (async () => { throw new Error('no fetch in this test'); }), calls, LIST);
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
  assert.equal(api.oaClassify(404, null), 'blocked', 'a connector without the route: signing in cannot fix it');
  assert.equal(api.oaClassify(405, { error: 'x' }), 'blocked');
  assert.equal(api.oaClassify(302, null), 'blocked');
  assert.equal(api.oaClassify(502, null), 'out');
  assert.equal(api.oaClassify(undefined, null), 'out');
});

test('remember: unreachable keeps the last list to grey, not let in drops it', () => {
  const { api } = load();
  const seen = new Map();
  const S = [card('s')];
  api.oaRemember(seen, 'a', 'ok', S, 5);
  assert.deepEqual(api.oaRemember(seen, 'a', 'out', null, 9), { state: 'out', agents: S, at: 5 });
  assert.deepEqual(api.oaRemember(seen, 'a', 'blocked', null, 10), { state: 'blocked', agents: S, at: 5 });
  assert.deepEqual(api.oaRemember(seen, 'a', 'notin', null, 11), { state: 'notin', agents: null, at: null }, 'a browser no longer let in must not keep showing agents');
  assert.deepEqual(api.oaRemember(seen, 'a', 'out', null, 12), { state: 'out', agents: null, at: null }, 'nothing kept after a not-let-in');
});

test('read: asks that computer with this browser\'s credentials and keeps only real agents', async () => {
  const asked = [];
  const optsSeen = [];
  const { api } = load(async (url, opts) => {
    asked.push([url, opts.credentials, opts.mode]);
    optsSeen.push(opts);
    return { status: 200, json: async () => ({ agents: [card('angel', { name: 'Angel' }), card('g', { isGuide: true }), { name: 'nosession' }, null] }) };
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
    card('a', { name: 'Ann', state: 'idle', role: 42, runner: { x: 1 }, profile: null }),
    card('b', { name: { not: 'text' }, state: 7 }),
  ] }) }));
  const r = await api.oaReadOne(LIST.computers[1]);
  /* The output is this page's own three-field row, not a card: exactly these keys, each a string. */
  assert.deepEqual(r.agents.map((a) => Object.keys(a).sort()), [['name', 'sessionName', 'state'], ['name', 'sessionName', 'state']],
    'a row kept a field other than the three this board sorts and paints');
  assert.deepEqual(r.agents.map((a) => [a.sessionName, a.name, a.state]), [['a', 'Ann', 'idle'], ['b', '', '']]);
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
  assert.match(api.oaNote(LIST.computers[1], { state: 'blocked', agents: null }, now), /online, but its agents cannot be read from here yet\. It may need the latest Kosmos\./);
});

test('cards: a link to the agent on ITS computer, built from the address, names as text', () => {
  const { api } = load();
  const c = LIST.computers[1];
  const el = api.oaCard(card('a b/<x>', { name: '<img src=x onerror=alert(1)>', state: 'working' }), c, false);
  assert.equal(el.tagName, 'A');
  assert.equal(el.href, 'https://agent1s.kosmosplus.com/?agent=a%20b%2F%3Cx%3E');
  assert.equal(el.rel, 'noopener noreferrer');
  assert.equal(el.children[0].textContent, '<img src=x onerror=alert(1)>', 'kept as text');
  assert.equal(el.children[1].textContent, 'agent1s · Working');
  const off = api.oaCard(card('s', { name: 'S', state: 'working' }), c, true);
  assert.equal(off.tagName, 'DIV', 'a greyed card is not a link');
  assert.equal(off.className, 'oa-card oa-off');
  assert.equal(off.children[1].textContent, 'agent1s', 'no live state word on a stale card');
});

test('group: sorted with this board\'s sort, greyed when not current, gate shows no agents', () => {
  const { api, calls } = load();
  const c = LIST.computers[1];
  const two = [card('z', { name: 'Zed' }), card('a', { name: 'Ann' })];
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

test('the section goes under the grid, else the list (a phone has no grid view), else nowhere', () => {
  const { api, d } = load();
  const grid = d.add('grid');
  const alist = d.add('alist');
  alist.hidden = true;
  assert.equal(api.oaHost(), grid, 'control: the grid view');
  grid.hidden = true; alist.hidden = false;
  assert.equal(api.oaHost(), alist, 'the list view (a phone through Kosmos+ has only this one)');
  alist.hidden = true;
  assert.equal(api.oaHost(), null, 'the org chart or another tab: nowhere, and nothing is read');
});

test('consolidated: #alist is the left rail, never a host; only the grid counts', () => {
  const { api, d } = load();
  const grid = d.add('grid');
  const alist = d.add('alist');
  d.document.body.classList.add('consolidated');
  grid.hidden = true; alist.hidden = false;   // a consolidated tab that is not Agents: the rail shows, the grid does not
  assert.equal(api.oaHost(), null, 'the rail is not the List view: nowhere, and nothing is read');
  grid.hidden = false;
  assert.equal(api.oaHost(), grid, 'control: the consolidated Agents view is the grid');
  d.document.body.classList.remove('consolidated');
  grid.hidden = true;
  assert.equal(api.oaHost(), alist, 'control: in the tab layout the same #alist IS the List view');
});

test('group key: unchanged rounds give the same key, so focus is not taken off a card', () => {
  const { api } = load();
  const c = LIST.computers[1];
  const A = card('a', { name: 'A', state: 'idle' }), B = card('b', { name: 'B', state: 'idle' });
  const k1 = api.oaGroupKey(c, { state: 'ok', agents: [A, B], at: 10000 }, 15000, 'name');
  assert.equal(api.oaGroupKey(c, { state: 'ok', agents: [A, B], at: 25000 }, 30000, 'name'), k1, 'a second round with the same answer');
  assert.equal(api.oaGroupKey(c, { state: 'ok', agents: [B, A], at: 25000 }, 30000, 'name'), k1, 'the other computer\'s own order is not what is shown');
  assert.notEqual(api.oaGroupKey(c, { state: 'ok', agents: [A, { ...B, state: 'working' }], at: 25000 }, 30000, 'name'), k1, 'a state change');
  assert.notEqual(api.oaGroupKey(c, undefined, 30000, 'name'), k1, 'back to reading');
  assert.notEqual(api.oaGroupKey(c, { state: 'ok', agents: [A, B], at: 25000 }, 30000, 'role'), k1, 'a sort change');
  // Not connected with a kept list: the note's time words change every round, the key must not.
  const out = (now) => api.oaGroupKey(c, { state: 'out', agents: [A], at: 1000 }, now, 'name');
  assert.equal(out(50000), out(65000), 'time words are written in place, not by a rebuild');
  assert.notEqual(api.oaNote(c, { state: 'out', agents: [A], at: 1000 }, 50000), api.oaNote(c, { state: 'out', agents: [A], at: 1000 }, 200000), 'control: the words do change');
});

test('stale: a list read longer ago than two rounds shows greyed, never as current', () => {
  const { api } = load();
  const c = LIST.computers[1];
  const two = [card('z', { name: 'Zed', state: 'working' }), card('a', { name: 'Ann', state: 'idle' })];
  const fresh = api.oaGroup(c, { state: 'ok', agents: two, at: 100000 }, 110000);
  assert.ok(fresh.querySelectorAll('.oa-card').every((x) => x.tagName === 'A'), 'control: a fresh list is live links');
  const old = api.oaGroup(c, { state: 'ok', agents: two, at: 100000 }, 100000 + 30 * 60000);
  assert.ok(old.querySelectorAll('.oa-card').every((x) => x.className === 'oa-card oa-off'), 'a 30-minute-old list is greyed');
  assert.match(old.textContent, /Reading its agents\.\.\. Showing what this page last read\./);
  assert.equal(api.oaStale({ state: 'ok', at: 0 }, 30000), false, 'exactly two rounds is still current');
  assert.equal(api.oaStale({ state: 'ok', at: 0 }, 30001), true);
  assert.notEqual(api.oaGroupKey(c, { state: 'ok', agents: two, at: 100000 }, 110000, 'name'),
    api.oaGroupKey(c, { state: 'ok', agents: two, at: 100000 }, 100000 + 30 * 60000, 'name'), 'going stale repaints');
});

/* oaPaint itself, against a fake #oa-wrap / #grid / #oa-groups: the per-group repaint, the in-place note and focus. */
function loadPaint() {
  const t = makeDom();
  const grid = t.add('grid');
  const wrap = t.add('oa-wrap'); wrap.hidden = true;
  t.add('oa-only', 'input', { type: 'checkbox' });
  t.add('oa-title', 'h2', { tabIndex: -1 });
  wrap.appendChild(t.add('oa-groups'));
  // The page's markup order: the grid, then the section (oaPaint moves the section only when it is not right under
  // the view on screen, so a section already there keeps focus inside it).
  const page = t.create('div'); page.append(grid, wrap);
  const timers = [];
  const clock = { now: 1000000 };
  const api = new Function('document', 'location', 'setTimeout', 'Date', `
    const STATE_COPY = { working: { label: 'Working' }, idle: { label: 'Idle' } };
    const AGENT_SORT = 'name';
    function sortAgents(list) { return list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))); }
    let OA_BUSY = false, OA_WAS_SHOWN = false, OA_PAINTED = [], OA_TIMER = 1;
    let OA_COMPUTERS = null;
    function oaRound() {}
    ${SRC}
    ${slice('oaThisOnly')}
    ${slice('oaReplaceGroup')}
    ${slice('oaFocusSaved')}
    ${slice('oaFocusBack')}
    ${slice('oaPaint')}
    return { oaPaint, OA_SEEN, set computers(v) { OA_COMPUTERS = v; }, set busy(v) { OA_BUSY = v; }, set timer(v) { OA_TIMER = v; } };
  `)(t.document, { hostname: 'laptop.kosmosplus.com', protocol: 'https:' }, (fn) => timers.push(fn), { now: () => clock.now });
  return { api, d: t, grid, wrap, page, groups: t.document.getElementById('oa-groups'), timers, clock };
}

test('paint: an unchanged round keeps every group element, so focus stays on its card', () => {
  const { api, d, groups } = loadPaint();
  api.computers = LIST;
  const A = card('a', { name: 'Ann', state: 'idle' });
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [A], at: 1000000 });
  api.oaPaint();
  const first = groups.children.slice();
  assert.equal(first.length, 2, 'control: one group per other computer');
  first[0].querySelector('.oa-card').focus();
  api.oaPaint();
  assert.ok(groups.children.every((g, i) => g === first[i]), 'no group rebuilt');
  assert.equal(d.focused(), first[0].querySelector('.oa-card'), 'focus untouched');
});

test('paint: the section sits right under the List view when the list is the view on screen, and does not move again', () => {
  const { api, d, grid, wrap, page } = loadPaint();
  api.computers = LIST;
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [card('a', { name: 'Ann', state: 'idle' })], at: 1000000 });
  const alist = d.add('alist'); page.append(alist);   // markup order now: grid, section, list
  api.oaPaint();
  assert.equal(wrap.previousElementSibling, grid, 'control: under the grid while the grid is on screen');
  assert.equal(wrap.hidden, false, 'control: shown');
  grid.hidden = true;   // the List view (on a phone the only one, #4823)
  api.oaPaint();
  assert.equal(wrap.previousElementSibling, alist, 'moved right under the list');
  assert.deepEqual(page.children, [grid, alist, wrap]);
  assert.equal(wrap.hidden, false, 'still shown under the list');
  const card0 = wrap.querySelector('.oa-card'); card0.focus();
  api.oaPaint();
  assert.equal(d.focused(), card0, 'already under the list: not moved, so focus stays');
});

test('paint: only the changed group is replaced, and focus goes back to the same agent', () => {
  const { api, d, groups } = loadPaint();
  api.computers = LIST;
  const A = card('a', { name: 'Ann', state: 'idle' }), B = card('b', { name: 'Bo', state: 'idle' });
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [A, B], at: 1000000 });
  api.oaPaint();
  const [g1, g2] = groups.children;
  g1.querySelectorAll('.oa-card')[1].focus();   // Bo
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [{ ...A, state: 'working' }, B], at: 1000000 });
  api.oaPaint();
  assert.notEqual(groups.children[0], g1, 'the changed group is rebuilt');
  assert.equal(groups.children[1], g2, 'the other group is not');
  const f = d.focused();
  assert.equal(f && f.dataset.session, 'b', 'focus is back on Bo in the new group');
  assert.equal(f.closest('.oa-group'), groups.children[0]);
});

test('paint: a not-connected note\'s time words change in place, the group stays', () => {
  const { api, groups, clock } = loadPaint();
  api.computers = LIST;
  api.OA_SEEN.set('pizzarama.kosmosplus.com', { state: 'out', agents: [card('p', { name: 'P', state: 'idle' })], at: 1000000 - 120000 });
  api.oaPaint();
  const g = groups.children[1];
  const note = () => g.querySelector('.oa-head').querySelector('.oa-note').textContent;
  assert.match(note(), /last read it 2 minutes ago/);
  clock.now += 5 * 60000;
  api.oaPaint();
  assert.equal(groups.children[1], g, 'same element');
  assert.match(note(), /last read it 7 minutes ago/, 'the words moved on');
});

test('paint: coming back on screen asks for a read at once, even before the computers are known', () => {
  const { api, grid, timers } = loadPaint();
  grid.hidden = true;
  api.oaPaint();
  assert.equal(timers.length, 0, 'control: nothing while off screen');
  grid.hidden = false;
  api.oaPaint();
  assert.equal(timers.length, 1, 'a read is started on return, with no computers list yet');
  api.oaPaint();
  assert.equal(timers.length, 1, 'once, not on every paint');
});

test('paint: focus on a card that goes stale falls back to the Open link, never to the page', () => {
  const { api, d, groups, clock } = loadPaint();
  api.computers = LIST;
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [card('a', { name: 'Ann', state: 'idle' })], at: 1000000 });
  api.oaPaint();
  groups.children[0].querySelector('.oa-card').focus();
  assert.equal(d.focused().tagName, 'A', 'control: on the live link');
  clock.now += 60000;   // past OA_STALE_MS: the cards become greyed divs
  api.oaPaint();
  assert.equal(groups.children[0].querySelector('.oa-card').tagName, 'DIV', 'control: the card can no longer take focus');
  assert.equal(d.focused() && d.focused().tagName, 'A', 'the Open link takes it (still shown for a stale list)');
  assert.equal(d.focused().className, 'oa-open');
});

test('paint: focus on Open for a computer that goes offline lands on its group', () => {
  const { api, d, groups } = loadPaint();
  api.computers = LIST;
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [], at: 1000000 });
  api.oaPaint();
  groups.children[0].querySelector('.oa-open').focus();
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'out', agents: null, at: null });
  api.oaPaint();
  assert.equal(groups.children[0].querySelectorAll('.oa-open').length, 0, 'control: no Open link for an offline computer');
  assert.equal(d.focused(), groups.children[0], 'the group itself');
});

test('paint: a computer added rebuilds every group, and focus follows its computer', () => {
  const { api, d, groups } = loadPaint();
  api.computers = LIST;
  api.OA_SEEN.set('pizzarama.kosmosplus.com', { state: 'ok', agents: [card('p', { name: 'P', state: 'idle' })], at: 1000000 });
  api.oaPaint();
  groups.children[1].querySelector('.oa-card').focus();
  api.computers = { ...LIST, computers: [...LIST.computers, { name: 'zed', address: 'zed.kosmosplus.com', this: false, online: true }] };
  api.oaPaint();
  assert.equal(groups.children.length, 3, 'control: rebuilt with the new computer');
  const f = d.focused();
  assert.equal(f && f.dataset.session, 'p', 'back on P');
  assert.equal(f.closest('.oa-group'), groups.children[1]);
});

test('paint: no read on return while a round runs, or before oaStart', () => {
  const a = loadPaint();
  a.grid.hidden = true; a.api.oaPaint(); a.api.busy = true; a.grid.hidden = false; a.api.oaPaint();
  assert.equal(a.timers.length, 0, 'a round already running will paint it');
  const b = loadPaint();
  b.api.timer = null; b.grid.hidden = true; b.api.oaPaint(); b.grid.hidden = false; b.api.oaPaint();
  assert.equal(b.timers.length, 0, 'oaStart has not run (first run): nothing is read');
});

test('stale line: a list refreshed by the last round is not stale at the next round', () => {
  const cut = Number(/OA_READ_LIMIT_MS = (\d+)/.exec(PAGE)[1]);
  const tick = Number(/OA_STATUS_EVERY_MS = (\d+)/.exec(PAGE)[1]);
  const stale = Number(/OA_STALE_MS = (\d+)/.exec(PAGE)[1]);
  assert.ok(stale > tick + cut, 'OA_STALE_MS ' + stale + ' must exceed a round (' + tick + ') plus a read cut (' + cut + ')');
  // That the reads do not wait on the refresh is driven, not read off the source: see the "round:" tests.
});

test('paint: the same count but a different computer rebuilds, so focus never lands on another computer\'s agent', () => {
  const { api, d, groups } = loadPaint();
  const two = (names) => ({ ...LIST, computers: [LIST.computers[0], ...names.map((n) => ({ name: n, address: n + '.kosmosplus.com', this: false, online: true }))] });
  api.computers = two(['agent1s', 'pizzarama']);
  const angel = [card('angel', { name: 'Angel', state: 'idle' })];
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: angel, at: 1000000 });
  api.OA_SEEN.set('pizzarama.kosmosplus.com', { state: 'ok', agents: angel, at: 1000000 });
  api.oaPaint();
  groups.children[0].querySelector('.oa-card').focus();   // angel on agent1s
  api.computers = two(['pizzarama', 'zeta']);             // agent1s gone, zeta added: still two
  api.oaPaint();
  assert.deepEqual(groups.children.map((g) => g.dataset.address), ['pizzarama.kosmosplus.com', 'zeta.kosmosplus.com'], 'control: rebuilt in the new places');
  const f = d.focused();
  assert.notEqual(f && f.closest && f.closest('.oa-group'), groups.children[0], 'not on pizzarama\'s angel');
  assert.equal(f && f.id, 'oa-title', 'its computer is gone: the section\'s title');
});

test('paint: focus on a group itself stays on the group when it is rebuilt', () => {
  const { api, d, groups } = loadPaint();
  api.computers = LIST;
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [], at: 1000000 });
  api.oaPaint();
  groups.children[0].focus();
  api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: [card('a', { name: 'A', state: 'idle' })], at: 1000000 });
  api.oaPaint();
  assert.equal(d.focused(), groups.children[0], 'the new group, not its Open link');
});

/* oaRound and oaRefreshComputers themselves, with a fetch the test controls. */
function loadRound(computersAnswer, siblingAnswer) {
  const t = makeDom();
  const grid = t.add('grid');
  const wrap = t.add('oa-wrap');
  t.add('oa-only', 'input', { type: 'checkbox' });
  wrap.appendChild(t.add('oa-groups'));
  const asked = [];
  const fetchImpl = (url) => {
    asked.push(url);
    if (url === '/api/remote/computers') return computersAnswer();
    if (siblingAnswer) { const own = siblingAnswer(url); if (own) return own; }
    return Promise.resolve({ status: 200, json: async () => ({ agents: [card('a', { name: 'A', state: 'idle' })] }) });
  };
  t.document.hidden = false;
  const api = new Function('document', 'location', 'fetch', 'setTimeout', 'clearTimeout', `
    const STATE_COPY = {};
    const AGENT_SORT = 'name';
    function sortAgents(list) { return list.slice(); }
    ${constLine('OA_COMPUTERS_EVERY_MS')}${constLine('OA_COMPUTERS_LIMIT_MS')}
    let OA_BUSY = false, OA_WAS_SHOWN = true, OA_PAINTED = [], OA_TIMER = 1, OA_AGAIN = false, OA_REFRESHING = false;
    let OA_COMPUTERS = null, OA_COMPUTERS_AT = 0;
    ${SRC}
    ${slice('oaThisOnly')}
    ${slice('oaReplaceGroup')}
    ${slice('oaFocusSaved')}
    ${slice('oaFocusBack')}
    ${slice('oaPaint')}
    ${slice('oaRefreshComputers')}
    ${slice('oaRound')}
    const realFetch = fetch;
    function readOneHeld(hold) { fetch = () => new Promise(hold); const p = oaReadOne(LISTED); fetch = realFetch; return p; }
    const LISTED = { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true };
    return { oaRound, OA_SEEN, readOneHeld, get busy() { return OA_BUSY; }, get computers() { return OA_COMPUTERS; },
      set computers(v) { OA_COMPUTERS = v; }, set at(v) { OA_COMPUTERS_AT = v; } };
  `)(t.document, { hostname: 'laptop.kosmosplus.com', protocol: 'https:' }, fetchImpl, () => 0, () => {});
  return { api, asked, grid, groups: t.document.getElementById('oa-groups') };
}

// A timeout, so a round that waits on the hung refresh FAILS here rather than hanging the suite.
test('round: a computers refresh that never answers holds up neither the reads nor the next tick', { timeout: 2000 }, async () => {
  const { api, asked } = loadRound(() => new Promise(() => {}));   // hangs
  api.computers = LIST; api.at = 0;   // known, but due for a refresh
  await api.oaRound();
  const reads = () => asked.filter((u) => u.endsWith('/api/status')).length;
  assert.equal(asked.filter((u) => u === '/api/remote/computers').length, 1, 'control: the refresh was asked for');
  assert.equal(reads(), 2, 'both other computers read while it hangs');
  assert.equal(api.busy, false, 'the round ended without it');
  api.at = 0;   // due again, while the first refresh still hangs
  await api.oaRound();
  assert.equal(reads(), 4, 'the next tick reads again');
  assert.equal(asked.filter((u) => u === '/api/remote/computers').length, 1, 'and does not pile up a second refresh');
});

test('round: a known list is not refreshed while "This computer only" is ticked; unticked it is', { timeout: 2000 }, async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let only = '1';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true,
    value: { getItem: (k) => (k === 'kosmos.agents.thisOnly' ? only : null), setItem() {}, removeItem() {} } });
  try {
    const { api, asked } = loadRound(async () => ({ ok: true, json: async () => LIST }));
    const refreshes = () => asked.filter((u) => u === '/api/remote/computers').length;
    api.computers = LIST; api.at = 0;   // known, and due for a refresh
    await api.oaRound();
    assert.equal(refreshes(), 0, 'ticked: the route that probes every computer is not asked');
    assert.equal(asked.length, 0, 'and no other computer is read');
    only = null;   // CONTROL: unticked, the same due list is refreshed
    await api.oaRound();
    assert.equal(refreshes(), 1, 'unticked: the refresh runs');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
});

test('round: the first round waits for the list, then reads; a computer dropped from it is forgotten', { timeout: 2000 }, async () => {
  const { api, asked } = loadRound(async () => ({ ok: true, json: async () => ({ ...LIST, computers: LIST.computers.filter((c) => c.name !== 'pizzarama') }) }));
  api.OA_SEEN.set('pizzarama.kosmosplus.com', { state: 'out', agents: [card('old')], at: 1 });
  await api.oaRound();
  assert.equal(asked[0], '/api/remote/computers', 'the list first');
  assert.deepEqual(asked.slice(1), ['https://agent1s.kosmosplus.com/api/status'], 'then the one other valid computer');
  assert.equal(api.OA_SEEN.has('pizzarama.kosmosplus.com'), false, 'a computer off the list starts as new if it comes back');
});

test('read: a read that lands after its computer left the list is not kept', { timeout: 2000 }, async () => {
  let land;
  const t = loadRound(async () => ({ ok: true, json: async () => LIST }));
  t.api.computers = LIST;
  // Hold agent1s's read open, drop agent1s from the list, then let the read land.
  const r = t.api.readOneHeld((resolve) => { land = resolve; });
  t.api.computers = { ...LIST, computers: LIST.computers.filter((c) => c.name !== 'agent1s') };
  land({ status: 200, json: async () => ({ agents: [card('a', { name: 'A', state: 'idle' })] }) });
  await r;
  assert.equal(t.api.OA_SEEN.has('agent1s.kosmosplus.com'), false, 'not written back');
  t.api.computers = LIST;
  const kept = t.api.readOneHeld((resolve) => resolve({ status: 200, json: async () => ({ agents: [] }) }));
  await kept;
  assert.equal(t.api.OA_SEEN.get('agent1s.kosmosplus.com').state, 'ok', 'control: still listed, kept');
});

test('round: each group paints as its own read lands, not when the slowest computer gives up', { timeout: 2000 }, async () => {
  const t = loadRound(async () => ({ ok: true, json: async () => LIST }),
    (url) => (url.startsWith('https://pizzarama.') ? new Promise(() => {}) : null));   // pizzarama never answers
  t.api.computers = LIST; t.api.at = Date.now();
  const round = t.api.oaRound();   // not awaited: it waits on pizzarama
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const g = t.groups.children.find((x) => x.dataset.address === 'agent1s.kosmosplus.com');
  assert.ok(g && g.querySelectorAll('.oa-card').length === 1, 'agent1s shows its agent while pizzarama is still out');
  assert.equal(t.api.busy, true, 'control: the round is still running');
  void round;
});

test('read: a runaway list from another computer is cut to the first OA_MAX_AGENTS', async () => {
  const many = Array.from({ length: 2000 }, (_, i) => { const c = card('s0', { name: 'N' + i, state: 'idle' }); c.sessionName = 's' + i; return c; });
  const { api } = load(async () => ({ status: 200, json: async () => ({ agents: many }) }));
  const r = await api.oaReadOne(LIST.computers[1]);
  assert.equal(r.agents.length, 500);
});

test('read: a body cut off mid-read on an ONLINE computer is not connected (list kept), only a non-JSON body is the gate', async () => {
  const cut = load(async () => ({ status: 200, json: async () => { throw new TypeError('network error'); } }));
  const KEPT = [card('a')];
  cut.api.OA_SEEN.set('agent1s.kosmosplus.com', { state: 'ok', agents: KEPT, at: 5 });
  assert.equal(LIST.computers[1].online, true, 'control: the board says it is online');
  const r = await cut.api.oaReadOne(LIST.computers[1]);
  assert.equal(r.state, 'out', 'the headers came through: neither a sign-in prompt nor a refusal');
  assert.deepEqual(r.agents, KEPT, 'the last good list is kept');
  const gate = load(async () => ({ status: 200, json: async () => JSON.parse('<html>sign in</html>') }));
  assert.equal((await gate.api.oaReadOne(LIST.computers[1])).state, 'notin', 'control: a gate page that is not JSON');
});

test('note: a greyed list from a refusing computer says when this page last read it', () => {
  const { api } = load();
  const now = 10 * 3600 * 1000;
  assert.equal(api.oaNote(LIST.computers[1], { state: 'blocked', agents: [{}], at: now - 3 * 3600 * 1000 }, now),
    'agent1s is online, but its agents cannot be read from here yet. It may need the latest Kosmos. Showing what this page last read. This page last read it 3 hours ago.');
});

test('round: with no list known, the computers route is still asked at most once a minute', { timeout: 2000 }, async () => {
  const { api, asked } = loadRound(async () => ({ ok: true, json: async () => ({ signedIn: false }) }));
  await api.oaRound();
  assert.equal(api.computers, null, 'control: signed out, no list');
  await api.oaRound(); await api.oaRound();
  assert.equal(asked.filter((u) => u === '/api/remote/computers').length, 1, 'not on every 15 s tick');
});
