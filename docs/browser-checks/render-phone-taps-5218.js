// Browser-check-surface: agent-sort d-term-say d-term-send d-open-terminal d-remove-start d-trust-restart tsk-back pj-sort
'use strict';
/**
 * Monday's phone sweep (kosmos#5218, #5219, #5220, #5221): on a touch screen the newcomer's first screens take a
 * finger across 44px, and no hit area takes a neighbour's tap.
 *
 * What this pins, and why each line can fail:
 *  - the context really is a touch screen ((hover: none) or (pointer: coarse) matches), else the rules never apply,
 *  - the agents board: each agent's name (.namego) reaches 44 (each edge of a 44x44 square centred on it hits it),
 *    and the Sort agents menu is 44 tall,
 *  - a project's room: nothing covers anything (its header keeps #4663's 36px areas; render-room-msgbox-2806 owns them),
 *  - an agent's AI settings: the terminal box is 16px text (under 16 iPhone Safari zooms the page on a tap) and 44
 *    tall, and its visible buttons are 44 tall,
 *  - NO COVER: across every control's own box on those screens (every 3px, edges included) a tap lands on that
 *    control, not on a neighbour's hit area (one reaching past its box paints above its neighbours: the cost of reach),
 *  - CONTROL: a desktop with a mouse keeps a name's 16px line and no hit area, and the terminal box's own size,
 *  - light and dark, no sideways scroll, no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-phone-taps-5218.js            # headed
 *   HEADED=0 node docs/browser-checks/render-phone-taps-5218.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phone5218-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phone5218-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phone5218-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phone5218-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-phone5218-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// In the page: does every edge of a 44x44 square centred on el hit it (the mobile-shots reach probe)?
const REACH = (sel) => {
  return [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility()).map((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = 21.5;
    const ok = [[cx, cy - h], [cx, cy + h], [cx - h, cy], [cx + h, cy]].every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
    return { sel, w: Math.round(r.width), h: Math.round(r.height), ok };
  });
};
// In the page: across every control's own box (every 3px, its edges included), a tap must land on that control and
// not on a neighbour's hit area reaching over it (the same scan as mobile-shots' covers audit). A point inside the
// other control's drawn box, with 1px of slack for a snapped shared edge, is stacking, not a hit area.
const COVERS = () => {
  const SEL = 'button, a[href], select, summary, label, [role="button"], [role="tab"], input:not([type="hidden"]), textarea';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.disabled || !el.checkVisibility()) continue;
    const r0 = el.getBoundingClientRect();
    if (r0.width < 4 || r0.height < 4) continue;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const step = Math.max(3, Math.sqrt((r.width * r.height) / 4000));
    const pts = [];
    for (let x = r.left + 0.5; x < r.right - 0.5; x += step) for (let y = r.top + 0.5; y < r.bottom - 0.5; y += step) pts.push([x, y]);
    for (const x of [r.left + 0.5, r.right - 0.5]) for (let y = r.top + 0.5; y < r.bottom; y += step) pts.push([x, y]);
    for (const y of [r.top + 0.5, r.bottom - 0.5]) for (let x = r.left + 0.5; x < r.right; x += step) pts.push([x, y]);
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      const other = hit && hit.closest ? hit.closest(SEL) : null;
      if (!other || other === el || other.contains(el)) continue;   // an ancestor; a descendant's hit area still counts
      const o = other.getBoundingClientRect();
      if (x >= o.left - 1 && x < o.right + 1 && y >= o.top - 1 && y < o.bottom + 1) continue;
      out.push((el.id || el.className) + ' <- ' + (other.id || other.className)); break;
    }
  }
  return out;
};

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
    fleet.agent('basil', { state: 'idle', displayName: 'Basil', role: 'a researcher' })]);
  const launch = projects.create({ name: 'Spring launch' });
  projects.addAgent(launch.id, 'ada', null);

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const open = async (page, qs, wait) => {
    await page.goto(URL + '/', { waitUntil: 'load' }); await page.waitForTimeout(600); await clearFirstRun(page);
    if (qs) await page.goto(URL + '/' + qs, { waitUntil: 'load' });
    await page.waitForSelector(wait, { state: 'visible', timeout: 8000 }); await page.waitForTimeout(400);
  };

  try {
    for (const theme of ['light', 'dark']) {
      const tag = `[${theme} phone 390]`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: theme, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));

      // The agents board.
      await open(page, '', '.namego');
      chk(await page.evaluate(() => matchMedia('(hover: none), (pointer: coarse)').matches), `${tag} the context is a touch screen`);
      const names = await page.evaluate(REACH, '.namego');
      chk(names.length >= 2 && names.every((x) => x.ok), `${tag} board: every agent's name reaches 44`, JSON.stringify(names));
      const sortH = await page.evaluate(() => { const e = document.querySelector('#agent-sort'); return e && e.checkVisibility() ? Math.round(e.getBoundingClientRect().height) : null; });
      chk(sortH === null || sortH >= 44, `${tag} board: Sort agents is 44 tall (or not shown)`, String(sortH));
      const boardCovers = await page.evaluate(COVERS);
      chk(boardCovers.length === 0, `${tag} board: no control is taken by a neighbour's hit area`, JSON.stringify(boardCovers));
      chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} board: no sideways scroll`);

      // A project's room.
      await open(page, '?tab=projects', '#pj-list .pj-row');
      await page.click(`#pj-list .pj-row[data-project="${launch.id}"]`);
      await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 }); await page.waitForTimeout(400);
      const roomCovers = await page.evaluate(COVERS);
      chk(roomCovers.length === 0, `${tag} room: no control is taken by a neighbour's hit area`, JSON.stringify(roomCovers));
      chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} room: no sideways scroll`);

      // An agent's AI settings.
      await open(page, '?tab=detail&agent=ada', '#d-nav');
      await page.locator('#d-nav button[data-go="model"]').first().click({ timeout: 5000 });
      await page.waitForSelector('#d-sec-term', { state: 'visible', timeout: 5000 }); await page.waitForTimeout(300);
      const term = await page.evaluate(() => { const e = document.querySelector('#d-term-say'); const c = getComputedStyle(e); return { font: c.fontSize, h: Math.round(e.getBoundingClientRect().height) }; });
      chk(term.font === '16px' && term.h >= 44, `${tag} AI settings: the terminal box is 16px text and 44 tall (no iPhone zoom)`, JSON.stringify(term));
      const btns = await page.evaluate(() => ['#d-open-terminal', '#d-remove-start', '#d-term-send', '#d-trust-restart'].map((s) => { const e = document.querySelector(s); return e && e.checkVisibility() ? [s, Math.round(e.getBoundingClientRect().height)] : null; }).filter(Boolean));
      chk(btns.length >= 2 && btns.every(([, h]) => h >= 44), `${tag} AI settings: its visible buttons are 44 tall`, JSON.stringify(btns));
      const aiCovers = await page.evaluate(COVERS);
      chk(aiCovers.length === 0, `${tag} AI settings: no control is taken by a neighbour's hit area`, JSON.stringify(aiCovers));
      chk(errs.length === 0, `${tag} no page errors`, errs.slice(0, 2).join(' | '));
      await ctx.close();
    }

    // CONTROL: a desktop with a mouse keeps the small sizes; the rules are touch only.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await open(page, '', '.namego');
    chk(await page.evaluate(() => matchMedia('(hover: hover)').matches), '[desktop 1280] the context has a mouse');
    const d = await page.evaluate(() => { const n = document.querySelector('.namego'); return { h: Math.round(n.getBoundingClientRect().height), after: getComputedStyle(n, '::after').content }; });
    chk(d.h < 44 && (d.after === 'none' || d.after === 'normal'), '[desktop 1280] CONTROL: a name keeps its line and has no hit area with a mouse', JSON.stringify(d));
    await open(page, '?tab=detail&agent=ada', '#d-nav');
    await page.locator('#d-nav button[data-go="model"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-term', { state: 'visible', timeout: 5000 });
    const dt = await page.evaluate(() => getComputedStyle(document.querySelector('#d-term-say')).fontSize);
    chk(dt !== '16px', '[desktop 1280] CONTROL: the terminal box keeps its own size with a mouse', dt);
    await ctx.close();
  } catch (e) {
    console.error(e);
    fail.push('crashed: ' + (e && e.message));
  } finally {
    await browser.close();
    server.close();
    for (const dir of SANDBOXES) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
