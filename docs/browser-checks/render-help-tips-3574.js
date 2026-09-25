// Browser-check-surface: tipcard tippins tiphalo tip-live tips-row tip-eb tip-x tip-go tip-off tip-skip tip-dots tip-arrow tip-bands tipdim tip-dimming helpq helpq-btn helpq-menu data-help tips-toggle tips-box
'use strict';

/**
 * First-run help and first-visit tips (#3574, Josh 2026-09-24, for 0.6.93).
 *
 * One card does the welcome tour and every screen's first-visit tip; the board remembers what was
 * closed. Each "shows once" and "shows nothing" arm has a control that shows the tip from the same
 * state, so a check that could not see a tip cannot pass.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-help-tips-3574.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ht-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const zlib = require('node:zlib');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const tipsStore = require('../../engine/tips');

const SHOTS = process.argv[2] || null;
const TOUR = 'Make your first agent';
const TOUR_TITLE_IN_PAGE = TOUR;   // the tour's first step (Josh chose the step-through tour)
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const cardState = (page) => page.evaluate(() => {
  const c = document.getElementById('tipcard');
  const h = c && c.querySelector('h2');
  return { shown: !!c && !c.hidden, title: h ? h.textContent : null,
    dim: !!document.querySelector('#tippins:not([hidden]) .tiphalo, #tippins:not([hidden]) .tipdim') || document.documentElement.classList.contains('tip-dimming'),
    halo: document.querySelectorAll('#tippins .tiphalo').length,
    step: c ? (c.querySelector('.tip-eb')?.textContent || '') : '', dots: c ? c.querySelectorAll('.tip-dots i').length : 0 };
});
const waitTitle = (page, title, ms) => page.waitForFunction((t) => { const c = document.getElementById('tipcard'); return c && !c.hidden && c.querySelector('h2')?.textContent === t; }, title, { timeout: ms }).then(() => true, () => false);
/* An absence claim needs the tips code to have run: loaded, ticking, and the board's first answer in. */
const tipsRunning = (page) => page.waitForFunction(() => TIPS_STATE !== null && TIPS_TIMER !== null && TIP_NEW_BOARD !== null, null, { timeout: 8000 }).then(() => true, () => false);
/* One screen pixel, as the engine composited it. A 1x1 PNG row is its filter byte then the pixel, and every PNG
   filter decodes a lone pixel to its raw bytes (no left or upper neighbour), so no decoder is needed. */
const pixel = async (page, x, y) => {
  const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  if (buf[24] !== 8 || (buf[25] !== 2 && buf[25] !== 6) || buf[28] !== 0) throw new Error('pixel: not an 8-bit, non-interlaced RGB(A) PNG (depth ' + buf[24] + ', type ' + buf[25] + ', interlace ' + buf[28] + ')');
  const idat = [];
  for (let o = 8; o < buf.length;) { const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8); if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return [raw[1], raw[2], raw[3]];
};
/* The store, written directly: the API only ever adds to seen, which is the product rule. */
const resetStore = (state) => fs.writeFileSync(tipsStore.FILE(), JSON.stringify(state));

