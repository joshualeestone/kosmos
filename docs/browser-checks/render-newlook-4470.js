// Browser-check-surface: look-toggle look-row
'use strict';
/**
 * The new look's hidden switch (#4470, Josh 2026-09-28), on a real board in a real browser.
 *
 * What this pins, and why each line can fail:
 *  - with nothing stored, the page has no data-look attribute and today's page colour
 *    (so the switch being there changes nothing until somebody turns it on),
 *  - Settings > Advanced has "Try the new look", a switch reading Off,
 *  - turning it on repaints at once (white page in light, black in dark) and the switch reads On,
 *  - a reload keeps it (the head script applies it before paint), and turning it off and
 *    reloading gives today's page back,
 *  - the project page: with the look on, Tasks moves into the left box between Members and
 *    Files (so the keyboard meets it second, where the eye does) and the page is two columns;
 *    with it off, Tasks is back at the end of the page's markup, as today,
 *  - light, dark and 390 wide, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-newlook-4470.js [shots-dir]            # headed
 *   HEADED=0 node docs/browser-checks/render-newlook-4470.js [shots-dir]   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-newlook-bc-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-newlook-bc-' + t)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');

const SHOTS = process.argv[2] || null;
const fail = [];
let ran = 0;
function chk(ok, label, extra) {
  ran += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* Today's page colour, per theme, read from the stylesheet's own --k-bg rather than typed here,
   so a later change to today's colours does not make this check lie. */
const PAGE_STATE = `(() => ({
  look: document.documentElement.getAttribute('data-look'),
  kbg: getComputedStyle(document.documentElement).getPropertyValue('--k-bg').trim().toLowerCase(),
  sw: (document.getElementById('look-toggle') || {}).getAttribute ? document.getElementById('look-toggle').getAttribute('aria-checked') : 'absent',
  wide: document.documentElement.scrollWidth > window.innerWidth,
}))()`;

/* Where the Tasks column is: which cards the left box holds in order, whether Tasks is the last
   child of .pj3 (today's markup), and how many grid columns .pj3 lays out. */
const TASKS_PLACE = `(() => {
  const split = document.querySelector('#pj-one-view .pj3 > .pjsplit');
  const pj3 = split.parentElement;
  const order = [...split.children].map((c) => c.classList.contains('pjcard-members') ? 'members' : c.classList.contains('pjcard-files') ? 'files' : c.matches('aside.pjcol') ? 'tasks' : null).filter(Boolean).join(',');
  const last = pj3.lastElementChild;
  return { order, tasksLast: !!last && last.matches('aside.pjcol:not(.pjsplit)'), cols: getComputedStyle(pj3).gridTemplateColumns.split(' ').length };
})()`;

/* The first member row's state word: whether it is rendered visibly, and its text. */
const MEMBER_WORD = `(() => {
  const el = document.querySelector('#pj-one-agents .pj-member .pj-member-st');
  if (!el) return { shown: false, text: '', present: false };
  const r = el.getBoundingClientRect();
  return { shown: getComputedStyle(el).display !== 'none' && r.width > 0, text: el.textContent.trim(), present: true };
})()`;

/* Where the back-and-crumb row is, and whether the "Projects" root and the h2 name show. */
const HEAD_PLACE = `(() => {
  const row = document.querySelector('#pj-one-view .pj-crumbrow');
  const root = document.getElementById('pj-crumb-root');
  const name = document.getElementById('pj-one-name');
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 2;
  return { inMid: !!row && !!row.closest('.pjmidhead'), aboveCols: !!row && row.parentElement.id === 'pj-one-view',
    rootShown: vis(root), nameInDom: !!name && name.textContent.trim().length > 0, nameShown: vis(name) };
})()`;
/* The current top tab's underline colour and the text colour of a current and a non-current tab. */
const TABS = `(() => {
  const on = document.querySelector('.apphead .tab.on');
  const off = document.querySelector('.apphead .tab:not(.on)');
  return { onUnderline: on ? getComputedStyle(on).borderBottomColor : 'absent', onColor: on ? getComputedStyle(on).color : '', offColor: off ? getComputedStyle(off).color : '' };
})()`;
const COMPOSER_BG = `getComputedStyle(document.querySelector('#pj-one-view .pjmid .composer .composerbox')).backgroundColor`;

