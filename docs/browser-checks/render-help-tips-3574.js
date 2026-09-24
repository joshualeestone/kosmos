// Browser-check-surface: tipcard helpq tips-toggle
'use strict';

/**
 * First-run help and first-visit tips (#3574, Josh 2026-09-24, for 0.6.93).
 *
 * One card does the welcome tour and every screen's first-visit tip; the board remembers what was
 * closed. Each "shows once" arm has its control: the same screen shows the tip before it is
 * closed, and does not after.
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
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const cardState = (page) => page.evaluate(() => {
  const c = document.getElementById('tipcard');
  const h = c && c.querySelector('h2');
  return { shown: !!c && !c.hidden, title: h ? h.textContent : null,
    dim: !document.getElementById('tipdim').hidden, pins: document.querySelectorAll('#tippins .tippin').length };
});
const waitCard = (page, ms) => page.waitForFunction(() => { const c = document.getElementById('tipcard'); return c && !c.hidden; }, null, { timeout: ms }).then(() => true, () => false);

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

    // T1: the welcome tour shows once on the board, dims the screen and numbers the places.
    chk(await waitCard(page, 4000), 'T1 the welcome tour shows on the board after first run');
    const tour = await cardState(page);
    chk(tour.title === 'Four places to know' && tour.dim && tour.pins >= 3,
      'T1 it is the tour: its title, the dim, and the numbered pins', JSON.stringify(tour));
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
    chk(!(await cardState(page)).shown && !(await cardState(page)).dim, 'T2 Got it closes the tour and the dim');
    chk((await api('GET')).seen.includes('tour'), 'T2 the board records the tour as seen');

    // T3: the next first-visit tip for this screen follows, and is a screen tip, not the tour.
    chk(await waitCard(page, 4000), 'T3 a first-visit tip follows on the board');
    const next = await cardState(page);
    chk(next.title !== 'Four places to know' && !next.dim, 'T3 it is a screen tip, with no dim', JSON.stringify(next));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'screen-tip-light.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const seenAfterEsc = (await api('GET')).seen;
    chk(!(await cardState(page)).shown && seenAfterEsc.length >= 2, 'T3 Escape closes it and counts as seen', JSON.stringify(seenAfterEsc));

    // T4: a reload does not bring back what was closed (control: T1 and T3 showed before closing).
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    const after = await cardState(page);
    chk(!(after.shown && after.title === 'Four places to know'),
      'T4 after a reload the tour does not return', JSON.stringify(after));
    if (after.shown) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

    // T5: the ? menu brings the tour back even though it is seen.
    await page.click('#helpq-btn');
    chk(await page.isVisible('#helpq-menu'), 'T5 the ? opens its menu');
    await page.click('#helpq-menu [data-help="tour"]');
    const again = await cardState(page);
    chk(again.shown && again.title === 'Four places to know', 'T5 Take the welcome tour again shows the tour', JSON.stringify(again));
    await page.keyboard.press('Escape');
    await page.click('#helpq-btn');
    await page.click('#helpq-menu [data-help="ring"]');
    const ring = await page.evaluate(() => ({ title: document.querySelector('#tipcard h2')?.textContent, bands: document.querySelectorAll('#tipcard .tip-bands .gf').length }));
    chk(ring.title === 'The ring is your agent\'s memory' && ring.bands === 3, 'T5 What does the ring mean shows the ring explainer with its three colours', JSON.stringify(ring));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ring-light.png') });

    // T6: Stop showing tips turns them off, and the Settings switch reads it and turns them back on.
    await page.click('#tipcard .tip-off');
    await page.waitForTimeout(300);
    chk((await api('GET')).off === true, 'T6 Stop showing tips turns tips off on the board');
    const sw = await page.evaluate(() => document.getElementById('tips-toggle')?.getAttribute('aria-checked'));
    chk(sw === 'false', 'T6 the Settings switch reads off', 'aria-checked=' + sw);
    await api('PUT', { seen: [] });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T6 with tips off no first-visit tip shows (control: T3 showed one on this screen)');
    await page.evaluate(() => document.getElementById('tips-toggle').click());
    await page.waitForTimeout(300);
    chk((await api('GET')).off === false, 'T6 the Settings switch turns tips back on');

    // T9: each screen shows its own tip, once. Tips are on and nothing is seen, so the first
    // screen visited that is not the board gets its tip before the tour can.
    const visit = async (label, go, title) => {
      await go();
      const shown = await waitCard(page, 4000);
      const st = await cardState(page);
      chk(shown && st.title === title && !st.dim, 'T9 ' + label + ' shows its tip: ' + title, JSON.stringify(st));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    };
    await visit('Projects', () => page.click('#tabs [data-tab="projects"]'), 'A project is shared work');
    await visit('Settings', async () => { await page.click('#userpop-btn'); await page.click('#userpop-settings'); }, 'Settings for this computer');
    await visit('an agent\'s page', async () => { await page.click('#tabs [data-tab="agents"]'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.click('[data-agent="beatrix"]'); }, 'Your agent\'s page');
    const seenNow = (await api('GET')).seen;
    chk(['projects', 'settings', 'agentpage'].every((id) => seenNow.includes(id)), 'T9 each closed screen tip is recorded', JSON.stringify(seenNow));
    await page.click('#tabs [data-tab="projects"]');
    await page.waitForTimeout(2800);
    const again2 = await cardState(page);
    chk(!(again2.shown && again2.title === 'A project is shared work'), 'T9 the Projects tip does not return (control: it showed above)', JSON.stringify(again2));

    // T7: a board that cannot say what was seen shows nothing. Seen is emptied first, so a guard
    // that let tips through would show the tour here (control: T1, the same empty state).
    fs.writeFileSync(tipsStore.FILE(), JSON.stringify({ seen: [], off: false }));
    fs.writeFileSync(tipsStore.FILE(), '{ not json');
    chk((await api('GET')).ok === false, 'T7 precondition: the board now answers that it cannot read the tips');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2800);
    chk(!(await cardState(page)).shown, 'T7 an unreadable tips store shows no tips rather than all of them');
    const row = await page.evaluate(() => document.getElementById('tips-row')?.hidden);
    chk(row === true, 'T7 and the Settings switch is hidden rather than showing a state it did not read');

    chk(errs.length === 0, 'T8 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall help-tips checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
