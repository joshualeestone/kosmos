// Browser-check-surface: tipcard tipdim tippins tippin tip-go tip-off tip-arrow tip-bands helpq helpq-btn helpq-menu data-help tips-toggle tips-row
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

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const tipsStore = require('../../engine/tips');

const SHOTS = process.argv[2] || null;
const TOUR = 'Four places to know';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const cardState = (page) => page.evaluate(() => {
  const c = document.getElementById('tipcard');
  const h = c && c.querySelector('h2');
  return { shown: !!c && !c.hidden, title: h ? h.textContent : null,
    dim: !document.getElementById('tipdim').hidden, pins: document.querySelectorAll('#tippins .tippin').length,
    items: c ? c.querySelectorAll('ol li').length : 0 };
});
const waitTitle = (page, title, ms) => page.waitForFunction((t) => { const c = document.getElementById('tipcard'); return c && !c.hidden && c.querySelector('h2')?.textContent === t; }, title, { timeout: ms }).then(() => true, () => false);
/* The store, written directly: the API only ever adds to seen, which is the product rule. */
const resetStore = (state) => fs.writeFileSync(tipsStore.FILE(), JSON.stringify(state));

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);
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

    // T1: the welcome tour shows once on the board, dims the screen, and numbers exactly the places
    // its card lists.
    chk(await waitTitle(page, TOUR, 4000), 'T1 the welcome tour shows on the board after first run');
    const tour = await cardState(page);
    chk(tour.dim && tour.pins === 4 && tour.items === 4, 'T1 it dims, and numbers four places with four pins', JSON.stringify(tour));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'tour-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: path.join(SHOTS, 'tour-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }

    // T2: Got it closes it and the board remembers.
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);
    const closed = await cardState(page);
    chk(!closed.shown && !closed.dim, 'T2 Got it closes the tour and the dim');
    chk((await api('GET')).seen.includes('tour'), 'T2 the board records the tour as seen');

    // T3: the ring tip then shows by itself on the board (a card has a ring), as a screen tip.
    chk(await waitTitle(page, 'The ring is your agent\'s memory', 4000), 'T3 the ring tip shows by itself on the board');
    const ring = await page.evaluate(() => ({ dim: !document.getElementById('tipdim').hidden, bands: document.querySelectorAll('#tipcard .tip-bands .gf').length }));
    chk(!ring.dim && ring.bands === 3, 'T3 it is a screen tip, with no dim, and the three gauge colours', JSON.stringify(ring));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ring-light.png') });
    // T16: leaving the screen closes a tip that showed by itself, without recording it, and the next
    // screen's tip can show; coming back shows it again.
    await page.click('#tabs [data-tab="projects"]');
    chk(await waitTitle(page, 'A project is shared work', 4000), 'T16 leaving the board closes the ring tip and the Projects tip shows');
    chk(!(await api('GET')).seen.includes('ring'), 'T16 the ring tip was not recorded as seen when its screen went away');
    await page.click('#tipcard .tip-go');
    await page.click('#tabs [data-tab="agents"]');
    chk(await waitTitle(page, 'The ring is your agent\'s memory', 4000), 'T16 coming back to the board shows the ring tip again');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    chk(!(await cardState(page)).shown && (await api('GET')).seen.includes('ring'), 'T3 Escape closes it and counts as seen');

    // T3b: the Agents tip follows it, pointing at the view switch.
    chk(await waitTitle(page, 'See your agents your way', 4000), 'T3b the Agents tip follows on the board');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'screen-tip-light.png') });
    await page.click('#tipcard .tip-go');
    await page.waitForTimeout(300);

    // T4: a reload does not bring back what was closed (control: T1-T3b each showed before closing).
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T4 after a reload nothing closed returns on the board');

    // T5: the ? menu brings any of it back, closes the user menu, and returns focus to the ?.
    await page.click('#userpop-btn');
    await page.click('#helpq-btn');
    const menus = await page.evaluate(() => ({ help: !document.getElementById('helpq-menu').hidden, user: !document.getElementById('userpop-menu').hidden }));
    chk(menus.help && !menus.user, 'T5 opening the ? closes the user menu', JSON.stringify(menus));
    await page.click('#helpq-menu [data-help="tour"]');
    const again = await cardState(page);
    chk(again.shown && again.title === TOUR, 'T5 Take the welcome tour again shows the tour', JSON.stringify(again));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const focusAfter = await page.evaluate(() => document.activeElement && document.activeElement.id);
    chk(focusAfter === 'helpq-btn', 'T5 closing it returns focus to the ?', 'focus=' + focusAfter);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    chk((await cardState(page)).title === 'The ring is your agent\'s memory', 'T5 What does the ring mean shows the ring explainer');

    // T6: Stop showing tips turns them off in one write, and the Settings switch reads it. With tips
    // off and nothing seen, nothing shows; turning the switch on shows the tour from that same state
    // (the control).
    await page.click('#tipcard .tip-off');
    await page.waitForTimeout(400);
    chk((await api('GET')).off === true, 'T6 Stop showing tips turns tips off on the board');
    const sw = await page.evaluate(() => document.getElementById('tips-toggle')?.getAttribute('aria-checked'));
    chk(sw === 'false', 'T6 the Settings switch reads off', 'aria-checked=' + sw);
    resetStore({ seen: [], off: true });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T6 with tips off and nothing seen, no tip shows');
    await page.evaluate(() => document.getElementById('tips-toggle').click());
    chk(await waitTitle(page, TOUR, 4000), 'T6 control: turning the switch on shows the tour from the same state');
    chk((await api('GET')).off === false, 'T6 the Settings switch turns tips back on');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    resetStore({ seen: ['tour', 'ring', 'agents'], off: false });
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
    await visit('Settings', async () => { await page.click('#userpop-btn'); await page.click('#userpop-settings'); }, 'Settings for this computer');
    await visit('an agent\'s page', async () => { await page.click('#tabs [data-tab="agents"]'); await page.waitForTimeout(300); await page.click('[data-agent="beatrix"]'); }, 'Your agent\'s page');
    const seenNow = (await api('GET')).seen;
    chk(['newagent', 'projects', 'project', 'settings', 'agentpage'].every((id) => seenNow.includes(id)), 'T9 each closed screen tip is recorded', JSON.stringify(seenNow));
    await page.click('#tabs [data-tab="projects"]');
    await page.waitForTimeout(2800);
    const again2 = await cardState(page);
    chk(!(again2.shown && again2.title === 'A project is shared work'), 'T9 the Projects tip does not return (control: it showed above)', JSON.stringify(again2));

    // T13: a dialog opened while a tip is up makes the tip step aside, and it comes back after.
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    // A stand-in dialog: the app's dialogs are .rm-back overlays. Held by reference, not by an id.
    await page.evaluate(() => { const d = document.createElement('div'); d.className = 'rm-back'; document.body.appendChild(d); window.__tipsStandIn = d; });
    await page.waitForTimeout(1600);
    const underDialog = (await cardState(page)).shown;
    await page.evaluate(() => { window.__tipsStandIn.remove(); delete window.__tipsStandIn; });
    await page.waitForTimeout(1600);
    const afterDialog = await cardState(page);
    chk(underDialog === false && afterDialog.shown && afterDialog.title === 'The ring is your agent\'s memory',
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
    chk(esc17.dialogGone && esc17.card && esc17.title === 'The ring is your agent\'s memory', 'T17 one Escape closes the dialog and leaves the tip', JSON.stringify(esc17));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    chk(!(await cardState(page)).shown, 'T17 control: with no dialog, the same Escape closes the tip');

    // T14: the card follows its target when the page scrolls.
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.click('#userpop-btn');
    await page.click('#userpop-settings');
    await page.waitForTimeout(300);
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="screen"]');
    const top0 = await page.evaluate(() => document.getElementById('tipcard').getBoundingClientRect().top);
    const scrolled = await page.evaluate(async () => { const y = window.scrollY; window.scrollBy(0, 120); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return window.scrollY - y; });
    const top1 = await page.evaluate(() => document.getElementById('tipcard').getBoundingClientRect().top);
    chk(scrolled > 0 && Math.round(top0 - top1) === Math.round(scrolled), 'T14 scrolling moves the card with its target', JSON.stringify({ top0, top1, scrolled }));
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
    await page.click('#helpq-menu [data-help="tour"]');
    const cons = await cardState(page);
    const words = ['', 'One place', 'Two places', 'Three places', 'Four places'];
    chk(cons.shown && cons.pins === cons.items && cons.items === 4 && cons.title === words[cons.items] + ' to know',
      'T12 under the consolidated layout the tour still finds all four places (the rail heads) and its title counts them', JSON.stringify(cons));
    await page.keyboard.press('Escape');
    await page.evaluate(() => applyLayout('tabs', true));

    // T7: a board that cannot say what was seen shows nothing. Seen is emptied first, so a guard
    // that let tips through would show the tour here (control: T1 and T6, the same empty state).
    resetStore({ seen: [], off: false });
    fs.writeFileSync(tipsStore.FILE(), '{ not json');
    chk((await api('GET')).ok === false, 'T7 precondition: the board now answers that it cannot read the tips');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T7 an unreadable tips store shows no tips rather than all of them');
    const row = await page.evaluate(() => document.getElementById('tips-box')?.hidden);
    chk(row === true, 'T7 and the Settings Tips box is hidden rather than showing a state it did not read');

    chk(errs.length === 0, 'T8 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall help-tips checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