(async () => {
  /* The tour shows by itself only on a board with no agents (someone new), so the check starts on
     an empty board and adds Beatrix for the arms about a card, her ring and her page. */
  const noAgents = () => fleet.install([]);
  const withAgent = () => fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);
  noAgents();
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const api = async (method, body) => (await fetch(URL + '/api/tips', method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    // T1: the welcome tour shows once on the board, one place at a time: step 1 of 4, the New agent
    // button ringed and the rest dimmed, four dots.
    chk(await waitTitle(page, TOUR, 4000), 'T1 the welcome tour shows on the board after first run');
    const tour = await cardState(page);
    chk(tour.dim && tour.halo === 1 && tour.step === '1 of 4' && tour.dots === 4, 'T1 step 1 of 4: one place ringed, the rest dimmed, four dots', JSON.stringify(tour));
    const ringed = await page.evaluate(() => { const h = document.querySelector('#tippins .tiphalo').getBoundingClientRect(); const b = document.getElementById('new-agent').getBoundingClientRect(); return Math.abs(h.left + 4 - b.left) <= 1 && Math.abs(h.top + 4 - b.top) <= 1; });
    chk(ringed, 'T1 the ring sits on the New agent button');
    // Past a tick of the tips timer the ringed button is still the thing under the pointer (bright,
    // and a click reaches it), and the tour's Next has focus although it opened by itself.
    await page.waitForTimeout(1500);
    const reach = await page.evaluate(() => { const b = document.getElementById('new-agent').getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { onButton: !!hit && !!hit.closest('#new-agent'), focus: document.activeElement && document.activeElement.className }; });
    chk(reach.onButton && reach.focus === 'tip-go', 'T1 after a tick the ringed button is still under the pointer, and Next has focus', JSON.stringify(reach));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'tour-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: path.join(SHOTS, 'tour-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }

    // T2: Next walks the four places in order, and Got it on the last closes it and the board remembers.
    const walked = [];
    const placed = [];
    const tourPlace = () => page.evaluate(() => {
      const c = document.getElementById('tipcard'), h = document.querySelector('#tippins .tiphalo');
      const a = c.getBoundingClientRect(), b = h ? h.getBoundingClientRect() : null;
      return { cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)), overRing: !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top };
    });
    placed.push(await tourPlace());
    for (let i = 0; i < 3; i++) {
      await page.click('#tipcard .tip-go');
      await page.waitForTimeout(150);
      const st = await cardState(page);
      walked.push(st.step + ' ' + st.title + ' | ' + await page.evaluate(() => document.querySelector('#tipcard .tip-bd').textContent.trim()));
      placed.push(await tourPlace());
    }
    /* Every step's card points at its own ringed place and never sits on it (a card's last place must
       not carry over from the step before). */
    chk(placed.length === 4 && placed.every((p) => p.cls !== 'flat' && !p.overRing), 'T2 every tour step\'s card points at its ring and does not cover it', JSON.stringify(placed));
    /* #3737 (Josh 08:51): his words for steps 2 to 4, verbatim. */
    chk(JSON.stringify(walked) === JSON.stringify(['2 of 4 Your agents | Access all your agents to see what they are working on and talk to them directly.',
      '3 of 4 Your projects | Create projects for your agents to work on together.',
      '4 of 4 Your Profile | Access all your Kosmos settings here.']), 'T2 Next walks Agents, Projects, then your name, in Josh\'s words (#3737)', JSON.stringify(walked));
    const lastBtn = await page.evaluate(() => ({ go: document.querySelector('#tipcard .tip-go').textContent, skip: !!document.querySelector('#tipcard .tip-skip') }));
    chk(lastBtn.go === 'Got it' && !lastBtn.skip, 'T2 the last step says Got it and offers no Skip', JSON.stringify(lastBtn));
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);
    const closed = await cardState(page);
    // The next first-visit tip may already be up (the timer runs), so the claim is about the tour.
    chk(!closed.dim && !/ of /.test(closed.step), 'T2 Got it closes the tour and its dim', JSON.stringify(closed));
    chk((await api('GET')).seen.includes('tour'), 'T2 the board records the tour as seen');
    // Her first agent arrives: the screen tips follow the tour. Her memory reads 62% (the fixture has no transcript, so
    // the board would report it unknown and her page would draw no ring for the tip to point at).
    /* Only while the check asks for it (localStorage survives the reloads), so later arms see the board's real answer. */
    await page.addInitScript(() => {
      const f = window.fetch;
      window.fetch = async (...a) => {
        const r = await f(...a);
        if (!String(a[0]).startsWith('/api/status') || localStorage.getItem('aw-check-ctx') !== '62') return r;
        const j = await r.clone().json();
        (j.agents || []).forEach((x) => { x.context = { tokens: 124000, percent: 62, confidence: 'exact', notYet: false }; });
        return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } });
      };
    });
    await page.evaluate(() => localStorage.setItem('aw-check-ctx', '62'));
    withAgent();
    await page.reload({ waitUntil: 'networkidle' });

    // T3 (#3737, Josh 08:51): the ring tip lives on the agent's own page, by its ring. On the board it no longer shows
    // by itself (CONTROL for the arms below: the board's own tip does), and the Agents tip is the board's first.
    chk(await waitTitle(page, 'See your agents your way', 4000), 'T3 on the board the Agents tip shows, not the ring tip (#3737)', JSON.stringify(await cardState(page)));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'screen-tip-light.png') });
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);
    // Her page: its own tip first, then the ring's, pointing at the ring beside her picture.
    await page.click('#grid [data-agent]');
    chk(await waitTitle(page, 'Your agent\'s page', 4000), 'T3 on her page, the page\'s own tip shows first');
    await page.click('#tipcard .tip-go');
    chk(await waitTitle(page, 'Your agent\'s memory', 4000), 'T3 then the ring tip shows by itself on her page (#3737)', JSON.stringify(await cardState(page)));
    const ring = await page.evaluate(() => {
      const c = document.getElementById('tipcard'), r = document.querySelector('#panel-detail #d-ring svg');
      const a = c.getBoundingClientRect(), b = r.getBoundingClientRect();
      const ay = parseFloat(c.style.getPropertyValue('--ay')) || 22, tip = a.top + ay + 7;
      return { dim: !!document.querySelector('#tippins .tiphalo, #tippins .tipdim') || document.documentElement.classList.contains('tip-dimming'),
        cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)), arrowOnRing: tip >= b.top && tip <= b.bottom,
        gap: Math.round(Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom)),
        body: c.querySelector('.tip-bd').innerText.replace(/\s+/g, ' ').trim(),
        strokes: [...c.querySelectorAll('.tip-bands .gf')].map((x) => getComputedStyle(x).stroke) };
    });
    chk(!ring.dim && ring.strokes.length === 3 && new Set(ring.strokes).size === 3, 'T3 it is a screen tip, with no dim, and three distinct gauge colours', JSON.stringify(ring));
    chk(['left', 'right'].includes(ring.cls) && ring.arrowOnRing && ring.gap >= 0 && ring.gap <= 40, 'T3 it points at the ring on her page, from beside it, its arrow on the ring', JSON.stringify(ring));
    chk(ring.body === 'The ring shows how full your agent\'s memory is. Plenty of room Getting full Nearly full This is normal and the agent will automatically write themselves a handoff, You can also manage their memory under AI settings.',
      'T3 in Josh\'s words (#3737)', JSON.stringify(ring.body));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ring-light.png') });
    // A tip that shows by itself does not take focus, so the live region is how a screen reader hears it.
    const live = await page.evaluate(() => { const l = document.getElementById('tip-live'); return l ? { text: l.textContent, polite: l.getAttribute('aria-live') } : null; });
    chk(!!live && live.polite === 'polite' && live.text === 'Tip: Your agent\'s memory', 'T3 the tip is announced politely by its title', JSON.stringify(live));
    // T16: leaving the screen closes a tip that showed by itself, without recording it; coming back shows it again.
    await page.click('#tabs [data-tab="agents"]');
    await page.waitForTimeout(2800);
    const left16 = await cardState(page);
    chk(!left16.shown, 'T16 leaving her page closes the ring tip, and it does not follow to the board', JSON.stringify(left16));
    chk(!(await api('GET')).seen.includes('ring'), 'T16 the ring tip was not recorded as seen when its screen went away');
    await page.click('#grid [data-agent]');
    chk(await waitTitle(page, 'Your agent\'s memory', 4000), 'T16 coming back to her page shows the ring tip again');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    chk(!(await cardState(page)).shown && (await api('GET')).seen.includes('ring'), 'T3 Escape closes it and counts as seen');
    await page.click('#tabs [data-tab="agents"]');
    await page.waitForTimeout(300);
    // T3c: an agent whose memory is unknown has no ring on her page, so the tip has nothing to point at and does not
    // show (CONTROL: the same page with a reading shows it, T3 above).
    const seen3c = (await api('GET')).seen;
    resetStore({ seen: seen3c.filter((id) => id !== 'ring'), off: false });
    await page.evaluate(() => localStorage.removeItem('aw-check-ctx'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('#grid [data-agent]');
    await page.waitForTimeout(3000);
    chk(await page.evaluate(() => tipVisible('#panel-detail #d-sec-talk')), 'T3c precondition: her page is open');
    const t3c = await page.evaluate(() => ({ ring: !!document.querySelector('#panel-detail #d-ring svg'), card: (() => { const c = document.getElementById('tipcard'); return c && !c.hidden ? c.querySelector('h2').textContent : null; })() }));
    chk(!t3c.ring && t3c.card === null, 'T3c unknown memory: no ring on her page, and no ring tip', JSON.stringify(t3c));
    resetStore({ seen: seen3c, off: false });
    await page.click('#tabs [data-tab="agents"]');
    await page.reload({ waitUntil: 'networkidle' });

    // T4: a reload does not bring back what was closed (control: T1-T3 each showed before closing).
    await page.reload({ waitUntil: 'networkidle' });
    chk(await tipsRunning(page), 'T4 precondition: the tips code is running');
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T4 after a reload nothing closed returns on the board');

    // T23: a board that already has agents (an upgrade) shows nothing by itself, even with nothing
    // seen: not the tour, and not the screen tips that follow it (control: T1 and T22, the same
    // empty state with no agents, show the tour).
    resetStore({ seen: [], off: false });
    await page.reload({ waitUntil: 'networkidle' });
    chk(await tipsRunning(page), 'T23 precondition: the tips code is running and the board has answered');
    await page.waitForTimeout(2800);
    const upg = await cardState(page);
    const hasCard = await page.evaluate(() => !!document.querySelector('#grid [data-agent="beatrix"]'));
    chk(hasCard && !upg.shown, 'T23 with an agent on the board and nothing seen, no tip shows by itself', JSON.stringify({ hasCard, upg }));
    chk(!(await api('GET')).seen.includes('tour'), 'T23 and the tour is not recorded for a board that already had agents (control: T24, a met tour, is)');
    // T26: the same board then removes its last agent. It had agents at its first answer, so it is not
    // someone new and the tour must not appear (control: T1, empty at its first answer, shows it).
    chk(await page.waitForFunction(() => TIP_NEW_BOARD === false, null, { timeout: 8000 }).then(() => true, () => false), 'T26 precondition: the board decided at its first answer that it is not new');
    noAgents();
    const emptied = await page.waitForFunction(() => Array.isArray(LAST) && LAST.length === 0, null, { timeout: 8000 }).then(() => true, () => false);
    await page.waitForTimeout(2800);
    const t26 = await cardState(page);
    chk(emptied && !/ of /.test(t26.step) && !t26.shown, 'T26 a board that had agents and removed the last one gets no tour', JSON.stringify({ emptied, t26 }));
    withAgent();
    // T27: the same, with tips off at load and turned on after the last agent went. The decision was
    // made by the first answer, not by the first tips check, so the tour still does not appear.
    resetStore({ seen: [], off: true });
    await page.reload({ waitUntil: 'networkidle' });
    chk(await page.waitForFunction(() => TIP_NEW_BOARD === false, null, { timeout: 8000 }).then(() => true, () => false), 'T27 precondition: tips off, and the board still decided it is not new');
    noAgents();
    const emptied27 = await page.waitForFunction(() => Array.isArray(LAST) && LAST.length === 0, null, { timeout: 8000 }).then(() => true, () => false);
    chk(await page.waitForFunction(() => TIPS_STATE !== null && TIPS_TIMER !== null, null, { timeout: 8000 }).then(() => true, () => false), 'T27 precondition: the tips checks are running');
    await page.evaluate(() => tipsSave({ off: false }));   // what the Settings switch does
    const onNow = await page.evaluate(() => TIPS_STATE.ok && TIPS_STATE.off === false);
    await page.waitForTimeout(2800);
    const t27 = await cardState(page);
    chk(emptied27 && onNow && !t27.shown, 'T27 tips turned on after the last agent went: still no tour', JSON.stringify({ emptied27, onNow, t27 }));
    withAgent();
    resetStore({ seen: ['tour', 'ring', 'agents'], off: false });
    await page.reload({ waitUntil: 'networkidle' });

    // T5: the ? menu brings any of it back, closes the user menu, and returns focus to the ?.
    await page.click('#userpop-btn');
    await page.click('#helpq-btn');
    const menus = await page.evaluate(() => ({ help: !document.getElementById('helpq-menu').hidden, user: !document.getElementById('userpop-menu').hidden }));
    chk(menus.help && !menus.user, 'T5 opening the ? closes the user menu', JSON.stringify(menus));
    // And the other way: the name button closes an open ? menu.
    await page.click('#userpop-btn');
    const menus2 = await page.evaluate(() => ({ help: !document.getElementById('helpq-menu').hidden, user: !document.getElementById('userpop-menu').hidden }));
    chk(!menus2.help && menus2.user, 'T5 opening the user menu closes the ?', JSON.stringify(menus2));
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="tour"]');
    const again = await cardState(page);
    chk(again.shown && again.title === TOUR, 'T5 Take the welcome tour again shows the tour', JSON.stringify(again));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const focusAfter = await page.evaluate(() => document.activeElement && document.activeElement.id);
    chk(focusAfter === 'helpq-btn', 'T5 closing it returns focus to the ?', 'focus=' + focusAfter);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    chk((await cardState(page)).title === 'Your agent\'s memory', 'T5 What does the ring mean shows the ring explainer');
    const ringCls = await page.evaluate(() => ['up', 'down', 'left', 'right', 'flat'].find((k) => document.getElementById('tipcard').classList.contains(k)));
    chk(ringCls && ringCls !== 'flat', 'T5 the ring explainer opened from the ? points at a ring, not a centred card', 'cls=' + ringCls);

    // T6: Stop showing tips turns them off in one write, and the Settings switch reads it. With tips
    // off and nothing seen, nothing shows; turning the switch on shows the tour from that same state
    // (the control).
    let tipPuts = 0;
    const countPut = (r) => { if (r.method() === 'PUT' && r.url().endsWith('/api/tips')) tipPuts++; };
    page.on('request', countPut);
    await page.click('#tipcard .tip-off');
    await page.waitForTimeout(400);
    page.off('request', countPut);
    chk(tipPuts === 1, 'T6 Stop showing tips is one save, not two that could race', 'puts=' + tipPuts);
    chk((await api('GET')).off === true, 'T6 Stop showing tips turns tips off on the board');
    const sw = await page.evaluate(() => document.getElementById('tips-toggle')?.getAttribute('aria-checked'));
    chk(sw === 'false', 'T6 the Settings switch reads off', 'aria-checked=' + sw);
    resetStore({ seen: [], off: true });
    noAgents();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T6 with tips off and nothing seen, no tip shows');
    await page.evaluate(() => document.getElementById('tips-toggle').click());
    chk(await waitTitle(page, TOUR, 4000), 'T6 control: turning the switch on shows the tour from the same state');
    chk((await api('GET')).off === false, 'T6 the Settings switch turns tips back on');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    resetStore({ seen: ['tour', 'ring', 'agents'], off: false });
    withAgent();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // T9: each screen shows its own tip, once.
    const visit = async (label, go, title) => {
      await go();
      const shown = await waitTitle(page, title, 5000);
      const st = await cardState(page);
      chk(shown && !st.dim, 'T9 ' + label + ' shows its tip: ' + title, JSON.stringify(st));
      if (st.shown) { await page.click('#tipcard .tip-go'); await page.waitForTimeout(250); }
    };
    await page.click('#new-agent');
    chk(await waitTitle(page, 'Make an agent', 5000), 'T9 New agent shows its tip: Make an agent');
    const na = await page.evaluate(() => {
      const c = document.getElementById('tipcard').getBoundingClientRect();
      const over = [...document.querySelectorAll('#panel-create h2, #panel-create input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top; }).length;
      return { cls: document.getElementById('tipcard').className, over };
    });
    chk(na.cls.includes('left') && na.over === 0, 'T9 it sits beside the form\'s heading, over none of its fields', JSON.stringify(na));
    // T15: a tip that opened by itself, closed from the keyboard, hands focus to the ? rather than dropping it.
    await page.evaluate(() => document.querySelector('#tipcard .tip-go').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const fAuto = await page.evaluate(() => document.activeElement && document.activeElement.id);
    chk(fAuto === 'helpq-btn', 'T15 closing an auto tip from the keyboard moves focus to the ?', 'focus=' + fAuto);
    await visit('Projects', () => page.click('#tabs [data-tab="projects"]'), 'A project is shared work');
    await page.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tips Room' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
    });
    await page.reload({ waitUntil: 'networkidle' });
    await visit('inside a project', async () => {
      await page.click('#tabs [data-tab="projects"]');
      await page.locator('#pj-list').getByText('Tips Room').first().click();
    }, 'Everything about this project, in one place');
    // Settings has no tip (Josh 2026-09-25 07:46): opening it shows none.
    await page.click('#userpop-btn'); await page.click('#userpop-settings');
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T9 Settings shows no tip (it has none)', JSON.stringify(await cardState(page)));
    await visit('an agent\'s page', async () => { await page.click('#tabs [data-tab="agents"]'); await page.waitForTimeout(300); await page.click('[data-agent="beatrix"]'); }, 'Your agent\'s page');
    const seenNow = (await api('GET')).seen;
    chk(['newagent', 'projects', 'project', 'agentpage'].every((id) => seenNow.includes(id)) && !seenNow.includes('settings'), 'T9 each closed screen tip is recorded, and no Settings one', JSON.stringify(seenNow));
    await page.click('#tabs [data-tab="projects"]');
    await page.waitForTimeout(2800);
    const again2 = await cardState(page);
    chk(!(again2.shown && again2.title === 'A project is shared work'), 'T9 the Projects tip does not return (control: it showed above)', JSON.stringify(again2));

    // T13: a dialog opened while a tip is up makes the tip step aside, and it comes back after.
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    // A stand-in dialog: the app's dialogs are .rm-back overlays. Held by reference, not by an id.
    await page.evaluate(() => { const d = document.createElement('div'); d.className = 'rm-back'; document.body.appendChild(d); window.__tipsStandIn = d; });
    // At once, before any poll: the dialog covers the card (the card is layered below every backdrop).
    const coveredAtOnce = await page.evaluate(() => { const r = document.getElementById('tipcard').getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && !hit.closest('#tipcard'); });
    chk(coveredAtOnce, 'T13 a dialog covers the tip the moment it opens');
    await page.waitForTimeout(1600);
    const underDialog = (await cardState(page)).shown;
    await page.evaluate(() => { window.__tipsStandIn.remove(); delete window.__tipsStandIn; });
    await page.waitForTimeout(1600);
    const afterDialog = await cardState(page);
    chk(underDialog === false && afterDialog.shown && afterDialog.title === 'Your agent\'s memory',
      'T13 a tip steps aside while a dialog is open and returns when it closes', JSON.stringify({ underDialog, afterDialog }));
    await page.keyboard.press('Escape');

    // T17: an Escape meant for a dialog closes the dialog, not the tip behind it. The stand-in closes
    // on Escape from a bubble-phase listener, the way the app's dialogs do.
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.evaluate(() => {
      const d = document.createElement('div'); d.className = 'rm-back'; document.body.appendChild(d); window.__tipsStandIn = d;
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && window.__tipsStandIn) { window.__tipsStandIn.remove(); delete window.__tipsStandIn; document.removeEventListener('keydown', esc); } });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1600);
    const esc17 = await page.evaluate(() => ({ dialogGone: !window.__tipsStandIn, card: !document.getElementById('tipcard').hidden, title: document.querySelector('#tipcard h2')?.textContent }));
    chk(esc17.dialogGone && esc17.card && esc17.title === 'Your agent\'s memory', 'T17 one Escape closes the dialog and leaves the tip', JSON.stringify(esc17));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    chk(!(await cardState(page)).shown, 'T17 control: with no dialog, the same Escape closes the tip');

    // T18: every way out of the tour and the tips works. Skip ends the tour; the x closes a screen tip;
    // a click outside ends the tour. A click on a dialog that opened over the tour does NOT end it:
    // the tour steps aside and comes back when the dialog closes.
    // On the board, so the tour starts at its first step (a step whose place is off screen is left out).
    await page.click('#tabs [data-tab="agents"]');
    await page.waitForTimeout(300);
    const openTour = async () => { await page.click('#helpq-btn'); await page.click('#helpq-menu [data-help="tour"]'); await page.waitForTimeout(150); };
    await openTour();
    await page.click('#tipcard .tip-skip');
    chk(!(await cardState(page)).shown, 'T18 Skip ends the tour');
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.click('#tipcard .tip-x');
    chk(!(await cardState(page)).shown, 'T18 the x closes a screen tip');
    await openTour();
    await page.mouse.click(700, 600);
    await page.waitForTimeout(150);
    chk(!(await cardState(page)).shown, 'T18 a click outside ends the tour');
    await openTour();
    await page.evaluate(() => { const d = document.createElement('div'); d.className = 'rm-back'; document.body.appendChild(d); window.__tipsStandIn = d; });
    await page.waitForTimeout(1500);
    await page.mouse.click(700, 600);   // lands on the stand-in dialog
    await page.evaluate(() => { window.__tipsStandIn.remove(); delete window.__tipsStandIn; });
    const back = await waitTitle(page, TOUR, 3000);
    chk(back, 'T18 a click on a dialog over the tour does not end it; the tour returns when the dialog closes');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // T14: the card follows its target when the page scrolls (New agent: Settings has no tip since 2026-09-25).
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.evaluate(() => openCreate());
    await page.waitForTimeout(400);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="screen"]');
    const top0 = await page.evaluate(() => document.getElementById('tipcard').getBoundingClientRect().top);
    const title14 = (await cardState(page)).title;
    /* A 60px scroll keeps the heading on screen, so the card still has a target to follow (a flat card cannot answer). */
    const scrolled = await page.evaluate(async () => { const y = window.scrollY; window.scrollBy(0, 60); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return window.scrollY - y; });
    /* Since the 0.6.93 fix a card never sits on a control, so after a scroll it either still points at its
       target from exactly its gap (arrow up / down / beside), or, when that place would cover a control, sits
       in a clear place with no arrow. Both are strict: which one is read from the card, not allowed either way. */
    const after14 = await page.evaluate(() => {
      const c = document.getElementById('tipcard');
      const t = [...document.querySelectorAll('#panel-create h2')].find((x) => x.getBoundingClientRect().height > 0);
      const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
      const cls = ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k));
      return { cls, covers: c.dataset.covers, gap: cls === 'up' ? Math.round(cr.top - tr.bottom) : cls === 'down' ? Math.round(tr.top - cr.bottom) : cls === 'left' ? Math.round(cr.left - tr.right) : cls === 'right' ? Math.round(tr.left - cr.right) : null,
        onScreen: cr.top >= 0 && cr.bottom <= innerHeight, top: Math.round(cr.top), headOn: tr.top >= 0 && tr.bottom <= innerHeight };
    });
    const want14 = { up: 12, down: 12, left: 14, right: 14 }[after14.cls];
    /* Within a pixel: the card's place is rounded to a whole pixel, and with a scrollbar gutter reserved (a Mac with a
       mouse) the page's centre, and so the heading's edge, falls on a half pixel. */
    /* It FOLLOWED: the card moved up by the scroll (a card that stayed put while its heading moved fails here). */
    const moved = top0 - after14.top;
    chk(title14 === 'Make an agent' && scrolled > 0 && after14.headOn && after14.cls !== 'flat' && Math.abs(moved - scrolled) <= 1 && after14.onScreen && after14.covers === '0' && Math.abs(after14.gap - want14) <= 1,
      'T14 after a scroll the card still points at its target from its gap, or sits clear of every control', JSON.stringify({ top0, scrolled, after14 }));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.click('#tabs [data-tab="agents"]');

    // T10: on a narrow window the card is pinned 12px from each edge with no arrow.
    await page.click('#tabs [data-tab="agents"]');
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    const narrow = await page.evaluate(() => { const c = document.getElementById('tipcard'); const r = c.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), arrow: getComputedStyle(c.querySelector('.tip-arrow')).display }; });
    chk(narrow.left === 12 && narrow.right >= 12 && narrow.arrow === 'none', 'T10 at 390 wide the card sits 12px in from the edges with no arrow', JSON.stringify(narrow));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(300);

    // T11: the card takes each scheme's elevated ground (control: the two differ).
    const ground = async () => {
      await page.click('#helpq-btn'); await page.click('#helpq-menu [data-help="ring"]');
      const bg = await page.evaluate(() => getComputedStyle(document.getElementById('tipcard')).backgroundColor);
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      return bg;
    };
    const lightBg = await ground();
    await page.emulateMedia({ colorScheme: 'dark' });
    const darkBg = await ground();
    await page.emulateMedia({ colorScheme: 'light' });
    chk(lightBg === 'rgb(255, 255, 255)' && darkBg === 'rgb(44, 44, 46)', 'T11 the card is the elevated ground in each scheme', 'light=' + lightBg + ' dark=' + darkBg);

    // T12: under the consolidated layout (no tab row) the tour numbers only what is on screen, so
    // the card's list and its pins still match.
    await page.evaluate(() => applyLayout('consolidated', true));
    await page.waitForTimeout(400);
    await page.click('#helpq-btn');
    // Escape with focus still on the ? (a mouse opened it) closes the menu.
    await page.keyboard.press('Escape');
    chk(await page.evaluate(() => document.getElementById('helpq-menu').hidden), 'T12 Escape closes the ? menu with focus on the button');
    // The tour shows by itself under the consolidated layout too (the board's rail, not its stats bar).
    resetStore({ seen: [], off: false });
    noAgents();
    await page.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) }));
    await page.reload({ waitUntil: 'networkidle' });
    const consOn = await page.evaluate(() => document.documentElement.getAttribute('data-layout'));
    chk(consOn === 'consolidated', 'T12 precondition: the page reloaded in the consolidated layout', 'data-layout=' + consOn);
    chk(await waitTitle(page, TOUR, 4000), 'T12 under the consolidated layout the tour shows by itself');
    const cons = await cardState(page);
    chk(cons.shown && cons.step === '1 of 4' && cons.dots === 4 && cons.halo === 1,
      'T12 under the consolidated layout the tour still finds all four places (the rail heads)', JSON.stringify(cons));
    await page.keyboard.press('Escape');
    // T19: under the consolidated layout the rail (with its rings) shows on every screen. On Settings
    // the tour does not start by itself (it belongs to the board), and the ? offers no "this screen" there
    // (Settings has no tip since 2026-09-25).
    resetStore({ seen: ['ring', 'agents', 'settings'], off: false });
    await page.goto(URL + '/?tab=settings', { waitUntil: 'load' });
    await page.waitForTimeout(2800);
    const onSettings = await page.evaluate(() => ({ settings: !document.getElementById('panel-settings').hidden, card: !document.getElementById('tipcard')?.hidden, title: document.querySelector('#tipcard h2')?.textContent || null }));
    chk(onSettings.settings && !(onSettings.card && onSettings.title === TOUR_TITLE_IN_PAGE), 'T19 under the consolidated layout the tour does not start by itself over Settings', JSON.stringify(onSettings));
    if (onSettings.card) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await page.click('#helpq-btn');
    chk(await page.evaluate(() => document.querySelector('#helpq-menu [data-help="screen"]').hidden), 'T19 on Settings the ? offers no "tips for this screen" (Settings has none)');
    chk(await page.evaluate(() => !!document.activeElement && document.activeElement.closest('#helpq-menu') && !document.activeElement.hidden), 'T19 and the keyboard lands on the first item that shows',
      await page.evaluate(() => document.activeElement && (document.activeElement.dataset.help || document.activeElement.id)));
    await page.keyboard.press('Escape');
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    chk(await page.evaluate(() => !document.querySelector('#helpq-menu [data-help="screen"]').hidden), 'T19 CONTROL: on the board the ? still offers them');
    await page.keyboard.press('Escape');
    /* T20 needs a SCREEN tip open (this board has no agent, so the board's answer would be the tour): New agent's. */
    await page.evaluate(() => openCreate());
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="screen"]');
    chk(await waitTitle(page, 'Make an agent', 4000), 'T20 precondition: a screen tip is open (New agent\'s)');
    // T20: a screen tip leaves an Escape meant for an open picker alone (the picker closes on any
    // Escape), and takes it when nothing else is open (the control).
    // The reaction picker is built on first use; stand it up under its own id if it is not there yet.
    await page.evaluate(() => {
      let d = document.getElementById('rxn-picker');
      if (!d) { d = document.createElement('div'); d.id = 'rxn-picker'; document.body.appendChild(d); window.__tipsMadePicker = true; }
      d.hidden = false;
    });
    await page.keyboard.press('Escape');   // the picker's own handler hides it; the tip must stay
    const kept = (await cardState(page)).shown;
    await page.evaluate(() => { const d = document.getElementById('rxn-picker'); if (window.__tipsMadePicker) { d.remove(); delete window.__tipsMadePicker; } else d.hidden = true; });
    await page.keyboard.press('Escape');
    const gone = !(await cardState(page)).shown;
    chk(kept && gone, 'T20 Escape with a picker open leaves a screen tip; with none open it closes it', JSON.stringify({ kept, gone }));
    // T3d (#3737): the ring tip in the consolidated layout, where her ring sits at the left of the middle column (the
    // agent rail to its left, her name and buttons below): still beside it, its arrow on the ring.
    resetStore({ seen: ['tour', 'agents', 'agentpage', 'newagent', 'projects', 'project'], off: false });
    withAgent();
    await page.evaluate(() => localStorage.setItem('aw-check-ctx', '62'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Array.isArray(LAST) && LAST.some((a) => a.sessionName === 'beatrix'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => openDetail('beatrix', 'talk'));
    chk(await waitTitle(page, 'Your agent\'s memory', 6000), 'T3d under the consolidated layout the ring tip shows on her page', JSON.stringify(await cardState(page)));
    const t3d = await page.evaluate(() => {
      const c = document.getElementById('tipcard'), r = document.querySelector('#panel-detail #d-ring svg');
      if (!r) return { ring: false };
      const a = c.getBoundingClientRect(), b = r.getBoundingClientRect();
      const ay = parseFloat(c.style.getPropertyValue('--ay')) || 22, tip = a.top + ay + 7;
      return { layout: document.documentElement.dataset.layout, cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)),
        arrowOnRing: tip >= b.top && tip <= b.bottom, covers: c.dataset.covers };
    });
    chk(t3d.layout === 'consolidated' && ['left', 'right'].includes(t3d.cls) && t3d.arrowOnRing && t3d.covers === '0', 'T3d beside her ring, its arrow on it, covering nothing', JSON.stringify(t3d));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ring-consolidated.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.removeItem('aw-check-ctx'));
    await page.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'tabs' }) }));
    await page.evaluate(() => applyLayout('tabs', true));
    withAgent();

    // T21: a header menu opened over a tip makes the tip step aside at once, and closing it brings the
    // tip back (the header is its own stacking layer, so the tip would otherwise draw over the menu).
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.click('#userpop-btn');
    await page.waitForTimeout(80);
    const underMenu = await page.evaluate(() => ({ menu: !document.getElementById('userpop-menu').hidden, card: !document.getElementById('tipcard').hidden }));
    await page.click('#userpop-btn');
    await page.waitForTimeout(80);
    const afterMenu = await page.evaluate(() => ({ menu: !document.getElementById('userpop-menu').hidden, card: !document.getElementById('tipcard').hidden }));
    chk(underMenu.menu && !underMenu.card && !afterMenu.menu && afterMenu.card, 'T21 a tip steps aside at once while a header menu is open and returns when it closes', JSON.stringify({ underMenu, afterMenu }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // T22: choosing something else from the ? while the tour that opened by itself is up counts as
    // closing the tour: it is recorded and does not come back (control: T1, the same empty state
    // shows it).
    resetStore({ seen: [], off: false });
    noAgents();
    await page.goto(URL, { waitUntil: 'networkidle' });   // the board (the page may be on a Settings address)
    chk(await waitTitle(page, TOUR, 4000), 'T22 precondition: the tour shows by itself');
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(2800);
    const tourBack = await cardState(page);
    chk((await api('GET')).seen.includes('tour') && !/ of /.test(tourBack.step), 'T22 the tour replaced from the ? is recorded and does not come back', JSON.stringify(tourBack));

    // T24: the tour showed by itself, then its screen went without a pointer (keyboard, Back, a link:
    // unrecorded), then the first agent arrived. The tour's job is done, so it counts as seen and the
    // screen tips follow. Before the fix this board looked like an upgrade (agents, tour unseen) and
    // no tip ever showed by itself again (control: T23, an upgrade, shows nothing).
    resetStore({ seen: [], off: false });
    noAgents();
    await page.goto(URL, { waitUntil: 'networkidle' });
    chk(await waitTitle(page, TOUR, 4000), 'T24 precondition: the tour shows by itself');
    await page.evaluate(() => document.querySelector('#tabs [data-tab="projects"]').click());   // no pointerdown
    await page.waitForTimeout(2800);
    const gone24 = await cardState(page);
    chk(!/ of /.test(gone24.step) && !(await api('GET')).seen.includes('tour'), 'T24 precondition: the tour went with its screen, unrecorded', JSON.stringify(gone24));
    // The first save of the met tour fails: it must be tried again, or the next launch is stranded.
    // Routed before the agent arrives, since the catch-up can run on the first tick after it does.
    let failedOnce = 0;
    await page.route('**/api/tips', (route) => {
      const r = route.request();
      if (r.method() === 'PUT' && /"tour"/.test(r.postData() || '') && failedOnce === 0) { failedOnce++; return route.abort(); }
      return route.continue();
    });
    withAgent();
    // The agent is made away from the board (as from New agent's own page); the board learns of it
    // on its next status answer, before the person comes back.
    chk(await page.waitForFunction(() => Array.isArray(LAST) && LAST.length > 0, null, { timeout: 8000 }).then(() => true, () => false), 'T24 precondition: the board has heard of the first agent');
    await page.evaluate(() => document.querySelector('#tabs [data-tab="agents"]').click());
    chk(await waitTitle(page, 'See your agents your way', 8000), 'T24 after the first agent, the screen tips follow a tour that went unrecorded');
    let saved = false;
    for (let i = 0; i < 20 && !saved; i++) { saved = (await api('GET')).seen.includes('tour'); if (!saved) await page.waitForTimeout(500); }
    chk(failedOnce === 1 && saved, 'T24 and the tour is recorded as seen, after a first save that failed', JSON.stringify({ failedOnce, saved }));
    await page.unroute('**/api/tips');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // T25: the tour closed the ordinary way (a click outside) records it, but that save fails. The
    // local list already says seen, so only a retry keyed on what the board confirmed can mend it
    // once the first agent arrives (control: T2, the same close with a save that lands).
    resetStore({ seen: [], off: false });
    noAgents();
    await page.goto(URL, { waitUntil: 'networkidle' });
    chk(await waitTitle(page, TOUR, 4000), 'T25 precondition: the tour shows by itself');
    let failed25 = 0;
    await page.route('**/api/tips', (route) => {
      const r = route.request();
      if (r.method() === 'PUT' && /"tour"/.test(r.postData() || '') && failed25 === 0) { failed25++; return route.abort(); }
      return route.continue();
    });
    // Outside the card, on the dimmed page: near the bottom-left of whatever viewport the check has.
    const vp = page.viewportSize();
    await page.mouse.click(Math.round(vp.width * 0.1), vp.height - 20);
    await page.waitForTimeout(600);
    const closed25 = await cardState(page);
    chk(failed25 === 1 && !/ of /.test(closed25.step) && !(await api('GET')).seen.includes('tour'), 'T25 precondition: the tour closed and its save failed', JSON.stringify({ failed25, closed25 }));
    withAgent();
    let saved25 = false;
    for (let i = 0; i < 24 && !saved25; i++) { saved25 = (await api('GET')).seen.includes('tour'); if (!saved25) await page.waitForTimeout(500); }
    chk(saved25, 'T25 once the first agent arrives, the tour whose save failed is recorded after all');
    await page.unroute('**/api/tips');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // T28: someone new clicks New agent before the tour's first tick (a busy machine: the tips read is
    // slow), so they are on the create form, where the tour never shows. The create form's own tip
    // shows there anyway, and once they have made the agent the tour counts as seen and the screen
    // tips follow. Before, they got nothing, ever. The slow read is what makes the window real; on a
    // fast board the tour is already up and clicking through it records it (T1's path).
    resetStore({ seen: [], off: false });
    noAgents();
    await page.route('**/api/tips', async (route) => {
      if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 3000));
      return route.continue();
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#new-agent', { state: 'visible', timeout: 8000 });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
    chk(await page.evaluate(() => TIPS_STATE === null), 'T28 precondition: the tips have not loaded yet when New agent is clicked');
    await page.click('#new-agent');   // a real click, inside the slow read
    await page.waitForFunction(() => TIPS_STATE !== null, null, { timeout: 10000 }).catch(() => {});   // the held read has finished
    await page.unroute('**/api/tips');
    chk(await page.evaluate(() => tipVisible('#panel-create')), 'T28 precondition: New agent opened the create form');
    chk(await waitTitle(page, 'Make an agent', 8000), 'T28 on the create form, before any tour, the Make an agent tip shows by itself');
    const tourShown28 = await page.evaluate(() => !!document.querySelector('#tipcard .tip-dots'));
    await page.keyboard.press('Escape');
    withAgent();
    await page.waitForFunction(() => Array.isArray(LAST) && LAST.length > 0, null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => showTab('agents'));
    chk(await waitTitle(page, 'See your agents your way', 8000), 'T28 after the first agent, the screen tips follow although the tour never showed');
    chk(!tourShown28 && (await api('GET')).seen.includes('tour'), 'T28 and the tour is recorded as seen', JSON.stringify({ tourShown28 }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // T31: a tip never sits on a real control (0.6.93 cut: the Settings tip took Check for Update's
    // click; Settings has no tip since 2026-09-25). Every screen's tip is opened from the ? and must cover no
    // visible control.
    resetStore({ seen: ['tour', 'ring', 'agents', 'projects', 'project', 'newagent', 'agentpage', 'settings'], off: false });
    withAgent();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => applyLayout('tabs', true));
    const openHere = async () => {
      await page.click('#helpq-btn');
      await page.click('#helpq-menu [data-help="screen"]');
      await page.waitForTimeout(250);
      /* Coverage computed HERE, with its own wider list (anything clickable or focusable), not read back
         from what tipPlace reported about itself. */
      return page.evaluate(() => {
        const c = document.getElementById('tipcard');
        if (!c || c.hidden) return { shown: false };
        const a = c.getBoundingClientRect();
        const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role], [data-agent], [tabindex]:not([tabindex="-1"]), [onclick]';
        const hit = [...document.querySelectorAll(sel)].filter((q) => {
          if (q.closest('#tiplayer, [hidden]') || q.contains(c)) return false;
          const b = q.getBoundingClientRect(); const cs = getComputedStyle(q);
          if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') return false;
          if (!['button', 'link', 'switch', 'tab', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem', null].includes(q.getAttribute('role'))) return false;
          return b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top;
        }).map((q) => q.id || q.className || q.tagName);
        return { shown: true, title: c.querySelector('h2') ? c.querySelector('h2').textContent : null, covers: String(hit.length), hit };
      });
    };
    const screens31 = [
      ['board', async () => { await page.evaluate(() => showTab('agents')); }],
      ['projects', async () => { await page.evaluate(() => showTab('projects')); }],
      ['create', async () => { await page.evaluate(() => openCreate()); }],
      ['agent page', async () => { await page.evaluate(() => { const a = document.querySelector('#grid [data-agent="beatrix"]'); if (a) a.click(); }); }],
    ];   // Settings has no tip since 2026-09-25 (Josh 07:46), so it is not a screen here; T9 and T19 cover its absence
    const got31 = [];
    for (const [name, go] of screens31) {
      await page.keyboard.press('Escape');
      await go();
      await page.waitForTimeout(300);
      const t = await openHere();
      got31.push({ name, shown: t.shown, covers: t.covers, title: t.title });
    }
    /* Each screen's own tip, so a missed click that leaves the page on another screen cannot pass. */
    const want31 = { board: 'See your agents your way', projects: 'A project is shared work', create: 'Make an agent', 'agent page': 'Your agent\'s page' };
    const bad31 = got31.filter((g) => !g.shown || g.covers !== '0' || g.title !== want31[g.name]);
    chk(got31.length === 4 && bad31.length === 0, 'T31 every screen\'s tip opens and covers no visible control', JSON.stringify(bad31.length ? bad31 : got31.map((g) => g.name)));
    await page.keyboard.press('Escape');

    // T32: the whole card stays on screen, whichever side of the fold its target is (#3574, Liu Kang
    // 2026-09-25: a phone layout puts the project tip's target below the composer). The target is one this
    // check places itself, below the fold and then above it; the control is a target in view, which must
    // still get its arrow.
    const place32 = (where, real = false) => page.evaluate(([wh, useReal]) => {
      tipLayerEnsure();
      document.querySelectorAll('[data-t32]').forEach((x) => x.remove());
      const t = document.createElement('div'); t.setAttribute('data-t32', '');
      const top = wh === 'below' ? window.innerHeight + 300 : wh === 'above' ? -400 : wh === 'low' ? window.innerHeight - 70 : Math.round(window.innerHeight / 3);
      const left = wh === 'left' ? -500 : wh === 'right' ? window.innerWidth + 300 : 200;
      t.style.cssText = 'position:fixed;width:120px;height:30px;left:' + left + 'px;top:' + (wh === 'left' || wh === 'right' ? Math.round(window.innerHeight / 3) : top) + 'px';
      document.body.appendChild(t);
      /* On a phone the REAL card is used, so the stylesheet's pinned width and edges apply as they do for a person. */
      let c = useReal ? document.getElementById('tipcard') : null;
      if (!c) { c = document.createElement('div'); c.className = 'tipcard'; c.setAttribute('data-t32', ''); c.style.cssText = 'position:fixed;width:300px;height:180px'; document.getElementById('tiplayer').appendChild(c); }
      const was = document.getElementById('tiplayer').hidden; document.getElementById('tiplayer').hidden = false;
      tipPlace(c, 'div[data-t32]:not(.tipcard)', false, { key: 't32', avoid: false });
      const b = c.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      const out = { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(window.innerWidth - b.right), vh: window.innerHeight, flat: c.classList.contains('flat'),
        onTarget: b.left < tr.right && b.right > tr.left && b.top < tr.bottom && b.bottom > tr.top };
      document.getElementById('tiplayer').hidden = was;
      document.querySelectorAll('[data-t32]').forEach((x) => x.remove());
      return out;
    }, [where, real]);
    const inside = (q) => q.top >= 12 && q.vh - q.bottom >= 12 && q.left >= 11 && q.right >= 11;
    for (const wh of ['below', 'above', 'left', 'right']) {
      const p32 = await place32(wh);
      chk(inside(p32) && p32.flat, 'T32 a target ' + (wh === 'left' || wh === 'right' ? 'off to the ' + wh : wh + ' the fold') + ': the card is wholly on screen, with no arrow', JSON.stringify(p32));
    }
    const in32 = await place32('in view');
    chk(inside(in32) && !in32.flat && !in32.onTarget, 'T32 CONTROL: a target in view keeps its arrow', JSON.stringify(in32));
    // T32b: on a phone with the real card. A target low on the screen (the project tip's Members button under
    // the composer) is a control: main already handled it. The one below the fold is what main got wrong.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.waitForTimeout(200);
    const low32 = await place32('low', true), fold32 = await place32('below', true);
    chk(inside(low32) && !low32.onTarget, 'T32b on a phone, a target low on the screen: the real card is wholly on screen and off its target', JSON.stringify(low32));
    chk(inside(fold32) && fold32.flat, 'T32b on a phone, a target below the fold: the real card is wholly on screen, with no arrow', JSON.stringify(fold32));
    await page.keyboard.press('Escape');
    // T32c: a window shorter than the card (a phone on its side). The words scroll inside the card, so the
    // whole card, its buttons included, still fits on screen.
    await page.setViewportSize({ width: 844, height: 300 });
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.waitForTimeout(250);
    const shortRead = () => page.evaluate(() => { const c = document.getElementById('tipcard'); const b = c.getBoundingClientRect(); const go = c.querySelector('.tip-go').getBoundingClientRect(); const bd = c.querySelector('.tip-bd');
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight, goIn: go.bottom <= window.innerHeight && go.top >= 0, scrolls: !!bd && bd.scrollHeight > bd.clientHeight, tab: bd ? bd.getAttribute('tabindex') : null }; });
    const short32 = await shortRead();
    chk(short32.top >= 12 && short32.vh - short32.bottom >= 12 && short32.goIn && short32.scrolls && short32.tab === '0', 'T32c on a window shorter than the card, it fits with Got it in view, and its words scroll and take the keyboard', JSON.stringify(short32));
    await page.keyboard.press('Escape');
    // T32d: narrow AND short (a phone on its side, the title wrapping), where the words' room is smallest.
    await page.setViewportSize({ width: 360, height: 300 });
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.waitForTimeout(250);
    const narrow32 = await shortRead();
    // T32f: words the person scrolled stay scrolled when the card is placed again (it is, on every resize and tick),
    // and scrolling them places nothing (on WebKit that re-placing looped every frame).
    const kept32 = await page.evaluate(async () => {
      const bd = document.querySelector('#tipcard .tip-bd');
      const real = window.tipPlace; let calls = 0; window.tipPlace = function (...a) { calls++; return real.apply(this, a); };
      try {
        bd.scrollTop = 30; const at = bd.scrollTop;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        /* Read synchronously, so the page's own tip tick cannot land in the measurement: a scroll on the words
           must not queue a placement, and a scroll on the page (the control) must. */
        const idle = TIP_RELAYOUT === false;
        bd.dispatchEvent(new Event('scroll')); const byScroll = TIP_RELAYOUT;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.dispatchEvent(new Event('scroll')); const byPage = TIP_RELAYOUT;
        const before = calls;
        window.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 1300));
        return { at, after: bd.scrollTop, idle, byScroll, byPage, byResize: calls - before };
      } finally { window.tipPlace = real; }
    });
    chk(kept32.at > 0 && kept32.after === kept32.at && kept32.idle && kept32.byScroll === false && kept32.byPage === true && kept32.byResize > 0, 'T32f the words stay where the person scrolled them, and scrolling them places nothing', JSON.stringify(kept32));
    // T32g: a keyboard user on the scrolling words keeps focus in the card when the window grows and the words stop scrolling.
    await page.evaluate(() => document.querySelector('#tipcard .tip-bd').focus());
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(1300);
    const foc32 = await page.evaluate(() => ({ tag: document.activeElement && (document.activeElement.className || document.activeElement.tagName), inCard: !!(document.activeElement && document.activeElement.closest('#tipcard')), tab: document.querySelector('#tipcard .tip-bd').getAttribute('tabindex') }));
    chk(foc32.inCard && foc32.tab === null, 'T32g a keyboard user on the words keeps focus in the card when the window grows', JSON.stringify(foc32));
    await page.setViewportSize({ width: 360, height: 300 });
    await page.waitForTimeout(400);
    chk(narrow32.top >= 12 && narrow32.vh - narrow32.bottom >= 12 && narrow32.goIn, 'T32d narrow and short, the card still fits with Got it in view', JSON.stringify(narrow32));
    await page.keyboard.press('Escape');
    // T32e CONTROL: a tall window gives the words room, so they neither scroll nor add a tab stop.
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.waitForTimeout(250);
    const tall32 = await shortRead();
    chk(!tall32.scrolls && tall32.tab === null, 'T32e CONTROL: on a tall window the words do not scroll and add no tab stop', JSON.stringify(tall32));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(300);

    // T7: a board that cannot say what was seen shows nothing. Seen is emptied first, so a guard
    // that let tips through would show the tour here (control: T1 and T6, the same empty state).
    resetStore({ seen: [], off: false });
    fs.writeFileSync(tipsStore.FILE(), '{ not json');
    chk((await api('GET')).ok === false, 'T7 precondition: the board now answers that it cannot read the tips');
    await page.reload({ waitUntil: 'networkidle' });
    chk(await page.waitForFunction(() => TIPS_STATE !== null && TIPS_TIMER !== null, null, { timeout: 8000 }).then(() => true, () => false), 'T7 precondition: the tips read has answered');
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T7 an unreadable tips store shows no tips rather than all of them');
    const row = await page.evaluate(() => document.getElementById('tips-box')?.hidden);
    chk(row === true, 'T7 and the Settings Tips box is hidden rather than showing a state it did not read');
    // T29: the store is mended while the page still holds the failed read, and the person opens a tip
    // from the ? and closes it. That save is the first real answer, so tips are on again and the
    // Settings box comes back (before, the failed read's stand-in "off" stuck for the session).
    // The read retry (T30) held off, so this arm is about the save: wait out any read in flight first,
    // or its answer would reset the hold.
    await page.waitForFunction(() => !TIPS_LOADING, null, { timeout: 12000 }).catch(() => {});
    await page.evaluate(() => { TIPS_LOAD_NEXT = Infinity; });
    resetStore({ seen: [], off: false });
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    await page.click('#tipcard .tip-go');
    const mended = await page.waitForFunction(() => TIPS_STATE && TIPS_STATE.ok && TIPS_STATE.off === false, null, { timeout: 6000 }).then(() => true, () => false);
    const box29 = await page.evaluate(() => document.getElementById('tips-box')?.hidden);
    chk(mended && box29 === false, 'T29 after a failed read, the first save that answers turns tips back on and shows the Settings box', JSON.stringify({ mended, box29 }));
    await page.keyboard.press('Escape');
    // T30: a failed read is tried again by itself: the store is broken at load, then mended, and with
    // no action from the person the tips come back (control: T7, a store that stays broken, shows none).
    fs.writeFileSync(tipsStore.FILE(), '{ not json');
    await page.reload({ waitUntil: 'networkidle' });
    chk(await page.waitForFunction(() => TIPS_STATE !== null && TIPS_STATE.ok === false, null, { timeout: 8000 }).then(() => true, () => false), 'T30 precondition: the first read failed');
    resetStore({ seen: ['tour', 'ring', 'agents'], off: false });
    const retried = await page.waitForFunction(() => TIPS_STATE && TIPS_STATE.ok === true, null, { timeout: 12000 }).then(() => true, () => false);
    const box30 = await page.evaluate(() => document.getElementById('tips-box')?.hidden);
    chk(retried && box30 === false, 'T30 a failed read is retried and the tips come back without the person doing anything', JSON.stringify({ retried, box30 }));

    // T33 (#3737, Josh 08:51): the tour's dim covers the whole window at every step. The old dim was the ring's 100vmax
    // shadow; WebKit (the app's engine) rounds a shadow that wide at its own size, so a ring in the top right left the
    // bottom-left corner bright (his white triangle). Chromium shrinks that corner, so the corners are read in WebKit
    // too. CONTROL: the same pixels with the tour closed are the page's own bright ground.
    for (const [eng, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
      noAgents();
      resetStore({ seen: [], off: false });
      /* Its own browser, and for Chromium without Playwright's --hide-scrollbars, so the page has a real scrollbar and
         the tab layout's gutter is on screen to be read. */
      const b33 = await launcher.launch({ headless: process.env.HEADED === '0', ...(eng === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
      try {
        const p33 = await b33.newPage({ viewport: { width: 1280, height: 860 } });
        p33.on('pageerror', (e) => errs.push('[T33 ' + eng + '] ' + e.message));   // counted by T8
        await p33.goto(URL, { waitUntil: 'networkidle' });
        if (await p33.$('#firstrun:not([hidden])')) { await p33.keyboard.press('Escape'); await p33.waitForTimeout(400); }
        await waitTitle(p33, TOUR, 8000);
        const corners = async () => [await pixel(p33, 1, 858), await pixel(p33, 1278, 858), await pixel(p33, 1278, 120)];
        const steps33 = [];
        for (let i = 1; i <= 4; i++) {
          const st = await cardState(p33);
          const gutter = await p33.evaluate(() => ({ cls: document.documentElement.classList.contains('tip-dimming'), bg: getComputedStyle(document.documentElement).backgroundColor,
            img: getComputedStyle(document.documentElement).backgroundImage, gw: Math.round(innerWidth - document.documentElement.getBoundingClientRect().width) }));
          steps33.push({ step: st.step, px: await corners(), gutter });
          if (i < 4) { await p33.click('#tipcard .tip-go'); await p33.waitForTimeout(200); }
        }
        const dimmed = (px) => px[0] < 225 && px[1] < 225 && px[2] < 225;
        chk(steps33.length === 4 && steps33.every((x) => x.px.every(dimmed)), 'T33 [' + eng + '] every tour step dims all the way to the window\'s corners', JSON.stringify(steps33));
        /* A gutter paints the canvas's COLOUR, not its image (Chromium with a mouse attached reserves a real 15px gutter
           and left it bright under a gradient dim), so the dimmed ground must be the colour itself. */
        chk(steps33.every((x) => x.gutter.cls && x.gutter.img === 'none' && x.gutter.bg === 'rgb(186, 185, 185)'), 'T33 [' + eng + '] the page ground under the scrollbar gutter is itself the dimmed colour', JSON.stringify(steps33.map((x) => x.gutter)));
        /* The ground the gutter shows while dimmed, per look: light's own ground under the dim, then Kosmos+ navy's,
           which is set on the body where the root cannot see it (the case the body read exists for; without it navy's
           gutter would take light's ground). Where the engine draws overlay scrollbars there is no gutter to read a
           pixel from, so the colour it is painted from is read instead; the corner pixels above cover a real one. */
        const canvas = async () => p33.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
        const lightCanvas = await canvas();
        await p33.evaluate(() => document.body.classList.add('plus-active'));
        await p33.waitForTimeout(1500);   // one tips tick: the app follows the look by itself
        const navyCanvas = await canvas();
        await p33.evaluate(() => document.body.classList.remove('plus-active'));
        await p33.waitForTimeout(1500);
        /* Each is the look's ground (light rgb(250, 249, 247), navy rgb(19, 33, 64)) under the dim, rgba(20, 22, 26, .28). */
        chk(lightCanvas === 'rgb(186, 185, 185)' && navyCanvas === 'rgb(19, 30, 53)', 'T33 [' + eng + '] the gutter is the look\'s own ground, dimmed: light, and Kosmos+ navy', JSON.stringify({ lightCanvas, navyCanvas }));
        await p33.click('#tipcard .tip-go');
        await p33.waitForTimeout(300);
        const after = await corners();
        const cls33 = await p33.evaluate(() => document.documentElement.classList.contains('tip-dimming') || document.documentElement.hasAttribute('data-tip-ground') || getComputedStyle(document.documentElement).backgroundImage !== 'none');
        chk(after.every((px) => px[0] > 240) && !cls33, 'T33 [' + eng + '] CONTROL: closed, the same pixels are the bright page and the gutter dim is gone', JSON.stringify({ after, cls33 }));
        await p33.close();
      } finally { await b33.close(); }
    }

    chk(errs.length === 0, 'T8 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall help-tips checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
