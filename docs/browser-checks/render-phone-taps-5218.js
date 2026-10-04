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
 *  - every rule this change adds is read from computed style on touch (min-height 44, the 44px ::after areas, the 16px
 *    box), on real elements, and on stand-ins for those that appear only with data (a notice's close, Try again, a
 *    room's document row): the reach and cover lines see only what is on screen,
 *  - CONTROL: a desktop with a mouse keeps a name's 16px line and no hit area, the terminal box's own size, and none
 *    of the rules apply,
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
// The covers scan is mobile-shots' own (fitOf, lifted from the file), so the two can never drift apart (round 4).
const fitOf = (() => {
  const src = fs.readFileSync(path.join(__dirname, 'mobile-shots.js'), 'utf8');
  const a = src.indexOf('const MIN_TAP_PX = 44;'), b = src.indexOf('async function run()');
  if (a < 0 || b < a) throw new Error('cannot find fitOf in mobile-shots.js');
  return new Function(src.slice(a, b) + '; return fitOf;')();
})();
const covers = async (page) => (await fitOf(page)).covers;
// In the page: a hit area must reach 44 around its control's centre AND stop short of 40px out, so an area knocked
// loose (its host not positioned: the ::after then spans the page) or shifted reads as a failure (round 4).
const AREA = (el) => {
  if (!el) return 'missing';
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hits = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
  const reach = [[0, -21.5], [0, 21.5], [-21.5, 0], [21.5, 0]].every(([dx, dy]) => hits(cx + dx, cy + dy));
  const far = Math.max(40, r.width / 2 + 18), farV = Math.max(40, r.height / 2 + 18);
  const bounded = [[0, -farV], [0, farV], [-far, 0], [far, 0]].every(([dx, dy]) => !hits(cx + dx, cy + dy));
  return { reach, bounded };
};


// In the page: every rule this change adds, read from computed style, on real elements where the page has them and on
// stand-ins (removed after) where they only appear with data (a notice's close, Try again, a room's document row).
const RULES = () => {
  const made = [];
  const standIn = (parentSel, html) => { const host = document.querySelector(parentSel) || document.body; const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild; host.appendChild(el); made.push(el); return el; };
  const toast = standIn('body', '<div class="utoast"><button class="ux" type="button">x</button></div>');
  const notice = standIn('body', '<div class="pnotice"><button class="qopt" type="button">Try again</button></div>');
  const doc = standIn('#pj-one-view', '<button class="pj-doc" type="button">doc</button>');
  const mh = (sel, el) => { const e = el || document.querySelector(sel); return e ? getComputedStyle(e).minHeight : 'missing'; };
  // An area is read as numbers, and only on a laid-out element: an unrendered one returns the rule's text unresolved
  // ("max(100%, 44px)"), which would pass any string test (round 3). #tsk-back is shown for the read.
  const after = (sel, el) => { const e = el || document.querySelector(sel); if (!e) return 'missing'; const a = getComputedStyle(e, '::after'); if (a.content === 'none') return 'none'; const w = parseFloat(a.width), h = parseFloat(a.height); return Number.isFinite(w) && Number.isFinite(h) && /px$/.test(a.width) && /px$/.test(a.height) ? [w, h] : 'unresolved ' + a.width + 'x' + a.height; };
  const back = document.querySelector('#tsk-back'); const wasHidden = back && back.hidden; if (back) back.hidden = false;
  const out = {
    'Sort agents': mh('#agent-sort'), 'Sort projects': mh('#pj-sort'), 'menu tab': mh('.apphead .tab'),
    'Open Terminal': mh('#d-open-terminal'), 'Remove this agent': mh('#d-remove-start'), 'Send': mh('#d-term-send'), 'Trust & Restart': mh('#d-trust-restart'),
    'terminal box font': getComputedStyle(document.querySelector('#d-term-say')).fontSize, 'terminal box': mh('#d-term-say'),
    'Upload an org chart': mh('#team-orgchart-open'), 'Join Kosmos+': mh('#plus-site-link'),
    'Try again': mh(null, notice.firstChild), 'document row': mh(null, doc),
    'tasks back area': after('#tsk-back'), 'notice close area': after(null, toast.firstChild), 'name area': after('.namego'),
  };
  for (const m of made) m.remove();
  if (back) back.hidden = wasHidden;
  return out;
};

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
    fleet.agent('basil', { state: 'idle', displayName: 'Basil', role: 'a researcher' })]);
  const launch = projects.create({ name: 'Spring launch' });
  projects.addAgent(launch.id, 'ada', null);
  require('../../engine/tasks').create(launch.id, { sentence: 'Write the blurb', who: 'ada' });   // so the project has a Tasks view
  require('../../engine/store').writeSettings({ tasksTabShown: true });

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
      const boardCovers = await covers(page);
      chk(boardCovers.length === 0, `${tag} board: no control is taken by a neighbour's hit area`, JSON.stringify(boardCovers));
      chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} board: no sideways scroll`);
      // The hit areas themselves: each reaches 44 around its control and stops short of 40px out (bounded).
      const nameAreas = await page.evaluate(`[...document.querySelectorAll('.namego')].filter((e) => e.checkVisibility()).map((e) => (${AREA})(e))`);
      chk(nameAreas.length >= 2 && nameAreas.every((a) => a.reach && a.bounded), `${tag} board: each name's hit area reaches 44 and is bounded`, JSON.stringify(nameAreas));
      const closeArea = await page.evaluate(`(() => { const d = document.createElement('div'); d.className = 'utoast'; d.innerHTML = '<button class="ux" type="button">x</button>'; document.body.appendChild(d); const r = (${AREA})(d.firstChild); d.remove(); return r; })()`);
      chk(closeArea.reach && closeArea.bounded, `${tag} a notice's close: its hit area reaches 44 and is bounded (stand-in)`, JSON.stringify(closeArea));
      // Every rule this change adds, read on the board, where a name is laid out (the reach and cover lines see only what is on screen).
      const rules = await page.evaluate(RULES);
      const bad = Object.entries(rules).filter(([k, v]) => (k === 'terminal box font' ? v !== '16px' : /area$/.test(k) ? !(Array.isArray(v) && v[0] >= 44 && v[1] >= 44) : v !== '44px'));
      chk(bad.length === 0, `${tag} every rule this change adds applies on touch (44px, the 44px areas, 16px)`, JSON.stringify(bad.length ? bad : rules));

      // The Tasks view of a project: the back chevron's area.
      await open(page, '?tab=tasks', '#panel-tasks');
      await page.evaluate((id) => openProjectTasks(id), launch.id);
      await page.waitForSelector('#tsk-back:not([hidden])', { state: 'visible', timeout: 8000 }); await page.waitForTimeout(300);
      const backArea = await page.evaluate(`(${AREA})(document.querySelector('#tsk-back'))`);
      chk(backArea.reach && backArea.bounded, `${tag} tasks: the back chevron's hit area reaches 44 and is bounded`, JSON.stringify(backArea));

      // A project's room.
      await open(page, '?tab=projects', '#pj-list .pj-row');
      await page.click(`#pj-list .pj-row[data-project="${launch.id}"]`);
      await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 }); await page.waitForTimeout(400);
      const roomCovers = await covers(page);
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
      const aiCovers = await covers(page);
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
    const drules = await page.evaluate(RULES);
    const leaked = Object.entries(drules).filter(([k, v]) => (k === 'terminal box font' ? v === '16px' : /area$/.test(k) ? v !== 'none' : v === '44px'));
    chk(leaked.length === 0, '[desktop 1280] CONTROL: none of this change\'s rules apply with a mouse', JSON.stringify(leaked.length ? leaked : drules));
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
