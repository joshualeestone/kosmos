// Browser-check-surface: tipcard tippins tiphalo tip-live tips-row tip-eb tip-x tip-go tip-off tip-skip tip-dots tip-arrow tip-bands tipdim tip-dimming tips-toggle tips-box
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
/* #3755: there is no "?" any more, so an arm that needs a tip on demand opens it the way the page does. */
const openTip = (page, id) => page.evaluate((i) => tipShow(TIPS.find((t) => t.id === i), { returnTo: document.activeElement }), id);
/* The ring's explainer is a step of an agent page's tips now (#3755), but the arms that test how a SCREEN tip is laid
   out, steps aside, scrolls and closes used it as their card, because its words are the longest there are. This opens
   those words as a screen tip, pointing at a ring wherever one shows, and records as the Agents tip. */
const RING = 'Your agent\'s memory';
const openRingTip = (page) => page.evaluate(() => {
  const st = TIPS.find((t) => t.id === 'agentpage').steps[0];
  tipShow({ id: 'agents', title: st.title, body: st.body, side: true, show: () => true,
    at: '#panel-detail #d-ring svg, #grid .agauge:has(.gf), #grid .agauge:has(.gu), #alist .lring' }, { returnTo: document.activeElement });
});
const cardCls = (page) => page.evaluate(() => ['up', 'down', 'left', 'right', 'flat'].find((k) => document.getElementById('tipcard').classList.contains(k)));
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

    // T3 (#3737, Josh 08:51; #3755, Josh 11:07): the ring's explainer lives on the agent's own page, as the first of its
    // steps. On the board it does not show (CONTROL for the arms below: the board's own tip does).
    chk(await waitTitle(page, 'See your agents your way', 4000), 'T3 on the board the Agents tip shows, not the ring tip (#3737)', JSON.stringify(await cardState(page)));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'screen-tip-light.png') });
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);
    // Her page: the ring first (1 of 6), beside it with an arrow, then one tip on each of her five buttons.
    await page.click('#grid [data-agent]');
    chk(await waitTitle(page, RING, 4000), 'T3 on her page the ring shows first (#3755)', JSON.stringify(await cardState(page)));
    const ring = await page.evaluate(() => {
      const c = document.getElementById('tipcard'), r = document.querySelector('#panel-detail #d-ring svg');
      const a = c.getBoundingClientRect(), b = r.getBoundingClientRect();
      const ay = parseFloat(c.style.getPropertyValue('--ay')) || 22, tip = a.top + ay + 7;
      return { dim: !!document.querySelector('#tippins .tiphalo, #tippins .tipdim') || document.documentElement.classList.contains('tip-dimming'),
        step: c.querySelector('.tip-eb').textContent,
        cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)), arrowOnRing: tip >= b.top && tip <= b.bottom,
        gap: Math.round(Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom)),
        body: c.querySelector('.tip-bd').innerText.replace(/\s+/g, ' ').trim(),
        strokes: [...c.querySelectorAll('.tip-bands .gf')].map((x) => getComputedStyle(x).stroke) };
    });
    chk(ring.dim && ring.step === '1 of 6' && ring.strokes.length === 3 && new Set(ring.strokes).size === 3, 'T3 step 1 of 6, the page dimmed, and three distinct gauge colours', JSON.stringify(ring));
    chk(['left', 'right'].includes(ring.cls) && ring.arrowOnRing && ring.gap >= 0 && ring.gap <= 40, 'T3 it points at the ring on her page, from beside it, its arrow on the ring', JSON.stringify(ring));
    chk(ring.body === 'The ring shows how full your agent\'s memory is. Plenty of room Getting full Nearly full This is normal and the agent will automatically write themselves a handoff, You can also manage their memory under AI settings.',
      'T3 in Josh\'s words (#3737)', JSON.stringify(ring.body));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ring-light.png') });
    // A tip that shows by itself is announced in the live region, which is how a screen reader hears it.
    const live = await page.evaluate(() => { const l = document.getElementById('tip-live'); return l ? { text: l.textContent, polite: l.getAttribute('aria-live') } : null; });
    chk(!!live && live.polite === 'polite' && live.text === 'Tip: ' + RING, 'T3 the tip is announced politely by its title', JSON.stringify(live));
    // T16: leaving the screen without a click (the keyboard, Back, a link) closes tips that showed by themselves, without
    // recording them; coming back shows them again. (A click outside a stepped tip ends it and counts, as for the tour: T18.)
    await page.evaluate(() => document.querySelector('#tabs [data-tab="agents"]').click());   // no pointerdown
    await page.waitForTimeout(2800);
    const left16 = await cardState(page);
    chk(!left16.shown, 'T16 leaving her page closes her page\'s tips, and they do not follow to the board', JSON.stringify(left16));
    chk(!(await api('GET')).seen.includes('agentpage'), 'T16 they were not recorded as seen when their screen went away');
    await page.click('#grid [data-agent]');
    chk(await waitTitle(page, RING, 4000), 'T16 coming back to her page shows them again, from the ring');
    // T34 (#3755): Next walks her five buttons in Josh's words, each ringed, each card pointing at its button and
    // off it; Got it on the last records the page's tips.
    const want34 = [
      ['talk', 'Direct Message', 'Talk to your agent directly, ask questions, and give it work to do.'],
      ['profile', 'Profile', 'Give your agent a name, photo, and description.'],
      ['instr', 'Instructions', 'Tell your agent what to do and how you want it to work.'],
      ['model', 'AI Settings', 'Choose the AI model your agent uses and manage its memory.'],
      ['term', 'Advanced', 'Fine-tune your agent\'s technical settings.'],
    ];
    const got34 = [];
    for (let i = 0; i < want34.length; i++) {
      await page.click('#tipcard .tip-go');
      await page.waitForTimeout(150);
      got34.push(await page.evaluate((go) => {
        const c = document.getElementById('tipcard'), h = document.querySelector('#tippins .tiphalo'), b = document.querySelector('#d-nav [data-go="' + go + '"]');
        const a = c.getBoundingClientRect(), hr = h ? h.getBoundingClientRect() : null, br = b.getBoundingClientRect();
        return { step: c.querySelector('.tip-eb').textContent, title: c.querySelector('h2').textContent, body: c.querySelector('.tip-bd').innerText.trim(),
          ringed: !!hr && Math.abs(hr.left + 4 - br.left) <= 1 && Math.abs(hr.top + 4 - br.top) <= 1,
          cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)),
          overButton: a.left < br.right && a.right > br.left && a.top < br.bottom && a.bottom > br.top };
      }, want34[i][0]));
    }
    const bad34 = got34.filter((g, i) => g.step !== (i + 2) + ' of 6' || g.title !== want34[i][1] || g.body !== want34[i][2] || !g.ringed || g.cls === 'flat' || g.overButton);
    chk(got34.length === 5 && bad34.length === 0, 'T34 her page walks her five buttons in Josh\'s words, each ringed and pointed at, none covered', JSON.stringify(bad34.length ? bad34 : got34.map((g) => g.title)));
    chk(await page.evaluate(() => document.querySelector('#tipcard .tip-go').textContent) === 'Got it', 'T34 the last step closes with Got it');
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);
    const seen34 = (await api('GET')).seen;
    chk(!(await cardState(page)).shown && seen34.includes('agentpage') && seen34.includes('ring'), 'T34 Got it closes her page\'s tips and counts them, and the ring\'s, as seen', JSON.stringify(seen34));
    await page.click('#tabs [data-tab="agents"]');
    await page.waitForTimeout(300);
    // T3c: an agent whose memory is unknown has no ring on her page, so the ring step is left out and her page's
    // tips start at Direct Message, 1 of 5 (CONTROL: the same page with a reading starts at the ring, T3 above).
    const seen3c = (await api('GET')).seen;
    resetStore({ seen: seen3c.filter((id) => id !== 'agentpage' && id !== 'ring'), off: false });
    await page.evaluate(() => localStorage.removeItem('aw-check-ctx'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('#grid [data-agent]');
    chk(await waitTitle(page, 'Direct Message', 4000), 'T3c unknown memory: her page\'s tips start at Direct Message');
    const t3c = await page.evaluate(() => ({ ring: !!document.querySelector('#panel-detail #d-ring svg'), step: document.querySelector('#tipcard .tip-eb').textContent }));
    chk(!t3c.ring && t3c.step === '1 of 5', 'T3c no ring on her page, and no ring step: 1 of 5', JSON.stringify(t3c));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const seen3c2 = (await api('GET')).seen;
    chk(seen3c2.includes('agentpage') && !seen3c2.includes('ring'), 'T3c closing them records her page\'s tips, not the ring\'s it never showed', JSON.stringify(seen3c2));
    // T3e: the first time her page draws a ring after that, the ring's explainer shows by itself, beside it, once.
    // (A new agent has no reading on its first visit, so this is how someone new meets it.)
    await page.click('#tabs [data-tab="agents"]');
    await page.evaluate(() => localStorage.setItem('aw-check-ctx', '62'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('#grid [data-agent]');
    chk(await waitTitle(page, RING, 5000), 'T3e with a reading now, the ring\'s explainer shows by itself on her page');
    const t3e = await page.evaluate(() => { const c = document.getElementById('tipcard'); return { eb: c.querySelector('.tip-eb').textContent, cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)), bands: c.querySelectorAll('.tip-bands .gf').length }; });
    chk(t3e.eb === 'Tip' && ['left', 'right'].includes(t3e.cls) && t3e.bands === 3, 'T3e on its own (not a step), beside the ring, with its three colours', JSON.stringify(t3e));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    chk((await api('GET')).seen.includes('ring'), 'T3e closing it records it');
    await page.evaluate(() => localStorage.removeItem('aw-check-ctx'));
    resetStore({ seen: seen3c, off: false });
    await page.click('#tabs [data-tab="agents"]');
    await page.reload({ waitUntil: 'networkidle' });

    // T4: a reload does not bring back what was closed (control: T1-T3 each showed before closing).
    await page.reload({ waitUntil: 'networkidle' });
    chk(await tipsRunning(page), 'T4 precondition: the tips code is running');
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T4 after a reload nothing closed returns on the board');

    // T23: a board that already has agents (an upgrade) shows nothing by itself, even with nothing
    // seen: not the tour, and not the screen tips that follow it (control: T1 and T24, the same
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
    resetStore({ seen: ['tour', 'agents'], off: false });
    await page.reload({ waitUntil: 'networkidle' });

    // T5 (#3755, Josh 11:07: "let's remove this circle? and tooltip controller"): no "?" in the header and nothing that
    // names it, and the Settings switch no longer sends anyone to it. CONTROL: the header next to it is on screen.
    const t5 = await page.evaluate(() => ({ header: tipVisible('#userpop-btn'),
      gone: !document.getElementById('helpq') && !document.getElementById('helpq-btn') && !document.getElementById('helpq-menu') && !document.querySelector('[data-help], button[aria-label="Help"]'),
      qBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '?' && b.getBoundingClientRect().width > 0),
      hint: document.querySelector('#tips-row .dhint')?.textContent || null }));
    chk(t5.header && t5.gone && !t5.qBtn, 'T5 no "?" beside the name, and no help menu (#3755)', JSON.stringify(t5));
    chk(t5.hint === 'A short note the first time you open each screen.', 'T5 the Settings tips line no longer points at the ?', JSON.stringify(t5.hint));
    chk(await page.evaluate(() => !TIPS.some((t) => /\?/.test(t.body || '') || (t.steps || []).some((st) => /\?/.test(st.body)))), 'T5 no tip\'s words point at the ?');
    await openRingTip(page);
    chk((await cardState(page)).title === RING && ['left', 'right', 'up', 'down'].includes(await cardCls(page)), 'T5 a screen tip on the board points at a card\'s ring (the arms below use it)', 'cls=' + await cardCls(page));

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
    resetStore({ seen: ['tour', 'agents'], off: false });
    withAgent();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // T9: each screen shows its own tip, once.
    // No tip on Create Agent (#3755, Josh: "let's kill this tooltip from the Create the Agent page"). CONTROL: the
    // Projects tip, next, shows from the same state.
    await page.click('#new-agent');
    chk(await tipsRunning(page), 'T9 precondition: the tips code is running');
    await page.waitForTimeout(2800);
    chk(await page.evaluate(() => tipVisible('#panel-create')) && !(await cardState(page)).shown, 'T9 Create Agent shows no tip (#3755)', JSON.stringify(await cardState(page)));
    await page.click('#tabs [data-tab="projects"]');
    chk(await waitTitle(page, 'Setup a Project', 5000), 'T9 Projects shows its tip: Setup a Project');
    chk(await page.evaluate(() => document.querySelector('#tipcard .tip-bd').innerText.trim()) === 'Add multiple agents to work together in one conversation with shared files and tasks.', 'T9 in Josh\'s words (#3755)');
    // T15: a tip that opened by itself, closed from the keyboard, leaves focus on the page, not on a card that is gone
    // (nor on some other control). The engine may do this by itself as the card hides; the arm is about the outcome.
    await page.evaluate(() => document.querySelector('#tipcard .tip-go').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const fAuto = await page.evaluate(() => ({ body: document.activeElement === document.body, inCard: !!document.activeElement?.closest('#tipcard') }));
    chk(fAuto.body && !fAuto.inCard, 'T15 closing an auto tip from the keyboard leaves focus on the page', JSON.stringify(fAuto));
    await page.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tips Room' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
    });
    await page.reload({ waitUntil: 'networkidle' });
    // T35 (#3755, Josh: "four separate things that highlighted each of the areas"): inside a project, four steps, each
    // ringing its own area, the card pointing at it and off it.
    await page.click('#tabs [data-tab="projects"]');
    await page.locator('#pj-list').getByText('Tips Room').first().click();
    chk(await waitTitle(page, 'Members', 5000), 'T35 inside a project the first step is Members');
    const want35 = [
      ['.pjcard-members', 'Members', 'Members are the agents on it. Add more any time.'],
      ['> .pjmid', 'Conversation', 'Conversation is where you talk to all of them at once.'],
      ['.pjcard-files', 'Files', 'Files collects everything they make.'],
      ['> aside.pjcol:not(.pjsplit)', 'Tasks', 'Tasks is the to-do list, and who is on each one.'],
    ];
    const got35 = [];
    for (let i = 0; i < want35.length; i++) {
      if (i) { await page.click('#tipcard .tip-go'); await page.waitForTimeout(150); }
      got35.push(await page.evaluate((sel) => {
        const c = document.getElementById('tipcard'), h = document.querySelector('#tippins .tiphalo'), b = document.querySelector('#panel-projects .pj3 ' + sel);
        const a = c.getBoundingClientRect(), hr = h ? h.getBoundingClientRect() : null, br = b.getBoundingClientRect();
        return { step: c.querySelector('.tip-eb').textContent, title: c.querySelector('h2').textContent, body: c.querySelector('.tip-bd').innerText.trim(),
          ringed: !!hr && Math.abs(hr.left + 4 - br.left) <= 1 && Math.abs(hr.top + 4 - br.top) <= 1,
          dim: document.documentElement.classList.contains('tip-dimming'),
          cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)),
          overArea: a.left < br.right && a.right > br.left && a.top < br.bottom && a.bottom > br.top,
          // How far into the area the card reaches, and which real controls it sits on (kosmos#2624, below).
          depth: Math.max(0, Math.min(a.bottom, br.bottom) - Math.max(a.top, br.top)), areaH: br.height,
          onControls: [...document.querySelectorAll('button, a[href], input, textarea, select, [role=tab], [contenteditable=true]')]
            .filter((e) => { if (e.closest('#tipcard') || e.closest('[hidden]')) return false; const q = e.getBoundingClientRect(); return q.width && q.height && q.left < a.right && q.right > a.left && q.top < a.bottom && q.bottom > a.top; })
            .map((e) => (e.closest('.apphead') ? 'HEADER ' : '') + (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0])) };
      }, want35[i][0]));
    }
    /* kosmos#2624: "none covered" is measured as the engine's own rule (tipPlace, 0.6.93: a tip must never sit on a
       real control), plus the area itself. The Conversation column fills the window from just under the header to
       near its bottom, so at 1280x860 no pointing place clears it: before #2624 the card went ABOVE, over the tab
       bar (it sat on both tab buttons, y 14..160, measured), and this check could not see that because it looked
       only at the area. With the flush #2624 header it goes BELOW and reaches 20px into the column's bottom edge,
       covering no control. So: no step may sit on the header's controls (new; it reds the pre-#2624 placement), and a
       card that reaches into its own area may cover at most 5% of the area's height (an edge sliver of a column that
       fills the window, never its content: 20px of 576 here is 3.5%) and no control while it does. A card that
       stays off its area may still sit on a neighbour's control when every place does (the engine picks the one
       covering least; Members, over the Files card, does this on main too). */
    const bad35 = got35.filter((g, i) => g.step !== (i + 1) + ' of 4' || g.title !== want35[i][1] || g.body !== want35[i][2] || !g.ringed || !g.dim || g.cls === 'flat'
      || g.onControls.some((c) => c.startsWith('HEADER ')) || (g.overArea && (g.depth > 0.05 * g.areaH || g.onControls.length > 0)));
    chk(got35.length === 4 && bad35.length === 0, 'T35 a project\'s tips walk its four areas, each ringed and pointed at, none covered', JSON.stringify(bad35.length ? bad35 : got35.map((g) => g.title)));
    // T35b (#3920): a target that fills the window (the Conversation column under #2624's taller header) leaves no room
    // above or below and side columns narrower than the card. The card must go BESIDE it, narrowed to the room there,
    // arrow kept, never on the target. The real tipPlace, on the open card, at synthetic targets (current main still has
    // room above the column, so the real page cannot reach this case yet). Control: a target with too little side room
    // keeps today's full-width fallback, so the narrowing cannot fire where it should not.
    const syn3920 = await page.evaluate(() => {
      const c = document.getElementById('tipcard');
      const one = (left, width) => {
        const d = document.createElement('div');
        // A data attribute, not an id: the page has no such element, and #758's guard rightly checks every id a check asks for.
        d.setAttribute('data-tip3920', '');
        d.style.cssText = 'position:fixed;left:' + left + 'px;top:8px;width:' + width + 'px;height:' + (innerHeight - 16) + 'px;';
        document.body.appendChild(d);
        tipPlace(c, '[data-tip3920]', false, { key: 'check-3920', avoid: false });
        const a = c.getBoundingClientRect(), br = d.getBoundingClientRect();
        const out = { cls: ['up', 'down', 'left', 'right', 'flat'].find((k) => c.classList.contains(k)), width: Math.round(a.width),
          over: a.left < br.right && a.right > br.left && a.top < br.bottom && a.bottom > br.top,
          onScreen: a.left >= 0 && a.right <= innerWidth && a.top >= 0 && a.bottom <= innerHeight };
        d.remove();
        return out;
      };
      const room = one(270, innerWidth - 540), tight = one(200, innerWidth - 400);
      window.dispatchEvent(new Event('resize'));   // the open tip places itself again at its own target
      return { room, tight };
    });
    chk((syn3920.room.cls === 'left' || syn3920.room.cls === 'right') && !syn3920.room.over && syn3920.room.onScreen && syn3920.room.width >= 220 && syn3920.room.width < 300,
      'T35b a target that fills the window gets the card beside it, narrowed, arrow kept, off the target', JSON.stringify(syn3920.room));
    chk(syn3920.tight.width === 300, 'T35b control: with too little side room the card keeps its full width (the narrowing did not fire)', JSON.stringify(syn3920.tight));
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);
    // Settings has no tip (Josh 2026-09-25 07:46): opening it shows none.
    await page.click('#userpop-btn'); await page.click('#userpop-settings');
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T9 Settings shows no tip (it has none)', JSON.stringify(await cardState(page)));
    await page.click('#tabs [data-tab="agents"]'); await page.waitForTimeout(300); await page.click('[data-agent="beatrix"]');
    chk(await waitTitle(page, 'Direct Message', 5000), 'T9 an agent\'s page shows its tips (no memory reading here, so from Direct Message)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const seenNow = (await api('GET')).seen;
    chk(['projects', 'project', 'agentpage'].every((id) => seenNow.includes(id)) && !seenNow.includes('settings') && !seenNow.includes('newagent'), 'T9 each closed screen tip is recorded, and no Settings or Create Agent one', JSON.stringify(seenNow));
    await page.click('#tabs [data-tab="projects"]');
    await page.waitForTimeout(2800);
    const again2 = await cardState(page);
    chk(!(again2.shown && again2.title === 'Setup a Project'), 'T9 the Projects tip does not return (control: it showed above)', JSON.stringify(again2));

    // T13: a dialog opened while a tip is up makes the tip step aside, and it comes back after.
    await openRingTip(page);
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
    chk(underDialog === false && afterDialog.shown && afterDialog.title === RING,
      'T13 a tip steps aside while a dialog is open and returns when it closes', JSON.stringify({ underDialog, afterDialog }));
    await page.keyboard.press('Escape');

    // T17: an Escape meant for a dialog closes the dialog, not the tip behind it. The stand-in closes
    // on Escape from a bubble-phase listener, the way the app's dialogs do.
    await openRingTip(page);
    await page.evaluate(() => {
      const d = document.createElement('div'); d.className = 'rm-back'; document.body.appendChild(d); window.__tipsStandIn = d;
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && window.__tipsStandIn) { window.__tipsStandIn.remove(); delete window.__tipsStandIn; document.removeEventListener('keydown', esc); } });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1600);
    const esc17 = await page.evaluate(() => ({ dialogGone: !window.__tipsStandIn, card: !document.getElementById('tipcard').hidden, title: document.querySelector('#tipcard h2')?.textContent }));
    chk(esc17.dialogGone && esc17.card && esc17.title === RING, 'T17 one Escape closes the dialog and leaves the tip', JSON.stringify(esc17));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    chk(!(await cardState(page)).shown, 'T17 control: with no dialog, the same Escape closes the tip');

    // T18: every way out of the tour and the tips works. Skip ends the tour; the x closes a screen tip;
    // a click outside ends the tour. A click on a dialog that opened over the tour does NOT end it:
    // the tour steps aside and comes back when the dialog closes.
    // On the board, so the tour starts at its first step (a step whose place is off screen is left out).
    await page.click('#tabs [data-tab="agents"]');
    await page.waitForTimeout(300);
    const openTour = async () => { await openTip(page, 'tour'); await page.waitForTimeout(150); };
    await openTour();
    await page.click('#tipcard .tip-skip');
    chk(!(await cardState(page)).shown, 'T18 Skip ends the tour');
    await openRingTip(page);
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

    // T14: the card follows its target when the page scrolls. No screen with a tip scrolls at this size since Create
    // Agent lost its tip (#3755), so this opens a screen tip on the create form's heading, as its tip was.
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.evaluate(() => openCreate());
    await page.waitForTimeout(400);
    await page.evaluate(() => tipShow({ id: 'agents', title: 'Make an agent', at: '#panel-create h2', side: true, show: () => true,
      body: '<p>Give it a name and a picture so you can tell it apart, then tell it what the job is in plain words. You can change all of it later.</p>' }));
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
    /* It FOLLOWED: the card moved up by the scroll (a card that stayed put while its heading moved fails here). */
    const moved = top0 - after14.top;
    /* A side card within a pixel: its place is rounded to a whole pixel, and with a scrollbar gutter reserved (a Mac
       with a mouse) the page's centre, and so the heading's edge, falls on a half pixel. Above or below, exact. */
    const gapOk14 = ['left', 'right'].includes(after14.cls) ? Math.abs(after14.gap - want14) <= 1 : after14.gap === want14;
    chk(title14 === 'Make an agent' && scrolled > 0 && after14.headOn && after14.cls !== 'flat' && Math.abs(moved - scrolled) <= 1 && after14.onScreen && after14.covers === '0' && gapOk14,
      'T14 after a scroll the card still points at its target from its gap, or sits clear of every control', JSON.stringify({ top0, scrolled, after14 }));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.click('#tabs [data-tab="agents"]');

    // T10: on a narrow window the card is pinned 12px from each edge with no arrow.
    await page.click('#tabs [data-tab="agents"]');
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    await openRingTip(page);
    const narrow = await page.evaluate(() => { const c = document.getElementById('tipcard'); const r = c.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), arrow: getComputedStyle(c.querySelector('.tip-arrow')).display }; });
    chk(narrow.left === 12 && narrow.right >= 12 && narrow.arrow === 'none', 'T10 at 390 wide the card sits 12px in from the edges with no arrow', JSON.stringify(narrow));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(300);

    // T11: the card takes each scheme's elevated ground (control: the two differ).
    const ground = async () => {
      await openRingTip(page);
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
    // the tour does not start by itself (it belongs to the board).
    resetStore({ seen: ['agents', 'settings'], off: false });
    await page.goto(URL + '/?tab=settings', { waitUntil: 'load' });
    await page.waitForTimeout(2800);
    const onSettings = await page.evaluate(() => ({ settings: !document.getElementById('panel-settings').hidden, card: !document.getElementById('tipcard')?.hidden, title: document.querySelector('#tipcard h2')?.textContent || null }));
    chk(onSettings.settings && !(onSettings.card && onSettings.title === TOUR_TITLE_IN_PAGE), 'T19 under the consolidated layout the tour does not start by itself over Settings', JSON.stringify(onSettings));
    if (onSettings.card) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);
    /* T20 needs a SCREEN tip open: the ring's words, as a screen tip. */
    await openRingTip(page);
    chk(await waitTitle(page, RING, 4000), 'T20 precondition: a screen tip is open');
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
    // T3d (#3737): the ring step in the consolidated layout, where her ring sits at the left of the middle column (the
    // agent rail to its left, her name and buttons below): still beside it, its arrow on the ring.
    resetStore({ seen: ['tour', 'agents', 'projects', 'project'], off: false });
    withAgent();
    await page.evaluate(() => localStorage.setItem('aw-check-ctx', '62'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Array.isArray(LAST) && LAST.some((a) => a.sessionName === 'beatrix'), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => openDetail('beatrix', 'talk'));
    chk(await waitTitle(page, RING, 6000), 'T3d under the consolidated layout her page\'s tips start at the ring', JSON.stringify(await cardState(page)));
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
    await openRingTip(page);
    await page.click('#userpop-btn');
    await page.waitForTimeout(80);
    const underMenu = await page.evaluate(() => ({ menu: !document.getElementById('userpop-menu').hidden, card: !document.getElementById('tipcard').hidden }));
    await page.click('#userpop-btn');
    await page.waitForTimeout(80);
    const afterMenu = await page.evaluate(() => ({ menu: !document.getElementById('userpop-menu').hidden, card: !document.getElementById('tipcard').hidden }));
    chk(underMenu.menu && !underMenu.card && !afterMenu.menu && afterMenu.card, 'T21 a tip steps aside at once while a header menu is open and returns when it closes', JSON.stringify({ underMenu, afterMenu }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

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
    // slow), so they are on the create form, where the tour never shows (and which has no tip of its own since
    // #3755). Once they have made the agent the tour counts as seen and the screen tips follow. Before, they got nothing, ever. The slow read is what makes the window real; on a
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
    await page.waitForTimeout(2800);
    const tourShown28 = await page.evaluate(() => !!document.querySelector('#tipcard:not([hidden]) .tip-dots'));
    chk(!(await cardState(page)).shown, 'T28 on the create form, before any tour, no tip shows (#3755)', JSON.stringify(await cardState(page)));
    withAgent();
    await page.waitForFunction(() => Array.isArray(LAST) && LAST.length > 0, null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => showTab('agents'));
    chk(await waitTitle(page, 'See your agents your way', 8000), 'T28 after the first agent, the screen tips follow although the tour never showed');
    chk(!tourShown28 && (await api('GET')).seen.includes('tour'), 'T28 and the tour is recorded as seen', JSON.stringify({ tourShown28 }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // T31: a tip never sits on a real control (0.6.93 cut: the Settings tip took Check for Update's
    // click; Settings has no tip since 2026-09-25). Every screen tip must cover no visible control. (The stepped tips,
    // a project's and an agent page's, dim the page and end on any click outside, so they only keep off their
    // ringed place: T34 and T35.)
    resetStore({ seen: ['tour', 'agents', 'projects', 'project', 'agentpage', 'settings'], off: false });
    withAgent();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => applyLayout('tabs', true));
    const openHere = async (id) => {
      await openTip(page, id);
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
      ['board', 'agents', async () => { await page.evaluate(() => showTab('agents')); }],
      ['projects', 'projects', async () => { await page.evaluate(() => showTab('projects')); }],
    ];   // Settings and Create Agent have no tip (Josh 07:46, and #3755); T9 covers their absence
    const got31 = [];
    for (const [name, id, go] of screens31) {
      await page.keyboard.press('Escape');
      await go();
      await page.waitForTimeout(300);
      const t = await openHere(id);
      got31.push({ name, shown: t.shown, covers: t.covers, title: t.title });
    }
    /* Each screen's own tip, and it points at something on that screen, so a page left on another screen cannot pass. */
    const want31 = { board: 'See your agents your way', projects: 'Setup a Project' };
    const bad31 = got31.filter((g) => !g.shown || g.covers !== '0' || g.title !== want31[g.name]);
    chk(got31.length === 2 && bad31.length === 0, 'T31 every screen\'s tip opens and covers no visible control', JSON.stringify(bad31.length ? bad31 : got31.map((g) => g.name)));
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
    await openRingTip(page);
    await page.waitForTimeout(200);
    const low32 = await place32('low', true), fold32 = await place32('below', true);
    chk(inside(low32) && !low32.onTarget, 'T32b on a phone, a target low on the screen: the real card is wholly on screen and off its target', JSON.stringify(low32));
    chk(inside(fold32) && fold32.flat, 'T32b on a phone, a target below the fold: the real card is wholly on screen, with no arrow', JSON.stringify(fold32));
    await page.keyboard.press('Escape');
    // T32c: a window shorter than the card (a phone on its side). The words scroll inside the card, so the
    // whole card, its buttons included, still fits on screen.
    await page.setViewportSize({ width: 844, height: 300 });
    await page.waitForTimeout(300);
    await openRingTip(page);
    await page.waitForTimeout(250);
    const shortRead = () => page.evaluate(() => { const c = document.getElementById('tipcard'); const b = c.getBoundingClientRect(); const go = c.querySelector('.tip-go').getBoundingClientRect(); const bd = c.querySelector('.tip-bd');
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight, goIn: go.bottom <= window.innerHeight && go.top >= 0, scrolls: !!bd && bd.scrollHeight > bd.clientHeight, tab: bd ? bd.getAttribute('tabindex') : null }; });
    const short32 = await shortRead();
    chk(short32.top >= 12 && short32.vh - short32.bottom >= 12 && short32.goIn && short32.scrolls && short32.tab === '0', 'T32c on a window shorter than the card, it fits with Got it in view, and its words scroll and take the keyboard', JSON.stringify(short32));
    await page.keyboard.press('Escape');
    // T32d: narrow AND short (a phone on its side, the title wrapping), where the words' room is smallest.
    await page.setViewportSize({ width: 360, height: 300 });
    await page.waitForTimeout(300);
    await openRingTip(page);
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
    await openRingTip(page);
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
    // T29: the store is mended while the page still holds the failed read, and the person closes a tip. That save is the first real answer, so tips are on again and the
    // Settings box comes back (before, the failed read's stand-in "off" stuck for the session).
    // The read retry (T30) held off, so this arm is about the save: wait out any read in flight first,
    // or its answer would reset the hold.
    await page.waitForFunction(() => !TIPS_LOADING, null, { timeout: 12000 }).catch(() => {});
    await page.evaluate(() => { TIPS_LOAD_NEXT = Infinity; });
    resetStore({ seen: [], off: false });
    await openRingTip(page);
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
    resetStore({ seen: ['tour', 'agents'], off: false });
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