(async () => {
  let server, browser;
  try {
    fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
    const proj = projects.create({ name: 'Billing' });
    projects.addAgent(proj.id, 'ada', null);
    server = await srv.start(0);
    const URL = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: process.env.HEADED === '0' });
    const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
    const openAdvanced = async (page) => {
      await page.evaluate(() => { showTab('settings'); });
      await page.click('[data-go="advanced"]');
      await page.waitForSelector('#look-toggle:not([hidden])', { timeout: 8000 });
    };
    const NEW = { light: '#ffffff', dark: '#000000' };
    for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
      const tag = `[${theme} ${width}]`;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      const before = await page.evaluate(PAGE_STATE);
      chk(before.look === null, `${tag} nothing stored: no data-look attribute`, JSON.stringify(before));
      chk(before.kbg && before.kbg !== NEW[theme], `${tag} nothing stored: today's page colour, not the new look's`, before.kbg);

      await openAdvanced(page);
      const label = await page.textContent('#look-row b');
      chk(label === 'Try the new look', `${tag} Advanced has "Try the new look"`, label);
      chk((await page.evaluate(PAGE_STATE)).sw === 'false', `${tag} the switch reads Off`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `newlook-off-${theme}-${width}.png`) }); }

      await page.click('#look-toggle');
      const on = await page.evaluate(PAGE_STATE);
      chk(on.look === 'new' && on.sw === 'true', `${tag} On sets the new look and the switch reads On`, JSON.stringify(on));
      chk(on.kbg === NEW[theme], `${tag} On repaints the page ${NEW[theme]}`, on.kbg);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `newlook-on-${theme}-${width}.png`) });
      await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, proj.id);
      await page.waitForSelector('#pj-one-view:not([hidden])', { timeout: 8000 });
      const pjOn = await page.evaluate(TASKS_PLACE);
      chk(pjOn.order === 'members,tasks,files', `${tag} On: Tasks sits in the left box between Members and Files`, JSON.stringify(pjOn));
      chk(width < 1088 ? pjOn.cols === 1 : pjOn.cols === 2, `${tag} On: the project page is ${width < 1088 ? 'one column (narrow)' : 'two columns'}`, JSON.stringify(pjOn));
      await page.waitForSelector('#pj-one-agents .pj-member', { timeout: 8000 });
      const stOn = await page.evaluate(MEMBER_WORD);
      chk(stOn.shown && stOn.text.length > 0, `${tag} On: a member row shows its state word`, JSON.stringify(stOn));
      if (width >= 1088) {   // a phone width shows the tabs as a menu, with its own current-row style
        const tabs = await page.evaluate(TABS);
        chk(tabs.onUnderline === 'rgba(0, 0, 0, 0)' && tabs.onColor !== tabs.offColor, `${tag} On: the current tab is marked by ink, not an underline`, JSON.stringify(tabs));
      }
      const hdOn = await page.evaluate(HEAD_PLACE);
      chk(hdOn.inMid && hdOn.rootShown && hdOn.nameInDom, `${tag} On: back and "Projects / name" head the conversation; the h2 stays for screen readers`, JSON.stringify(hdOn));
      const GREY = { light: 'rgb(245, 245, 247)', dark: 'rgb(44, 44, 46)' };
      const cb = await page.evaluate(COMPOSER_BG);
      chk(cb === GREY[theme], `${tag} On: the composer is the drawing's grey`, cb);
      if (theme === 'light' && width === 1280) {
        /* Chosen Dark on a light machine: the generated forced-dark composer rules sit later in the
           sheet than the new look's, so this is the arm where a tie would go the wrong way. */
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const cbForced = await page.evaluate(COMPOSER_BG);
        chk(cbForced === GREY.dark, `${tag} On + chosen Dark: the composer is the dark grey`, cbForced);
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `newlook-project-${theme}-${width}.png`) });

      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const kept = await page.evaluate(PAGE_STATE);
      chk(kept.look === 'new' && kept.kbg === NEW[theme], `${tag} a reload keeps the new look`, JSON.stringify(kept));

      await openAdvanced(page);
      chk((await page.evaluate(PAGE_STATE)).sw === 'true', `${tag} after a reload the switch still reads On`);
      await page.click('#look-toggle');
      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const back = await page.evaluate(PAGE_STATE);
      const pjOff = await page.evaluate(TASKS_PLACE);
      await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, proj.id);
      await page.waitForSelector('#pj-one-agents .pj-member', { timeout: 8000 });
      const stOff = await page.evaluate(MEMBER_WORD);
      const hdOff = await page.evaluate(HEAD_PLACE);
      chk(hdOff.aboveCols && !hdOff.rootShown && hdOff.nameShown, `${tag} Off: the crumb row is back above the columns, no "Projects" root, the name shows`, JSON.stringify(hdOff));
      chk(!stOff.shown, `${tag} Off: the member row prints no state word, as today (#3212)`, JSON.stringify(stOff));
      chk(pjOff.order === 'members,files' && pjOff.tasksLast, `${tag} Off: Tasks is back at the end of the project page, as today`, JSON.stringify(pjOff));
      chk(back.look === null && back.kbg === before.kbg, `${tag} Off and a reload give today's page back`, JSON.stringify(back));
      if (width >= 1088) {
        const tabsOff = await page.evaluate(TABS);
        chk(tabsOff.onUnderline !== 'rgba(0, 0, 0, 0)' && tabsOff.onUnderline !== 'absent', `${tag} Off: today's gold underline marks the current tab`, JSON.stringify(tabsOff));
      }
      chk(!back.wide, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await ctx.close();
    }
  } catch (e) {
    chk(false, 'the check ran to the end', e && e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
    fleet.restore && fleet.restore();
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n${ran - fail.length}/${ran} passed`);
  process.exit(fail.length || ran < 20 ? 1 : 0);
})();
