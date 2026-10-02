// Browser-check-surface: oa-wrap oa-groups oa-only grid
'use strict';

/**
 * kosmos#4812: the Agents view lists the agents of this account's OTHER computers, read by this browser from each.
 *
 * Harness: the real board, but the PAGE is served at https://laptop.kosmosplus.com (Playwright answers that origin
 * from the board on loopback, so no certificate is involved), because the section exists only on a page served
 * from this computer's own Kosmos+ address over https. The other computers are Playwright routes:
 *   agent1s    answers its /api/status with two agents and the CORS pair for laptop's origin (the relay half's answer)
 *   mortals    answers 401 with the CORS pair (its gate: this browser is not let in there)
 *   pizzarama  never answers (not connected; the board's own probe said offline)
 * These routes add the CORS pair themselves (and Playwright's route.fulfill may supply its own), so agent1s being
 * read here proves the page's side only. The credentialed CORS answer itself is covered by the relay's own tests.
 *
 * Controls:
 *   A. the Mac's own window (http://127.0.0.1): no section, and not one request to another computer;
 *   B. agent1s stops being readable while online: its last list stays, greyed, not links;
 *   C. agent1s then answers its gate: the kept list is DROPPED (a device not let in sees none of its agents).
 * The consolidated layout (S4): the section moves with the grid into the Agents view's panel, shows only while that
 * view is open, reads nothing while it is closed, and goes back under the grid in the tab view.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-allagents-4812.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-oa-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chkAll(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const HOME = 'https://laptop.kosmosplus.com';
const NOW = Math.floor(Date.now() / 1000);
const COMPUTERS = {
  ok: true,
  domain: 'kosmosplus.com',
  computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true, updating: false, lastSeen: NOW },
    { name: 'agent1s', address: 'agent1s.kosmosplus.com', this: false, online: true, updating: false, lastSeen: NOW },
    { name: 'mortals', address: 'mortals.kosmosplus.com', this: false, online: true, updating: false, lastSeen: NOW },
    { name: 'pizzarama', address: 'pizzarama.kosmosplus.com', this: false, online: false, updating: false, lastSeen: NOW - 3 * 3600 },
  ],
};
const HOSTILE = '<img src=x onerror="window.__oaPwned=1">';
const SIBLING_AGENTS = { agents: [
  { sessionName: 'angel', name: 'Angel', state: 'working' },
  { sessionName: 'evil one', name: HOSTILE, state: 'idle' },
  { sessionName: 'guide', name: 'Guide', isGuide: true },
] };
const cors = { 'access-control-allow-origin': HOME, 'access-control-allow-credentials': 'true', vary: 'Origin', 'content-type': 'application/json' };

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const port = server.address().port;
  // Both engines: phones and the Mac's Safari are WebKit, the rest mostly Chromium.
  for (const [ENGINE, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: process.env.HEADED === '0' });
  const elsewhere = [];   // requests to any OTHER computer, for control A
  const preflights = [];  // CORS preflights sent to another computer: the page must send none
  let agent1sMode = 'ok';
  const chk = (ok, label, extra) => chkAll(ok, ENGINE + ' ' + label, extra);
  const fresh = async (opts) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
    await ctx.route('https://laptop.kosmosplus.com/**', async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/remote/computers') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMPUTERS) });
      const resp = await route.fetch({ url: 'http://127.0.0.1:' + port + u.pathname + u.search });
      return route.fulfill({ response: resp });
    });
    /* The relay has no OPTIONS answer for the sibling route: a preflight meets the gate with no CORS pair
       (kosmos-relay docs/relay-request-auth.md). So a read that needs one must FAIL here too, as it would live. */
    const preflight = (route) => route.request().method() === 'OPTIONS' && (preflights.push(route.request().url()), route.fulfill({ status: 403, body: 'gate' }));
    await ctx.route('https://agent1s.kosmosplus.com/**', (route) => {
      if (preflight(route)) return undefined;
      elsewhere.push(route.request().url());
      if (agent1sMode === 'gone') return route.abort();
      if (agent1sMode === 'gate') return route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ error: 'not signed in' }) });
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(SIBLING_AGENTS) });
    });
    await ctx.route('https://mortals.kosmosplus.com/**', (route) => {
      if (preflight(route)) return undefined;
      elsewhere.push(route.request().url());
      return route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ error: 'not signed in' }) });
    });
    await ctx.route('https://pizzarama.kosmosplus.com/**', (route) => { elsewhere.push(route.request().url()); return route.abort(); });
    const page = await ctx.newPage();
    return { ctx, page };
  };
  const settle = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
  const read = (page) => page.evaluate(() => {
    const wrap = document.getElementById('oa-wrap');
    const groups = [...document.querySelectorAll('#oa-groups .oa-group')].map((g) => ({
      name: (g.querySelector('.oa-badge') || {}).textContent || '',
      note: [...g.querySelectorAll('.oa-note')].map((n) => n.textContent).join(' | '),
      open: (g.querySelector('.oa-open') || {}).href || null,
      cards: [...g.querySelectorAll('.oa-card')].map((c) => ({ tag: c.tagName, cls: c.className, href: c.href || null, name: (c.querySelector('.oa-name') || {}).textContent, sub: (c.querySelector('.oa-sub') || {}).textContent })),
    }));
    return { shown: !!wrap && !wrap.hidden, groupsHidden: document.getElementById('oa-groups').hidden, only: document.getElementById('oa-only').checked, groups, pwned: !!window.__oaPwned, imgs: document.querySelectorAll('#oa-groups img').length };
  });
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 }).then(() => true, () => false);
  try {
    // ---- The section, served from this computer's own Kosmos+ address.
    {
      const { ctx, page } = await fresh();
      await page.goto(HOME + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      const landed = await until(page, () => document.querySelectorAll('#oa-groups .oa-card').length >= 2);
      const r = await read(page);
      chk(landed && r.shown, 'S1 the section shows on this computer\'s own Kosmos+ address', JSON.stringify(r).slice(0, 200));
      chk(JSON.stringify(r.groups.map((g) => g.name)) === JSON.stringify(['agent1s', 'mortals', 'pizzarama']), 'S1 one group per OTHER computer, this one excluded', r.groups.map((g) => g.name).join(','));
      const a1 = r.groups[0] || { cards: [] };
      chk(a1.cards.length === 2 && a1.cards.every((c) => c.tag === 'A'), 'S1 agent1s: its two agents (the guide left out), each a link', JSON.stringify(a1.cards).slice(0, 220));
      const angel = a1.cards.find((c) => c.name === 'Angel') || {};
      chk(angel.href === 'https://agent1s.kosmosplus.com/?agent=angel', 'S1 a card opens the agent on its own computer', angel.href);
      chk(angel.sub === 'agent1s · Working', 'S1 a card names its computer and its state', angel.sub);
      const evil = a1.cards.find((c) => c.href === 'https://agent1s.kosmosplus.com/?agent=evil%20one') || {};
      chk(evil.name === HOSTILE && !r.pwned && r.imgs === 0, 'S1 another computer\'s text is shown as text, never markup', JSON.stringify({ name: evil.name, pwned: r.pwned, imgs: r.imgs }));
      const mo = r.groups[1] || { cards: [] };
      chk(mo.cards.length === 0 && /not let in on mortals/.test(mo.note) && mo.open === 'https://mortals.kosmosplus.com/', 'S1 mortals (its gate): no agents, says so, Open to sign in', JSON.stringify(mo));
      const pz = r.groups[2] || { cards: [] };
      /* Not a guard: Playwright can answer an intercepted preflight itself, so this cannot go red in every engine.
         web.allagents-4812.test.js asserts the request has no header and no body, which is what keeps it simple. */
      chk(preflights.length === 0, 'S1 no preflight reached the routes', preflights.join(' '));
      chk(pz.cards.length === 0 && /^Not connected\.$/.test(pz.note) && pz.open === null, 'S1 pizzarama (not connected): no time this page never saw, no link', JSON.stringify(pz));

      // CONTROL B: agent1s stops being readable while the board says it is online: the last list stays, greyed.
      agent1sMode = 'gone';
      await page.evaluate(() => oaRound());
      const greyed = await until(page, () => [...document.querySelectorAll('#oa-groups .oa-group')][0].querySelectorAll('.oa-card.oa-off').length === 2);
      const b = (await read(page)).groups[0] || { cards: [] };
      chk(greyed && b.cards.every((c) => c.tag === 'DIV') && /online, but its agents cannot be read from here yet\. It may need the latest Kosmos\. Showing what this page last read\./.test(b.note), 'CONTROL B unreadable: the last list stays, greyed, not links, and says why', JSON.stringify(b).slice(0, 220));
      chk(b.cards.every((c) => c.sub === 'agent1s'), 'CONTROL B no live state word on a stale card', JSON.stringify(b.cards.map((c) => c.sub)));

      // CONTROL C: agent1s answers its gate: the kept list goes (the card's "a device not allowed on B sees none of B's agents").
      agent1sMode = 'gate';
      await page.evaluate(() => oaRound());
      const dropped = await until(page, () => [...document.querySelectorAll('#oa-groups .oa-group')][0].querySelectorAll('.oa-card').length === 0);
      const c = (await read(page)).groups[0] || {};
      chk(dropped && /not let in on agent1s/.test(c.note), 'CONTROL C not let in: none of agent1s\'s agents, not even the kept ones', JSON.stringify(c).slice(0, 200));
      agent1sMode = 'ok';

      // This computer only: hides the groups, is remembered across a reload, and comes back.
      await page.click('#oa-only');
      const r2 = await read(page);
      chk(r2.shown && r2.only && r2.groupsHidden, 'S2 This computer only hides the other computers', JSON.stringify({ shown: r2.shown, only: r2.only, hidden: r2.groupsHidden }));
      const before = elsewhere.length;
      await page.reload({ waitUntil: 'networkidle' });
      await settle(page);
      await until(page, () => !document.getElementById('oa-wrap').hidden);
      const r3 = await read(page);
      chk(r3.only && r3.groupsHidden, 'S2 remembered after a reload', JSON.stringify({ only: r3.only, hidden: r3.groupsHidden }));
      await page.waitForTimeout(1500);
      chk(elsewhere.length === before, 'S2 with it on, no other computer is asked', (elsewhere.length - before) + ' requests');
      await page.click('#oa-only');
      const back = await until(page, () => document.querySelectorAll('#oa-groups .oa-card').length >= 2);
      chk(back, 'S2 unticked: the other computers are read and shown again');
      await ctx.close();
    }

    // ---- S4 the consolidated layout: the section travels with the grid.
    {
      const { ctx, page } = await fresh();
      await page.goto(HOME + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      await until(page, () => document.querySelectorAll('#oa-groups .oa-card').length >= 2);
      const where = () => page.evaluate(() => {
        const w = document.getElementById('oa-wrap');
        const g = document.getElementById('grid');
        return { inPanel: !!w.closest('#panel-cons-agents'), afterGrid: g.nextElementSibling === w, visible: w.getClientRects().length > 0 && !w.hidden };
      });
      await page.evaluate(() => { document.documentElement.setAttribute('data-layout', 'consolidated'); showTab('projects'); });
      const closed = await where();
      chk(closed.inPanel && closed.afterGrid && !closed.visible, 'S4 consolidated, Agents view closed: moved with the grid, not on screen', JSON.stringify(closed));
      /* Wait out any round already in flight, or the manual one returns early on OA_BUSY and reads nothing whatever
         oaGridShown says (review 2). The direct assertion does not depend on timing at all. */
      chk(await until(page, () => !OA_BUSY), 'S4 no round in flight before the off-screen check');
      const gridShown = await page.evaluate(() => oaGridShown(document.getElementById('grid')));
      chk(gridShown === false, 'S4 the grid counts as off screen while its panel is hidden', String(gridShown));
      const before = elsewhere.length;
      await page.evaluate(() => oaRound());
      await page.waitForTimeout(1500);
      chk(elsewhere.length === before, 'S4 and no other computer is read while it is not on screen', (elsewhere.length - before) + ' requests');
      /* No oaRound() by hand: coming back on screen must start a read itself. The 15 s tick is stopped first, so a
         tick landing inside the 4 s window cannot pass this for the wrong reason. */
      await page.evaluate(() => { clearInterval(OA_TIMER); });
      const beforeOpen = elsewhere.length;
      const openedAt = Date.now();
      await page.evaluate(() => { BOARD_LAYOUT = 'grid'; openConsolidatedAgents(); });
      let readAgain = false;
      while (!readAgain && Date.now() - openedAt < 4000) { readAgain = elsewhere.length > beforeOpen; if (!readAgain) await page.waitForTimeout(100); }
      chk(readAgain, 'S4 opening the Agents view reads the other computers at once, not at the next tick', (elsewhere.length - beforeOpen) + ' requests in ' + (Date.now() - openedAt) + ' ms');
      const shown = await until(page, () => document.querySelectorAll('#panel-cons-agents #oa-groups .oa-card').length >= 2 && !document.getElementById('oa-wrap').hidden);
      const open = await where();
      chk(shown && open.inPanel && open.visible, 'S4 Agents view open: the section shows inside it, under the grid', JSON.stringify(open));
      await page.evaluate(() => { document.documentElement.setAttribute('data-layout', 'tabs'); showTab('agents'); });
      const back = await where();
      chk(!back.inPanel && back.afterGrid, 'S4 back to the tab view: under the grid in its own place again', JSON.stringify(back));
      await ctx.close();
    }

    // ---- CONTROL A: the Mac's own window. No section, and no request to another computer.
    {
      const { ctx, page } = await fresh();
      const before = elsewhere.length;
      await page.goto('http://127.0.0.1:' + port + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      await page.waitForTimeout(3500);   // past the 3 s boot fallback that also starts the section
      const r = await read(page);
      chk(!r.shown && r.groups.length === 0, 'CONTROL A the app\'s 127.0.0.1 window has no other-computers section', JSON.stringify(r).slice(0, 120));
      chk(elsewhere.length === before, 'CONTROL A and asks no other computer', (elsewhere.length - before) + ' requests');
      await ctx.close();
    }

    // ---- Phone width, dark: the groups fit (no sideways scroll).
    {
      const { ctx, page } = await fresh({ viewport: { width: 320, height: 640 }, colorScheme: 'dark' });
      await page.goto(HOME + '/?tab=agents', { waitUntil: 'networkidle' });
      await settle(page);
      const landed = await until(page, () => document.querySelectorAll('#oa-groups .oa-card').length >= 2);
      const over = await page.evaluate(() => {
        const wrap = document.getElementById('oa-wrap');
        const r = wrap.getBoundingClientRect();
        return { right: Math.round(r.right), vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
      });
      chk(landed && over.right <= over.vw && over.sw <= over.vw, 'S3 at 320px the section fits without a sideways scroll', JSON.stringify(over));
      if (process.env.OA_SHOTS) await page.locator('#oa-wrap').screenshot({ path: path.join(process.env.OA_SHOTS, 'allagents-320-dark-' + ENGINE + '.png') });
      await ctx.close();
    }
  } catch (err) {
    chk(false, 'the check ran to the end', String(err && err.stack || err).slice(0, 400));
  } finally {
    await browser.close().catch(() => {});
  }
  }
  {
    await new Promise((res) => server.close(res));
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log('\n' + pass + ' PASS / ' + fail.length + ' FAIL');
  process.exit(fail.length ? 1 : 0);
})();
