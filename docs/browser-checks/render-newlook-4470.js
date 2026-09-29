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
 *  - the project page with the look on: Tasks moved into the left box between Members and Files and
 *    the crumb row moved FIRST into the conversation header (so the keyboard meets them where the eye
 *    does), after a fresh open, a direct URL load and a live toggle; two columns when wide; plain member
 *    rows (a working one too) with a state word the remove minus never covers; compact task rows ("#n",
 *    the claim line kept, parts with hollow/filled dots, "Part of" on top) sharing the members' right
 *    edge; sentence-case headings; bubbles and composer greys (also in chosen Dark on a light machine);
 *    tabs marked by ink and weight; the consolidated layout keeping today's arrangement and back again,
 *  - with it off: every placement back where today has it, no state word, today's underline,
 *  - the Agents page's inks clearing 4.5:1 on the new grounds,
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
  return { inMid: !!row && !!row.closest('.pjmidhead'), first: !!row && row.parentElement.firstElementChild === row, aboveCols: !!row && row.parentElement.id === 'pj-one-view',
    rootShown: vis(root), nameInDom: !!name && name.textContent.trim().length > 0, nameShown: vis(name) };
})()`;
/* The current top tab's underline colour and the text colour of a current and a non-current tab. */
const TABS = `(() => {
  const on = document.querySelector('.apphead .tab.on');
  const off = document.querySelector('.apphead .tab:not(.on)');
  return { onUnderline: on ? getComputedStyle(on).borderBottomColor : 'absent', onColor: on ? getComputedStyle(on).color : '', offColor: off ? getComputedStyle(off).color : '',
    onWeight: on ? Number(getComputedStyle(on).fontWeight) : 0, offWeight: off ? Number(getComputedStyle(off).fontWeight) : 0 };
})()`;
const GREY_OF = { light: 'rgb(245, 245, 247)', dark: 'rgb(44, 44, 46)' };
/* The fill the room paints for your message and for an agent's, read from two sample bubbles put
   in the thread for the measurement and removed after (no agent can post in this sandbox). */
const BUBBLES = `(() => {
  const room = document.getElementById('pj-room');
  const mk = (you) => { const m = document.createElement('div'); m.className = 'msg' + (you ? ' you' : ''); m.innerHTML = '<div class="msg-b"><div class="msg-bd">x</div></div>'; room.appendChild(m); return m; };
  const a = mk(true), b = mk(false);
  const out = { you: getComputedStyle(a.querySelector('.msg-bd')).backgroundColor, agent: getComputedStyle(b.querySelector('.msg-bd')).backgroundColor };
  a.remove(); b.remove();
  return out;
})()`;
/* Each member row's ground: colour and image, and whether it is a working row. */
const ROW_GROUNDS = `[...document.querySelectorAll('#pj-one-agents .pj-member')].map((m) => ({ working: m.classList.contains('pjm-working'), bg: getComputedStyle(m).backgroundColor, img: getComputedStyle(m).backgroundImage }))`;
/* The left box's task rows: how many, how many still draw a card border, whether the number reads
   a hash sign and the number (the word hidden, the hash drawn) and whether an assigned row's claim line is visible. */
const TASK_ROWS = `(() => {
  const cards = [...document.querySelectorAll('#pj-one-view .pjsplit .tkcard')];
  const first = cards.find((c) => c.querySelector('.tkcard-who b'));
  const claim = first && first.querySelector('.tksay, .tkunk');
  const n = cards[0] && cards[0].querySelector('.tkcard-n');
  return { rows: cards.length,
    boxed: cards.filter((c) => parseFloat(getComputedStyle(c).borderTopWidth) > 0).length,
    hashShown: !!n && getComputedStyle(cards[0], '::before').content.startsWith('"#' + cards[0].dataset.task + '"') && parseFloat(getComputedStyle(cards[0], '::before').fontSize) > 10,
    /* clipped like .vh, never a zero font size: the "Task n" text must stay readable by a screen reader */
    wordHidden: !!n && getComputedStyle(n).position === 'absolute' && getComputedStyle(n).clipPath === 'inset(50%)' && parseFloat(getComputedStyle(n).fontSize) > 0 && n.textContent.startsWith('Task ' + cards[0].dataset.task),
    claimShown: !!claim && getComputedStyle(claim).display !== 'none' && claim.getBoundingClientRect().height > 0 };
})()`;
/* A left-box task row that says "Part of #N": is its line drawn above the row's title? */
const PART_OF = `(() => {
  const po = document.querySelector('#pj-one-view .pjsplit .tkcard .tkcard-part-of');
  if (!po) return { found: false };
  const t = po.closest('.tkcard').querySelector('.tkcard-t');
  return { found: true, above: po.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1, text: po.textContent.trim() };
})()`;
/* The contrast of the text tokens on the ground tokens as the page resolves them right now. Each
   token is resolved by painting it on a probe element, so a var() chain resolves as the page does. */
const TOKEN_CONTRAST = `(() => {
  const probe = document.createElement('span'); document.body.appendChild(probe);
  const rgb = (v, prop) => { probe.style[prop] = 'var(' + v + ')'; const m = getComputedStyle(probe)[prop].match(/[0-9.]+/g).map(Number); return m; };
  const lum = (c) => { const f = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const pairs = [];
  for (const ink of ['--k-ink', '--k-ink-2', '--label', '--label-2', '--nl-ink-3']) for (const ground of ['--k-bg', '--k-surface']) {
    pairs.push({ ink, ground, ratio: ratio(rgb(ink, 'color'), rgb(ground, 'backgroundColor')) });
  }
  probe.remove();
  return { pairs, wide: document.documentElement.scrollWidth > window.innerWidth };
})()`;
/* The left box's task split into parts: visible avatars left in its part lines, and whether the held part's
   dot is filled and the "Nobody yet" part's dot hollow. */
const PARTS = `(() => {
  const row = [...document.querySelectorAll('#pj-one-view .pjsplit .tkcard')].find((c) => c.querySelector('.tkcard-parts'));
  if (!row) return { found: false };
  const dot = (el) => { if (!el) return 'absent'; const b = getComputedStyle(el.querySelector('b'), '::before'); return b.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 'filled' : (b.boxShadow && b.boxShadow !== 'none' ? 'hollow' : 'none'); };
  return { found: true, avatars: [...row.querySelectorAll('.tkcard-part .lav')].filter((a) => a.getClientRects().length).length,
    held: dot(row.querySelector('.tkcard-part:not(.none)')), nobody: dot(row.querySelector('.tkcard-part.none')) };
})()`;
const COMPOSER_BG = `getComputedStyle(document.querySelector('#pj-one-view .pjmid .composer .composerbox')).backgroundColor`;

(async () => {
  let server, browser;
  try {
    fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
      fleet.agent('bo', { state: 'working', displayName: 'Bo', role: 'a builder' })]);
    const proj = projects.create({ name: 'Billing' });
    projects.addAgent(proj.id, 'ada', null);
    projects.addAgent(proj.id, 'bo', null);
    const tasks = require('../../engine/tasks');
    const t1 = tasks.create(proj.id, { sentence: 'Plan the launch week', who: 'ada' });
    tasks.create(proj.id, { sentence: 'Book the venue', who: 'ada', parent: t1.number });
    tasks.create(proj.id, { sentence: 'Order the paper' });
    /* Three more, then a late subtask of #1: the column shows the newest five, so #1 drops out and
       its subtask has to say "Part of #1" on its own. */
    for (const w of ['Draft the menu', 'Call the florist', 'Print the badges']) tasks.create(proj.id, { sentence: w });
    tasks.create(proj.id, { sentence: 'Send the reminders', who: 'bo', parent: t1.number });
    /* A task split into two parts, one held by Ada and one by nobody. */
    const split = tasks.create(proj.id, { sentence: 'Set up the room', who: 'ada' });
    tasks.addPart(proj.id, split.number, { sentence: 'Chairs' });
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
      if (width >= 1088) {
        /* Hovering a member row to read its state keeps the word: only the remove minus hides it. */
        await page.hover('#pj-one-agents .pj-member .pj-member-b b');
        const hoverWord = await page.evaluate(`getComputedStyle(document.querySelector('#pj-one-agents .pj-member .pj-member-st')).visibility`);
        const lane = await page.evaluate(`(() => {
          const row = document.querySelector('#pj-one-agents .pj-member');
          const w = row.querySelector('.pj-member-st').getBoundingClientRect();
          const m = row.querySelector('.pj-minus'); const r = m ? m.getBoundingClientRect() : null;
          /* each row's CONTENT edge (its box less its right padding): the lane the minus sits in is outside it */
          const edge = (el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight);
          const card = document.querySelector('#pj-one-view .pjsplit .tkcard');
          return { minusShown: !!m && getComputedStyle(m).opacity === '1', overlap: !!r && r.left < w.right && r.right > w.left,
            wordRight: Math.round(w.right), memberEdge: Math.round(edge(row)), taskRight: card ? Math.round(edge(card)) : null };
        })()`);
        chk(hoverWord === 'visible' && lane.minusShown && !lane.overlap, `${tag} On: hovering a member row shows the remove minus beside its state word, never on it`, JSON.stringify({ hoverWord, ...lane }));
        chk(lane.taskRight !== null && Math.abs(lane.memberEdge - lane.taskRight) <= 1 && Math.abs(lane.wordRight - lane.memberEdge) <= 1,
          `${tag} On: member states end at the row's edge, and member and task rows share one right edge`, JSON.stringify(lane));
      }
      await page.mouse.move(0, 0);
      const rows = await page.evaluate(ROW_GROUNDS);
      chk(rows.length >= 2 && rows.some((r) => r.working) && rows.every((r) => r.bg === 'rgba(0, 0, 0, 0)' && r.img === 'none'),
        `${tag} On: every member row is plain, a working one too (no wash, no pulse)`, JSON.stringify(rows));
      if (width >= 1088) {   // a phone width shows the tabs as a menu, with its own current-row style
        const tabs = await page.evaluate(TABS);
        chk(tabs.onUnderline === 'rgba(0, 0, 0, 0)' && tabs.onColor !== tabs.offColor && tabs.onWeight > tabs.offWeight, `${tag} On: the current tab is marked by ink and weight, not an underline`, JSON.stringify(tabs));
      }
      const bub = await page.evaluate(BUBBLES);
      const PAGE_OF = { light: 'rgb(255, 255, 255)', dark: 'rgb(0, 0, 0)' };
      chk(bub.you === GREY_OF[theme] && bub.agent === PAGE_OF[theme], `${tag} On: your message is grey, an agent's is the page's own ground (no bubble)`, JSON.stringify(bub));
      const tk = await page.evaluate(TASK_ROWS);
      chk(tk.rows >= 3 && tk.boxed === 0 && tk.hashShown && tk.wordHidden && tk.claimShown,
        `${tag} On: tasks are compact rows (the number with a hash sign, no box), and the agent's claim line still shows`, JSON.stringify(tk));
      const labs = await page.evaluate(`[...document.querySelectorAll('#pj-one-view .pjsplit .dlab')].filter((h) => h.getClientRects().length).map((h) => getComputedStyle(h).textTransform)`);
      chk(labs.length >= 3 && labs.every((x) => x === 'none'), `${tag} On: the left box's headings are sentence case`, JSON.stringify(labs));
      const parts = await page.evaluate(PARTS);
      chk(parts.found && parts.avatars === 0 && parts.held === 'filled' && parts.nobody === 'hollow',
        `${tag} On: a task in parts shows each part with a dot (hollow for the part nobody holds), no avatars`, JSON.stringify(parts));
      const partOf = await page.evaluate(PART_OF);
      chk(partOf.found && partOf.above, `${tag} On: a subtask's "Part of" line sits above its title, as it reads`, JSON.stringify(partOf));
      const hdOn = await page.evaluate(HEAD_PLACE);
      chk(hdOn.inMid && hdOn.first && hdOn.rootShown && hdOn.nameInDom && !hdOn.nameShown, `${tag} On: back and "Projects / name" head the conversation; the h2 stays for screen readers, visually hidden`, JSON.stringify(hdOn));
      chk(!(await page.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)), `${tag} On: the project page has no sideways scroll`);
      /* Turning it off LIVE, on the open project page (no reload): lookToggleClick must move both back. */
      await page.evaluate(() => lookToggleClick());
      const liveOff = { look: await page.evaluate(`document.documentElement.getAttribute('data-look')`), ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
      chk(liveOff.look === null && liveOff.tasksLast && liveOff.aboveCols, `${tag} Off live on the project page: Tasks and the crumb row go back at once`, JSON.stringify(liveOff));
      await page.evaluate(() => lookToggleClick());
      if (width >= 1088) {
        /* The consolidated layout with the look on keeps today's ARRANGEMENT: placeLook puts Tasks back
           at the end of .pj3 and the crumb row out of the conversation header, which the consolidated
           grid places by position. Then back to tabs, where both move in again. */
        await page.evaluate((id) => { applyLayout('consolidated', true); showTab('projects'); openProject(id); }, proj.id);
        await page.waitForTimeout(800);
        const cons = { cons: await page.evaluate(`document.body.classList.contains('consolidated')`), ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
        chk(cons.cons && cons.tasksLast && !cons.inMid && !(await page.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)),
          `${tag} On + consolidated layout: Tasks at the end of the columns and the crumb out of the header, as today`, JSON.stringify(cons));
        await page.evaluate((id) => { applyLayout('tabs', true); showTab('projects'); openProject(id); }, proj.id);
        await page.waitForTimeout(800);
        const tabsAgain = { cons: await page.evaluate(`document.body.classList.contains('consolidated')`), ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
        chk(!tabsAgain.cons && tabsAgain.order === 'members,tasks,files' && tabsAgain.inMid && tabsAgain.first, `${tag} On, back to tabs: Tasks and the header move in again`, JSON.stringify(tabsAgain));
      }
      const GREY = { light: 'rgb(245, 245, 247)', dark: 'rgb(44, 44, 46)' };
      const cb = await page.evaluate(COMPOSER_BG);
      chk(cb === GREY[theme], `${tag} On: the composer is the drawing's grey`, cb);
      if (theme === 'light' && width === 1280) {
        /* Chosen Dark on a light machine: the generated forced-dark composer rules sit later in the
           sheet than the new look's, so this is the arm where a tie would go the wrong way. */
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const cbForced = await page.evaluate(COMPOSER_BG);
        chk(cbForced === GREY.dark, `${tag} On + chosen Dark: the composer is the dark grey`, cbForced);
        const bubForced = await page.evaluate(BUBBLES);
        chk(bubForced.you === GREY_OF.dark && bubForced.agent === 'rgb(0, 0, 0)', `${tag} On + chosen Dark: your message is dark grey, an agent's is the black ground`, JSON.stringify(bubForced));
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `newlook-project-${theme}-${width}.png`) });

      /* A page the new look has NOT been designed for yet still takes its colour tokens. The Agents
         page must stay readable: the new ink on the new surfaces clears 4.5:1, and nothing overflows. */
      await page.evaluate(() => showTab('agents'));
      await page.waitForTimeout(600);
      const ag = await page.evaluate(TOKEN_CONTRAST);
      chk(ag.pairs.every((x) => x.ratio >= 4.5) && !ag.wide, `${tag} On, Agents page: the new ink clears 4.5:1 on the new grounds, no sideways scroll`, JSON.stringify(ag));

      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const kept = await page.evaluate(PAGE_STATE);
      chk(kept.look === 'new' && kept.kbg === NEW[theme], `${tag} a reload keeps the new look`, JSON.stringify(kept));
      /* A load straight onto the project with the look on: the layout paint (applyLayout ->
         placeProjectHead) lands AFTER the boot showTab, so this is where the header could be put
         back above the columns. Settle past it before reading. */
      await page.goto(URL + '/?tab=projects&project=' + encodeURIComponent(proj.id), { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await page.waitForSelector('#pj-one-view:not([hidden])', { timeout: 8000 });
      await page.waitForTimeout(1500);
      const direct = { ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
      chk(direct.order === 'members,tasks,files' && direct.inMid && direct.first, `${tag} On, loaded straight onto the project: Tasks in the left box and the header in the conversation`, JSON.stringify(direct));

      await openAdvanced(page);
      chk((await page.evaluate(PAGE_STATE)).sw === 'true', `${tag} after a reload the switch still reads On`);
      await page.click('#look-toggle');
      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const back = await page.evaluate(PAGE_STATE);
      await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, proj.id);
      await page.waitForSelector('#pj-one-agents .pj-member', { timeout: 8000 });
      const pjOff = await page.evaluate(TASKS_PLACE);   // read with the project OPEN, where a stuck move would show
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
  process.exit(fail.length || ran < 90 ? 1 : 0);   // a full run makes about 100; a skipped pass must fail
})();
