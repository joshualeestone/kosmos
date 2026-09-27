// Browser-check-surface: panel-tasks tsk-tiles tsk-groups tsk-search tsk-bulk rail-projects-tasks tsk-view tsk-band tsk-below tsk-list tsk-title tsk-searchbox
'use strict';
/**
 * The Tasks view on a screen (#3559): the third top-level tab, every task on every project,
 * grouped by where the work is.
 *
 * What this pins, and why each line can fail:
 *  - the Tasks tab and the consolidated rail's Tasks button are hidden below 25 tasks ever and
 *    shown once the saved flag is set (Josh's ruling); then the tab opens #panel-tasks, and in
 *    the consolidated view (tab bar hidden) the rail button opens it,
 *  - #3949 (Josh, 2026-09-26): six single-label tiles in his order (Needs Your Decision, red; In
 *    progress; Assigned but not started; Unassigned; Built but waiting, #3951; Completed), with the
 *    right counts and no byline; Completed also stays the folded list; NO "Done, check it" or
 *    category is drawn (they are not guessed). Built but waiting's task is marked by the engine
 *    (tasks.setBuilt), and its row says who marked it and what is left. Needs Your Decision's task is a real one: its agent
 *    (Max) reports a question about its project, and the pane is asking,
 *  - #3949 layout: no left Projects column; the title is the count ("7 Tasks on 2 Projects", the projects
 *    those open tasks are on) with no separate count line; Project and Created: dropdowns on one row;
 *    Group by, Sort and a compact search (after Sort, "/" focuses it, Esc clears it) under the tiles;
 *    no tile hint,
 *  - a row sits in the group its evidence says (the agent that named its task is In progress),
 *  - the search filters as you type (sentence, number, project, agent), and combines with the
 *    project dropdown,
 *  - Group by Project regroups the same rows,
 *  - ticking two rows and Close them closes both, with the note on each history,
 *  - no element in the view carries a coloured left border (Josh, 2026-09-24 12:52),
 *  - #3949 (Josh, 2026-09-26): no outer frame around the page body (16:18); two bands (18:03), read as
 *    pixels: the page's ground from the title to the tiles, the surface (white) from Group by down to both
 *    window edges and the window's bottom, the task cards shaded with the ground, in the tab view and the
 *    consolidated column (whose rail stays unpainted); a status group with no tasks is not listed (18:16),
 *    and an emptied list shows one line ("No tasks match" / "No tasks yet."); the Close bar is sticky,
 *  - light, dark, a 760-wide and a 390-wide window, with no sideways
 *    scroll.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-tasks-view-3559.js            # headed
 *   HEADED=0 node docs/browser-checks/render-tasks-view-3559.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksview-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksview-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksview-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksview-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksview-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');
const commitments = require('../../engine/commitments');
const taskchat = require('../../engine/taskchat');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const launch = projects.create({ name: 'Spring launch' });
  const news = projects.create({ name: 'Newsletter' });
  /* #3949: Max asks the person a question about Spring launch (his own report plus an asking pane), so the
     task he holds is Needs Your Decision through the real rule, not a stub. */
  const selfreport = require('../../engine/selfreport');
  if (!selfreport.record('max', { state: 'needs_you', project: launch.id, because: 'which cover do you want?' }).recorded) throw new Error('fixture: Max\'s question was not recorded');
  fleet.install([
    fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
    fleet.agent('rex', { state: 'idle', displayName: 'Rex', role: 'a writer' }),
    fleet.agent('max', { state: 'needs_you', displayName: 'Max', role: 'a designer' }),
  ]);
  for (const [p, a] of [[launch, 'ada'], [launch, 'rex'], [news, 'rex'], [launch, 'max']]) projects.addAgent(p.id, a, null);
  tasks.create(launch.id, { sentence: 'Book the podcast tour' });                 // 1 nobody
  tasks.create(launch.id, { sentence: 'Order proof copies', who: 'rex' });        // 2 assigned
  tasks.create(launch.id, { sentence: 'Pick the launch date', who: 'ada' });      // 3 working
  tasks.create(launch.id, { sentence: 'Old checklist', who: 'ada' });             // 4 closed
  tasks.close(launch.id, 4);
  tasks.create(news.id, { sentence: 'Clean up bounced addresses', who: 'rex' });  // 1 assigned
  tasks.create(news.id, { sentence: 'Welcome email for new subscribers' });       // 2 nobody
  tasks.create(launch.id, { sentence: 'Approve the cover', who: 'max' });         // 5 decision (Max is asking)
  tasks.create(news.id, { sentence: 'Ship the signup form', who: 'rex' });        // 3 built (#3951)
  tasks.setBuilt(news.id, 3, { by: 'rex', note: 'waiting on the release' });
  commitments.report('ada', [{ what: 'working on task 3 of Spring launch' }]);
  // An ARCHIVED project's task must not appear anywhere in the view.
  const old = projects.create({ name: 'Old catalog' });
  tasks.create(old.id, { sentence: 'Archived away task' });
  projects.setArchived(old.id, true);
  const EXPECT = { decision: 1, working: 1, assigned: 2, nobody: 2, built: 1, closed: 1 };

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const read = () => {
    const panel = document.getElementById('panel-tasks');
    const tiles = [...document.querySelectorAll('#tsk-tiles .tsk-tile')].map((t) => ({ k: t.dataset.tile, n: Number(t.querySelector('.num').textContent),
      label: t.querySelector('.lab').textContent, bylines: t.querySelectorAll('.ts').length, color: getComputedStyle(t.querySelector('.num')).color }));
    const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; panel.appendChild(probe);
    const danger = getComputedStyle(probe).color; probe.remove();
    const rect = (id) => document.getElementById(id).getBoundingClientRect();
    const rows = [...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => ({
      text: r.querySelector('.tl').textContent,
      state: (r.querySelector('.tsk-state') || {}).textContent || '',
      /* The group a row sits in, by its heading: in a status group the heading IS the state, and
         the row no longer repeats it (Mona's look review of #3701). */
      group: (() => { const g = r.closest('.tsk-grp'); const h = g && (g.querySelector('h3') || g.querySelector('summary')); return h ? h.textContent : ''; })(),
    }));
    /* Any coloured left edge: a left border at least 2px wide that is not transparent. */
    const bars = [...panel.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.borderLeftWidth) >= 2 && cs.borderLeftStyle !== 'none' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(cs.borderLeftColor);
    }).map((el) => el.className || el.tagName);
    return {
      visible: !panel.hidden && panel.getClientRects().length > 0,
      text: panel.innerText,
      tiles,
      rows,
      fold: !!document.querySelector('#tsk-groups .tsk-fold'),
      foldCount: (() => { const sm = document.querySelector('#tsk-groups .tsk-fold summary'); const m = sm && sm.textContent.match(/\((\d+)\)/); return m ? Number(m[1]) : null; })(),
      bars,
      danger,
      rail: !!panel.querySelector('aside, .tsk-rail'),   // the rail was an <aside>
      hint: /Tap a tile to see only that group/.test(panel.innerText),
      selShown: document.getElementById('tsk-projsel').getClientRects().length > 0,
      /* #3949 positions: Project and Created: on one row above the tiles;
         Group by and Sort on one row under them. */
      /* #3949 (Josh, 19:30): the count is the title; the search is compact, to the right of Sort. */
      title: document.getElementById('tsk-title').textContent.trim(),
      countLine: !!document.getElementById('tsk-sub'),
      searchRightOfSort: rect('tsk-searchbox').left >= rect('tsk-sort').right - 1 && Math.abs(rect('tsk-searchbox').top - rect('tsk-sort').top) < 30,
      tilesGap: Math.round(document.querySelector('#panel-tasks .tsk-below').getBoundingClientRect().top - rect('tsk-tiles').bottom),
      filtersAbove: rect('tsk-win').bottom <= rect('tsk-tiles').top && rect('tsk-projsel').bottom <= rect('tsk-tiles').top,
      filtersRow: Math.abs(rect('tsk-projsel').top - rect('tsk-win').top) < 4,
      underBelow: rect('tsk-by').top >= rect('tsk-tiles').bottom && rect('tsk-sort').top >= rect('tsk-tiles').bottom,
      underRow: Math.abs(rect('tsk-by').top - rect('tsk-sort').top) < 4,
      createdLabel: (document.querySelector('label[for="tsk-win"]') || {}).textContent || '',
      /* Mona's design review of #3949: the four labels in Josh's own form, not letter-spaced capitals. */
      labels: [...panel.querySelectorAll('.tsk-cl')].map((l) => l.textContent),
      labelCase: getComputedStyle(panel.querySelector('.tsk-cl')).textTransform,
      allOption: (document.querySelector('#tsk-projsel option[value=""]') || {}).textContent || '',
      nobodyChips: document.querySelectorAll('#tsk-groups .tsk-who.nobody').length,
      searchW: Math.round(document.getElementById('tsk-search').getBoundingClientRect().width),
      mainW: Math.round(document.querySelector('.tsk-main').getBoundingClientRect().width),
    };
  };
  try {
    /* #3559, Josh's ruling: the Tasks tab (and the consolidated rail's button) appear only once the
       person has 25 tasks ever. This fixture has fewer, so first they must be hidden after a real
       status tick; then the saved flag (what "shown once, stays shown" writes) brings them in. */
    {
      chk(tasks.tasksEverCreated(projects.readAll()) < tasks.TASKS_TAB_MIN, '[gate] the fixture has fewer than 25 tasks, so the hidden arm below can mean something');
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      // A real status tick must land before "hidden" means anything: the markup starts hidden.
      const ticked = page.waitForResponse((r) => r.url().endsWith('/api/status') && r.ok(), { timeout: 10000 });
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const tick = await ticked.then((r) => r.json()).catch(() => null);
      chk(!!tick && tick.tasksTab === false, '[gate] a status tick landed and says tasksTab is false', JSON.stringify(tick && tick.tasksTab));
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => ({
        tab: document.querySelector('#tabs .tab[data-tab="tasks"]').getClientRects().length > 0,
        rail: document.getElementById('rail-projects-tasks').hidden === false,
      }));
      chk(!before.tab && !before.rail, '[gate] below 25 tasks the Tasks tab and the rail button are hidden', JSON.stringify(before));
      require('../../engine/store').writeSettings({ tasksTabShown: true });
      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await page.waitForFunction(() => document.querySelector('#tabs .tab[data-tab="tasks"]').getClientRects().length > 0, null, { timeout: 8000 }).catch(() => {});
      const after = await page.evaluate(() => document.querySelector('#tabs .tab[data-tab="tasks"]').getClientRects().length > 0);
      chk(after, '[gate] once shown (the saved flag), the Tasks tab is there', String(after));
      await page.close();
    }
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 760], ['dark', 390]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const tab = await page.$('#tabs .tab[data-tab="tasks"]');
      chk(!!tab, `${tag} the top nav has a Tasks tab`);
      if (width >= 1000) {
        await page.click('#tabs .tab[data-tab="tasks"]');
      } else {
        // Narrow: the tab bar sits behind the menu button, the route a person actually takes.
        await page.click('#burger');
        await page.waitForSelector('#tabs .tab[data-tab="tasks"]', { state: 'visible', timeout: 5000 });
        await page.click('#tabs .tab[data-tab="tasks"]');
      }
      await page.waitForFunction(() => document.querySelectorAll('#tsk-tiles .tsk-tile').length > 0 && document.querySelectorAll('#tsk-groups .tsk-row').length > 0, null, { timeout: 8000 });
      const a = await page.evaluate(read);
      chk(a.visible, `${tag} the Tasks page is on screen`);
      /* #3949 (Josh, 09-26 16:18): the tab view has no outer frame either ("lose the outer thin rounded box stroke");
         #3880 had removed it only in the consolidated column. The tiles keep their own border (asserted below). */
      const tabFrame = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#panel-tasks .tsk-view'));
        const tile = getComputedStyle(document.querySelector('#tsk-tiles .tsk-tile'));
        const side = (k) => cs['border' + k + 'Style'] === 'none' || cs['border' + k + 'Width'] === '0px';
        return { sides: ['Top', 'Right', 'Bottom', 'Left'].every(side), r: cs.borderTopLeftRadius, outline: cs.outlineStyle,
          shadow: cs.boxShadow, tileBorder: tile.borderTopWidth }; });
      chk(tabFrame.sides && tabFrame.r === '0px' && tabFrame.outline === 'none' && tabFrame.shadow === 'none' && tabFrame.tileBorder === '1px',
        `${tag} the tab view has no outer frame; the tiles keep their own border`, JSON.stringify(tabFrame));
      /* #3949 (Josh, 09-26 18:03): two bands, read as PIXELS (what he sees, not what the CSS says): the top band
         (title to tiles) on the page's ground to the window's left and right edges; from Group by down, the surface
         (white) to both edges and to the bottom of the window; the task cards shaded with the ground; the tiles still
         the surface. A 1x1 screenshot is read back through a canvas in the page. */
      const px = async (x, y) => {
        const b64 = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64');
        return page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas');
          c.width = 1; c.height = 1; const x2 = c.getContext('2d'); x2.drawImage(i, 0, 0); ok([...x2.getImageData(0, 0, 1, 1).data].slice(0, 3)); };
          i.src = 'data:image/png;base64,' + src; }), b64);
      };
      const tok = await page.evaluate(() => { const probe = (v) => { const e = document.createElement('i'); e.style.color = v;
        document.getElementById('panel-tasks').appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c.match(/\d+/g).slice(0, 3).map(Number); };
        return { bg: probe('var(--k-bg)'), surface: probe('var(--k-surface)') }; });
      await page.evaluate(() => scrollTo(0, 0));
      const geo = await page.evaluate(() => { const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const tiles = r('#tsk-tiles'); const under = r('#tsk-under'); const list = r('#tsk-groups .tsk-list');
        /* #4053: a counted Needs Your Decision is red-tinted by design (asserted below), so the surface is read on In progress. */
        const tile = r('#tsk-tiles [data-tile="working"]');
        /* clientWidth/Height, not innerWidth/Height: a classic scrollbar (headed, "Always show scroll bars", Windows)
           sits inside the inner box, and a read there is the scrollbar, not the page. */
        return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, bandY: Math.round((tiles.top + tiles.bottom) / 2), belowY: Math.round(under.top + under.height / 2),
          listX: Math.round(list.left + 6), listY: Math.round(list.top + 6), tileX: Math.round(tile.left + 6), tileY: Math.round(tile.top + 6) }; });
      const same = (p, q) => p.every((v, i) => Math.abs(v - q[i]) <= 2);
      const band = [await px(1, geo.bandY), await px(geo.w - 2, geo.bandY)];
      const below = [await px(1, geo.belowY), await px(geo.w - 2, geo.belowY)];
      const card = await px(geo.listX, geo.listY); const tilePx = await px(geo.tileX, geo.tileY);
      /* "To the bottom" is only a claim about the BLEED when the white band itself ends above the window's bottom:
         with a full list it runs past it and would read white regardless. So empty the list (a search that matches
         nothing), prove the band ends on screen, then read the window's bottom corners. */
      await page.fill('#tsk-search', 'zzz no task says this');
      await page.waitForTimeout(250);
      const shortEnd = await page.evaluate(() => Math.round(document.querySelector('#panel-tasks .tsk-below').getBoundingClientRect().bottom));
      const bottom = [await px(1, geo.h - 2), await px(geo.w - 2, geo.h - 2)];
      await page.fill('#tsk-search', '');
      await page.waitForTimeout(250);
      chk(shortEnd < geo.h - 10 && bottom.every((p) => same(p, tok.surface)), `${tag} with a short list the white still reaches the bottom of the window (the bleed, not the list)`, JSON.stringify({ shortEnd, h: geo.h, bottom }));
      chk(!same(tok.bg, tok.surface), `${tag} CONTROL: the ground and the surface are different colours, so the band checks can fail`, JSON.stringify(tok));
      chk(band.every((p) => same(p, tok.bg)), `${tag} the top band keeps the page's ground to both edges`, JSON.stringify({ band, bg: tok.bg }));
      chk(below.every((p) => same(p, tok.surface)), `${tag} from Group by down it is the surface (white) to both edges`, JSON.stringify({ below, surface: tok.surface }));
      chk(same(card, tok.bg) && same(tilePx, tok.surface), `${tag} the task cards are shaded with the ground; the tiles stay the surface`, JSON.stringify({ card, tile: tilePx }));
      chk(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag} the full-width band adds no sideways scroll`);
      /* #3949/#3951 (Josh): six single-label tiles in his order; Completed is a tile and still the fold below. */
      chk(JSON.stringify(a.tiles.map((t) => t.k)) === JSON.stringify(['decision', 'working', 'assigned', 'nobody', 'built', 'closed']), `${tag} the tiles are Josh's six groups in his order, each from a recorded state`, JSON.stringify(a.tiles.map((t) => t.k)));
      chk(JSON.stringify(a.tiles.map((t) => t.label)) === JSON.stringify(['Needs Your Decision', 'In progress', 'Assigned but not started', 'Unassigned', 'Built but waiting', 'Completed']), `${tag} each tile is one label`, JSON.stringify(a.tiles.map((t) => t.label)));
      chk(a.tiles.every((t) => t.bylines === 0), `${tag} no tile carries a byline`);
      chk(a.tiles[0].color === a.danger && a.tiles.slice(1).every((t) => t.color !== a.danger), `${tag} Needs Your Decision, and only it, is red`, JSON.stringify(a.tiles.map((t) => t.color).concat(a.danger)));
      chk(a.fold, `${tag} Completed stays the folded list`);
      chk(a.foldCount === EXPECT.closed, `${tag} the Completed fold counts the closed tasks`, JSON.stringify({ fold: a.foldCount, expect: EXPECT.closed }));
      chk(!a.rail && a.selShown, `${tag} no left Projects column; the project dropdown is there`, JSON.stringify({ rail: a.rail, sel: a.selShown }));
      chk(!a.hint, `${tag} the tile hint is gone`);
      chk(JSON.stringify(a.labels) === JSON.stringify(['Project:', 'Created:', 'Group by:', 'Sort:']) && a.labelCase === 'none', `${tag} the labels read as Josh wrote Created:, not in capitals`, JSON.stringify({ labels: a.labels, c: a.labelCase }));
      chk(a.allOption === 'All projects', `${tag} All projects carries no count (it read as a number of projects)`, JSON.stringify(a.allOption));
      chk(a.nobodyChips === 0, `${tag} grouped by status, the Unassigned rows carry no Nobody yet chip (the heading says it)`, String(a.nobodyChips));
      /* On a phone-width window each pair may wrap onto two lines; above it they share one (Josh: "the same line"). */
      /* The pairs wrap only by flex-wrap (no breakpoint): measured at 390 each pair wraps, at 760 each fits, so 480
         splits the widths this check drives and asserts nothing about widths it does not. */
      const oneRow = width > 480;
      chk(a.filtersAbove && (!oneRow || a.filtersRow) && a.createdLabel === 'Created:', `${tag} Project and Created: are dropdowns above the tiles${oneRow ? ', on one row' : ''}`, JSON.stringify({ above: a.filtersAbove, row: a.filtersRow, label: a.createdLabel }));
      chk(a.underBelow && (!oneRow || a.underRow), `${tag} Group by and Sort are dropdowns under the tiles${oneRow ? ', on one row' : ''}`, JSON.stringify({ below: a.underBelow, row: a.underRow }));
      /* Mona's look review of #3701: the two big gaps, measured 51px above the title and 49px from
         the tile hint to the first group, are about halved. Bounded both ways so neither creeps
         back and neither collapses into crowding. #3949: the hint is gone, so the second gap is
         measured from the Group by row that now sits between the tiles and the list. */
      const gaps = await page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        const main = document.querySelector('#panel-tasks .tsk-main').getBoundingClientRect();
        const h3 = document.querySelector('#tsk-groups .tsk-grp h3, #tsk-groups .tsk-grp summary').getBoundingClientRect();
        return { aboveTitle: Math.round(box('tsk-title').top - main.top), hintToGroup: Math.round(h3.top - document.getElementById('tsk-under').getBoundingClientRect().bottom),
          crumbEmpty: document.getElementById('tsk-crumb').textContent === '' };
      });
      chk(gaps.crumbEmpty, `${tag} measured with no project picked (the crumb is empty), so the title gap below means something`, JSON.stringify(gaps));
      chk(gaps.aboveTitle >= 16 && gaps.aboveTitle <= 32, `${tag} the gap above the title is about half the old 51px`, JSON.stringify(gaps));
      chk(gaps.hintToGroup >= 16 && gaps.hintToGroup <= 32, `${tag} the gap from the Group by row to the first group is about half the old 49px`, JSON.stringify(gaps));
      chk(a.tiles.every((t) => t.n === EXPECT[t.k]), `${tag} each tile counts its group`, JSON.stringify(a.tiles));
      chk(!/Waiting on you|Done, check it|Categor/i.test(a.text), `${tag} no unprovable group or category is drawn`);
      const cover = a.rows.find((r) => r.text === 'Approve the cover');
      chk(cover && /Needs Your Decision/.test(cover.group), `${tag} the task whose agent needs the person is under Needs Your Decision`, JSON.stringify(cover));
      chk(!/Archived away task|Old catalog/.test(a.text), `${tag} an archived project's tasks are left out`);
      const date = a.rows.find((r) => r.text === 'Pick the launch date');
      chk(date && /In progress/.test(date.group), `${tag} the task its agent named is In progress`, JSON.stringify(date));
      const proof = a.rows.find((r) => r.text === 'Order proof copies');
      chk(proof && /Assigned but not started/.test(proof.group), `${tag} an assigned task its agent has not named is Assigned`, JSON.stringify(proof));
      chk(a.rows.every((r) => r.state === ''), `${tag} grouped by status, no row repeats its group's name`, JSON.stringify(a.rows.filter((r) => r.state).slice(0, 3)));
      chk(a.bars.length === 0, `${tag} no element carries a coloured left border`, JSON.stringify(a.bars.slice(0, 5)));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      chk(sideways <= 0, `${tag} no sideways scroll`, String(sideways));
      /* #3949 (Josh, 09-26 19:30): "X Tasks on N Projects" as the title (open tasks: this fixture has 7 on 2 live
         projects), no separate count line, the search compact to the right of Sort, taller ground under the tiles. */
      chk(a.title === '7 Tasks on 2 Projects' && !a.countLine, `${tag} the title is the count, "7 Tasks on 2 Projects", and there is no separate count line`, JSON.stringify({ title: a.title, countLine: a.countLine }));
      chk(a.searchW <= 40, `${tag} at rest the search is compact (the magnifier)`, JSON.stringify({ w: a.searchW }));
      if (width > 760) chk(a.searchRightOfSort, `${tag} the search sits to the right of Sort`);
      chk(a.tilesGap >= 30, `${tag} the ground under the tiles is taller (at least 30px before the white)`, String(a.tilesGap));
      {
        /* The width animates (.15s): read it once it has settled. */
        const sw = async () => { await page.waitForTimeout(300); return page.evaluate(() => Math.round(document.getElementById('tsk-search').getBoundingClientRect().width)); };
        await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
        await page.keyboard.press('/');
        const slash = await page.evaluate(() => document.activeElement && document.activeElement.id);
        const openW = await sw();
        await page.keyboard.type('launch');
        await page.evaluate(() => document.getElementById('tsk-search').blur());
        const keptW = await sw();
        await page.focus('#tsk-search');
        await page.keyboard.press('Escape');
        const after = await page.evaluate(() => ({ q: TSK.q, value: document.getElementById('tsk-search').value, focused: document.activeElement && document.activeElement.id,
          rows: document.querySelectorAll('#tsk-groups .tsk-row').length }));
        const closedW = await sw();
        chk(slash === 'tsk-search' && openW >= 200, `${tag} "/" focuses the search and it opens`, JSON.stringify({ slash, openW }));
        chk(keptW >= 200, `${tag} while it holds a search it stays open after you leave it`, String(keptW));
        chk(after.q === '' && after.value === '' && after.focused === 'tsk-search' && closedW <= 40 && after.rows >= 7, `${tag} Esc clears the search, closes it, keeps focus in it, and brings every row back`, JSON.stringify({ after, closedW }));
        await page.keyboard.type('l');
        const reopenW = await sw();
        /* An IME's own Esc (cancelling a conversion) is not the search's: a composing Escape leaves the search alone. */
        const ime = await page.evaluate(() => { const q = document.getElementById('tsk-search');
          q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
          const a = { value: q.value, q: TSK.q };
          q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true, cancelable: true }));
          return { a, b: { value: q.value, q: TSK.q } }; });
        chk(ime.a.value === 'l' && ime.a.q === 'l' && ime.b.value === 'l', `${tag} an Escape during an IME composition does not clear the search`, JSON.stringify(ime));
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.getElementById('tsk-search').blur());
        chk(reopenW >= 200, `${tag} typing again after Esc opens it again`, String(reopenW));
        /* The usual way in: click the Tasks tab (Chrome leaves focus on it), then "/". */
        if (width >= 1000) {
          await page.click('#tabs .tab[data-tab="tasks"]');
          const onTab = await page.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tab);
          await page.keyboard.press('/');
          const fromTab = await page.evaluate(() => document.activeElement && document.activeElement.id);
          await page.evaluate(() => document.getElementById('tsk-search').blur());
          chk(onTab === 'tasks' && fromTab === 'tsk-search', `${tag} "/" right after clicking the Tasks tab focuses the search`, JSON.stringify({ onTab, fromTab }));
        }
        /* Not while a header popover is open: the account menu keeps focus on its button; "/" leaves it there. */
        {
          await page.click('#userpop-btn');
          await page.waitForTimeout(150);
          const pop = await page.evaluate(() => ({ open: !document.getElementById('userpop-menu').hidden, on: document.activeElement && document.activeElement.id }));
          await page.keyboard.press('/');
          const popAfter = await page.evaluate(() => ({ on: document.activeElement && document.activeElement.id, open: !document.getElementById('userpop-menu').hidden }));
          await page.keyboard.press('Escape');
          await page.evaluate(() => { const m = document.getElementById('userpop-menu'); if (m && !m.hidden) document.getElementById('userpop-btn').click(); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
          chk(pop.open && popAfter.open && popAfter.on !== 'tsk-search', `${tag} "/" with the account menu open does not move focus into the search`, JSON.stringify({ pop, popAfter }));
        }
        /* Nor with the narrow-screen nav open: opening it puts focus on its first tab, not on the burger (round 17). */
        if (width <= 760) {
          await page.click('#burger');
          await page.waitForTimeout(150);
          const nav = await page.evaluate(() => ({ open: document.getElementById('burger').getAttribute('aria-expanded'), on: document.activeElement && (document.activeElement.id || (document.activeElement.dataset && document.activeElement.dataset.tab)) }));
          await page.keyboard.press('/');
          const navAfter = await page.evaluate(() => ({ on: document.activeElement && (document.activeElement.id || (document.activeElement.dataset && document.activeElement.dataset.tab)), open: document.getElementById('burger').getAttribute('aria-expanded') }));
          await page.click('#burger');
          await page.waitForTimeout(150);
          await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
          chk(nav.open === 'true' && navAfter.open === 'true' && navAfter.on !== 'tsk-search', `${tag} "/" with the narrow-screen nav open does not move focus into the search`, JSON.stringify({ nav, navAfter }));
        }
        /* But an ordinary disclosure that is open (a subtask fold chip, a project row: aria-expanded="true") is not a
           popover: "/" from it still reaches the search (review round 16). A tile stands in for one here. */
        {
          const disc = await page.evaluate(() => { const b = document.querySelector('#tsk-tiles [data-tile="nobody"]'); b.setAttribute('aria-expanded', 'true'); b.focus(); return document.activeElement === b; });
          await page.keyboard.press('/');
          const fromDisc = await page.evaluate(() => { const id = document.activeElement && document.activeElement.id; document.querySelector('#tsk-tiles [data-tile="nobody"]').removeAttribute('aria-expanded'); document.getElementById('tsk-search').blur(); return id; });
          chk(disc && fromDisc === 'tsk-search', `${tag} "/" from an open disclosure (aria-expanded) still focuses the search`, JSON.stringify({ disc, fromDisc }));
        }
        /* "/" from a row's checkbox (not a text field) reaches the search; and a popup trigger left expanded but not on
           screen (a combobox inside a closed dialog) does not switch "/" off (review round 18). */
        {
          const cb = await page.evaluate(() => { const c = document.querySelector('#tsk-groups input[type="checkbox"][data-key]'); c.focus(); return document.activeElement === c; });
          await page.keyboard.press('/');
          const fromCb = await page.evaluate(() => { const id = document.activeElement && document.activeElement.id; document.getElementById('tsk-search').blur(); return id; });
          await page.evaluate(() => { const g = document.createElement('div'); g.hidden = true; window.__tskGhost = g;
            g.innerHTML = '<button type="button" aria-haspopup="listbox" aria-expanded="true">stale</button>'; document.body.appendChild(g); });
          await page.focus('#tsk-tiles [data-tile="nobody"]');
          await page.keyboard.press('/');
          const withGhost = await page.evaluate(() => { const id = document.activeElement && document.activeElement.id; window.__tskGhost.remove(); delete window.__tskGhost; document.getElementById('tsk-search').blur(); return id; });
          chk(cb && fromCb === 'tsk-search' && withGhost === 'tsk-search', `${tag} "/" works from a row checkbox, and a hidden expanded trigger does not switch it off`, JSON.stringify({ cb, fromCb, withGhost }));
        }
        /* After Esc (closed, focus kept), a click on the field opens it again. */
        {
          await page.focus('#tsk-search'); await page.keyboard.type('x'); await page.keyboard.press('Escape');
          const shutW = await sw();
          await page.click('#tsk-search');
          const clickW = await sw();
          await page.evaluate(() => document.getElementById('tsk-search').blur());
          chk(shutW <= 40 && clickW >= 200, `${tag} after Esc a click on the search opens it again`, JSON.stringify({ shutW, clickW }));
        }
        /* "/" from a control inside the Tasks view (a tile button) focuses the search too. */
        await page.focus('#tsk-tiles [data-tile="nobody"]');
        await page.keyboard.press('/');
        const fromTile = await page.evaluate(() => document.activeElement && document.activeElement.id);
        await page.evaluate(() => document.getElementById('tsk-search').blur());
        chk(fromTile === 'tsk-search', `${tag} "/" from a tile inside the view focuses the search`, JSON.stringify(fromTile));
        /* The count and its projects come from the same filtered tasks: a search that leaves one task on one project
           says so (review round 11: the project count had been unfiltered, "1 Task on 2 Projects"). */
        await page.fill('#tsk-search', 'podcast');
        await page.waitForTimeout(200);
        const oneTitle = await page.evaluate(() => document.getElementById('tsk-title').textContent.trim());
        await page.fill('#tsk-search', '');
        await page.evaluate(() => document.getElementById('tsk-search').blur());
        chk(oneTitle === '1 Task on 1 Project', `${tag} a search leaving one task titles it "1 Task on 1 Project"`, JSON.stringify(oneTitle));
        /* "/" never reaches past an open modal: New task's dialog open, focus on its own Cancel button, "/" leaves focus
           there (review round 11: the guard had looked for a <dialog> the app does not use). */
        await page.click('#tsk-new');
        await page.waitForTimeout(300);
        const modal = await page.evaluate(() => { const b = document.getElementById('nt-back'); if (b) b.focus();
          const open = [...document.querySelectorAll('[aria-modal="true"]')].some((m) => m.getClientRects().length > 0);
          return { open, before: document.activeElement && document.activeElement.id }; });
        await page.keyboard.press('/');
        const modalAfter = await page.evaluate(() => document.activeElement && document.activeElement.id);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        const closed = await page.evaluate(() => ![...document.querySelectorAll('[aria-modal="true"]')].some((m) => m.getClientRects().length > 0));
        chk(modal.open && modal.before === 'nt-back' && modalAfter === 'nt-back' && closed, `${tag} "/" with a modal open leaves focus in the modal`, JSON.stringify({ modal, modalAfter, closed }));
        /* And with the modal open but focus on the page itself (a confirm button that disabled and blurred itself):
           the aria-modal guard is what stops it here, not the "inside the view" guard. */
        await page.click('#tsk-new');
        await page.waitForTimeout(300);
        const bodyModal = await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur();
          return { open: [...document.querySelectorAll('[aria-modal="true"]')].some((m) => m.getClientRects().length > 0), focus: document.activeElement === document.body }; });
        await page.keyboard.press('/');
        const bodyAfter = await page.evaluate(() => document.activeElement && document.activeElement.id);
        await page.evaluate(() => { const b = document.getElementById('nt-back'); if (b) b.click(); });
        await page.waitForTimeout(200);
        chk(bodyModal.open && bodyModal.focus && bodyAfter !== 'tsk-search', `${tag} "/" with a modal open and focus on the page does not reach the search`, JSON.stringify({ bodyModal, bodyAfter }));
      }
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `tasks-${theme}-${width}.png`), fullPage: true }); }

      if (theme === 'light' && width === 1400) {
        /* A repaint nobody pressed for (a load finishing) keeps focus on the same control. */
        await page.focus('#tsk-tiles [data-tile="working"]');
        await page.evaluate(() => tskLoad());
        await page.waitForTimeout(300);
        const kept = await page.evaluate(() => (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tile) || document.activeElement.tagName);
        chk(kept === 'working', `${tag} a background reload keeps focus on the same tile`, kept);
        /* And a press keeps it too. */
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        const pressed = await page.evaluate(() => ({ tile: document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tile, on: TSK.tile }));
        chk(pressed.tile === 'working' && pressed.on === 'working', `${tag} Enter on a tile filters and keeps focus there`, JSON.stringify(pressed));
        await page.keyboard.press('Enter'); // back to everything
        /* #3951: the Built but waiting tile filters to the marked task, and its row says who marked it and what is
           left (the note is the agent's own words). */
        await page.click('#tsk-tiles [data-tile="built"]');
        await page.waitForTimeout(200);
        const builtRows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => ({
          t: r.querySelector('.tl').textContent, why: [...r.querySelectorAll('.why')].map((x) => x.textContent).join(' ') })));
        chk(builtRows.length === 1 && builtRows[0].t === 'Ship the signup form' && /^Marked built by Rex .+: waiting on the release Not built yet$/.test(builtRows[0].why),
          `${tag} the Built but waiting tile shows the marked task, with who marked it and what is left`, JSON.stringify(builtRows));
        /* Review round 1: the person takes a mistaken mark off from the row; the task stays open (Assigned), and the
           tile is at 0. Marked again by the engine after, so the checks below see the fixture as it was. */
        await page.click('#tsk-groups [data-unbuild]');
        await page.waitForFunction(() => document.querySelector('#tsk-tiles [data-tile="built"] .num').textContent === '0', null, { timeout: 5000 }).catch(() => {});
        const after = await page.evaluate(() => ({ n: document.querySelector('#tsk-tiles [data-tile="built"] .num').textContent,
          msg: document.getElementById('tsk-msg').textContent,
          row: (TSK.data || []).find((t) => t.sentence === 'Ship the signup form') }));
        chk(after.n === '0' && after.row && after.row.state === 'assigned' && /no longer marked built/.test(after.msg),
          `${tag} Not built yet takes the mark off and the task stays open`, JSON.stringify({ n: after.n, state: after.row && after.row.state, msg: after.msg }));
        await page.click('#tsk-tiles [data-tile="built"]'); // back to everything
        tasks.setBuilt(news.id, 3, { by: 'rex', note: 'waiting on the release' });
        await page.evaluate(() => tskLoad());
        await page.waitForTimeout(300);
        /* A focused CHECKBOX keeps focus through a reload (its row shares its key, so a first-match
           restore would land on the row, which cannot take focus). */
        await page.focus('#tsk-groups input[data-key="' + launch.id + '#2"]');
        await page.evaluate(() => tskLoad());
        await page.waitForTimeout(300);
        const box = await page.evaluate(() => ({ tag: document.activeElement.tagName, key: document.activeElement.dataset && document.activeElement.dataset.key }));
        chk(box.tag === 'INPUT' && box.key === launch.id + '#2', `${tag} a focused checkbox keeps focus through a reload`, JSON.stringify(box));
        /* Search: by agent name, then by number, combined with the project dropdown. */
        await page.fill('#tsk-search', 'rex');
        let rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(rows.length === 3 && rows.includes('Order proof copies') && rows.includes('Clean up bounced addresses') && rows.includes('Ship the signup form'), `${tag} search finds tasks by agent name`, JSON.stringify(rows));
        await page.selectOption('#tsk-projsel', news.id);
        rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(JSON.stringify([...rows].sort()) === JSON.stringify(['Clean up bounced addresses', 'Ship the signup form']), `${tag} search combines with the project dropdown`, JSON.stringify(rows));
        await page.fill('#tsk-search', '');
        /* The crumb's "All tasks" empties the crumb: focus lands on the project dropdown, not the body. */
        await page.focus('#tsk-crumb [data-proj=""]');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        const crumbFocus = await page.evaluate(() => ({ id: document.activeElement.id, value: document.getElementById('tsk-projsel').value }));
        chk(crumbFocus.id === 'tsk-projsel' && crumbFocus.value === '', `${tag} the crumb's All tasks keeps focus (on the project dropdown, now All projects)`, JSON.stringify(crumbFocus));
        await page.fill('#tsk-search', 'podcast');
        rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(JSON.stringify(rows) === JSON.stringify(['Book the podcast tour']), `${tag} search finds a task by what it says`, JSON.stringify(rows));
        /* #3949: with nothing to act on (the search leaves Needs Your Decision at 0), that tile is not red. */
        const zero = await page.evaluate(() => {
          const t = document.querySelector('#tsk-tiles [data-tile="decision"]');
          const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.getElementById('panel-tasks').appendChild(probe);
          const danger = getComputedStyle(probe).color; probe.remove();
          /* Review round 10: its group heading too (it had kept a red dot at zero). */
          const h = [...document.querySelectorAll('#tsk-groups .tsk-grp h3')].find((x) => /Needs Your Decision/.test(x.textContent));
          return { n: Number(t.querySelector('.num').textContent), red: getComputedStyle(t.querySelector('.num')).color === danger,
            redDot: getComputedStyle(t.querySelector('.tsk-dot')).backgroundColor === danger,
            /* #4053: the badge and the tile's fill are neutral at zero too. */
            redBadge: t.querySelector('.tsk-badge') ? getComputedStyle(t.querySelector('.tsk-badge')).color === danger : null,
            bg: getComputedStyle(t).backgroundColor, other: (() => { const e = document.createElement('span'); e.style.backgroundColor = 'var(--k-surface)';
              document.getElementById('panel-tasks').appendChild(e); const v = getComputedStyle(e).backgroundColor; e.remove(); return v; })(),
            head: h ? h.textContent : null, headRedDot: h ? getComputedStyle(h.querySelector('.tsk-dot')).backgroundColor === danger : null };
        });
        chk(zero.n === 0 && !zero.red && !zero.redDot && zero.redBadge === false && zero.bg === zero.other, `${tag} a zero Needs Your Decision tile is not red, its dot, badge and fill included`, JSON.stringify(zero));
        /* #3949 (Josh, 09-26 18:16): a status group with no tasks is not drawn (its tile already says 0): the search
           leaves only Unassigned, so only Unassigned is listed, and nothing anywhere says "Nothing here". */
        const drawn = await page.evaluate(() => ({ heads: [...document.querySelectorAll('#tsk-groups .tsk-grp h3, #tsk-groups .tsk-grp summary')].map((h) => h.textContent.replace(/[\d()?]+/g, '').trim()),
          nothing: /Nothing here/.test(document.getElementById('tsk-groups').textContent) }));
        chk(zero.head === null && JSON.stringify(drawn.heads) === JSON.stringify(['Unassigned']) && !drawn.nothing,
          `${tag} only groups with tasks are listed (the empty ones are left to their tiles), and none says Nothing here`, JSON.stringify(drawn));
        /* A filter that empties the list says so once: the search plus the (zero) In progress tile. */
        await page.click('#tsk-tiles [data-tile="working"]');
        const emptied = await page.evaluate(() => ({ grp: document.querySelectorAll('#tsk-groups .tsk-grp').length, text: document.getElementById('tsk-groups').textContent.trim() }));
        chk(emptied.grp === 0 && /^No tasks match/.test(emptied.text), `${tag} a filter that empties the list shows one "No tasks match" line`, JSON.stringify(emptied));
        await page.click('#tsk-tiles [data-tile="working"]'); // back
        /* And with no search at all: the Newsletter project plus the Needs Your Decision tile (its task is Spring
           launch's) empties the list, and the line is the plain one. */
        const emptiedNoSearch = await page.evaluate(async () => {
          const q = document.getElementById('tsk-search'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
          const sel = document.getElementById('tsk-projsel'); const opt = [...sel.options].find((o) => o.textContent.startsWith('Newsletter'));
          sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 300));
          document.querySelector('#tsk-tiles [data-tile="decision"]').click();
          await new Promise((r) => setTimeout(r, 300));
          const out = { grp: document.querySelectorAll('#tsk-groups .tsk-grp').length, text: document.getElementById('tsk-groups').textContent.trim() };
          document.querySelector('#tsk-tiles [data-tile="decision"]').click();
          sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 300));
          q.value = 'podcast'; q.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 300));
          return out;
        });
        chk(emptiedNoSearch.grp === 0 && emptiedNoSearch.text === 'No tasks match.', `${tag} with no search, a project and a tile that empty the list show one "No tasks match." line`, JSON.stringify(emptiedNoSearch));
        /* #3949: with no filter at all and no tasks, the one line says so plainly (not "match"). Driven through the
           page's own data and painter, then put back. */
        const noneYet = await page.evaluate(() => {
          const keep = { data: TSK.data, tile: TSK.tile, proj: TSK.proj, win: TSK.win, q: TSK.q };
          TSK.data = []; TSK.tile = null; TSK.proj = null; TSK.win = 0; TSK.q = ''; tskPaint();
          const out = { grp: document.querySelectorAll('#tsk-groups .tsk-grp').length, text: document.getElementById('tsk-groups').textContent.trim() };
          Object.assign(TSK, keep); tskPaint();
          return out;
        });
        chk(noneYet.grp === 0 && noneYet.text === 'No tasks yet.', `${tag} with no filter and no tasks the one line says "No tasks yet."`, JSON.stringify(noneYet));
        /* And unreadable with nothing listed: the group says it cannot tell, never "Nothing here" (review round 10). */
        const unknownEmpty = await page.evaluate(() => {
          TSK.rosterUnknown = true; tskPaint();
          const sec = document.querySelector('#tsk-groups .tsk-grp[data-unknown]');
          const out = { sec: !!sec, text: sec ? sec.textContent : '' };
          TSK.rosterUnknown = false; tskPaint();
          return out;
        });
        chk(unknownEmpty.sec && /cannot tell/.test(unknownEmpty.text) && !/Nothing here/.test(unknownEmpty.text) && /\?/.test(unknownEmpty.text),
          `${tag} with the agents unreadable and nothing listed, the decision group says it cannot tell`, JSON.stringify(unknownEmpty));
        /* Review round 9: when the server could not read the agents (rosterUnreadable), the tile says it cannot tell
           rather than 0, and is not red. Driven through the page's own flag and painter, with the search cleared so
           the data still holds Max's question: the tile would be red with a 1 if the flag were ignored. */
        const unknown = await page.evaluate(() => {
          document.getElementById('tsk-search').value = ''; TSK.q = '';
          TSK.rosterUnknown = true; tskPaint();
          const t = document.querySelector('#tsk-tiles [data-tile="decision"]');
          const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.getElementById('panel-tasks').appendChild(probe);
          const danger = getComputedStyle(probe).color; probe.remove();
          const h = [...document.querySelectorAll('#tsk-groups .tsk-grp h3')].find((x) => /Needs Your Decision/.test(x.textContent));
          const out = { num: t.querySelector('.num').textContent, n: t.dataset.n, red: getComputedStyle(t.querySelector('.num')).color === danger,
            label: t.getAttribute('aria-label') || '', redBadge: t.querySelector('.tsk-badge') ? getComputedStyle(t.querySelector('.tsk-badge')).color === danger : null,
            /* Against the surface itself, not a sibling tile: the pointer can still rest on one from an earlier click (review). */
            bgSame: (() => { const e = document.createElement('span'); e.style.backgroundColor = 'var(--k-surface)'; document.getElementById('panel-tasks').appendChild(e);
              const v = getComputedStyle(e).backgroundColor; e.remove(); return getComputedStyle(t).backgroundColor === v; })(),
            headCount: h ? h.querySelector('.count').textContent : null, headRedDot: h ? getComputedStyle(h.querySelector('.tsk-dot')).backgroundColor === danger : null,
            why: h ? h.parentNode.querySelector('.why').textContent : '' };
          TSK.rosterUnknown = false; tskPaint();
          out.after = document.querySelector('#tsk-tiles [data-tile="decision"] .num').textContent;
          return out;
        });
        chk(unknown.num === '?' && unknown.n === 'unknown' && !unknown.red && unknown.redBadge === false && unknown.bgSame && /cannot tell/.test(unknown.label) && unknown.after === '1'
          && unknown.headCount === '?' && unknown.headRedDot === false && /cannot tell/.test(unknown.why),
          `${tag} with the agents unreadable, Needs Your Decision says it cannot tell (not 0, not red)`, JSON.stringify(unknown));
        /* #4053 (Josh picked option C, then taller; approved v2 mock): every tile has a 36px round tinted badge with a
           19px line icon beside its number, the label below it 10px on, 16px 16px 15px padding and one shared height
           (at least 108px). Needs Your Decision with a count (Max's 1, restored above) is red: badge, and a red-tinted
           fill that no other tile has. */
        await page.mouse.move(0, 0); // no tile hovered from an earlier real click (review)
        const c2 = await page.evaluate(() => {
          const probe = (v, prop) => { const e = document.createElement('span'); e.style[prop] = v; document.getElementById('panel-tasks').appendChild(e);
            const c = getComputedStyle(e)[prop]; e.remove(); return c; };
          const danger = probe('var(--danger)', 'color');
          const tint = probe('color-mix(in srgb, var(--danger) 9%, var(--k-surface))', 'backgroundColor');
          return [...document.querySelectorAll('#tsk-tiles .tsk-tile')].map((t) => {
            const cs = getComputedStyle(t); const row = t.querySelector('.tsk-mkrow'); const b = row && row.querySelector('.tsk-badge');
            const svg = b && b.querySelector('svg'); const bs = b && getComputedStyle(b); const br = b && b.getBoundingClientRect();
            const sr = svg && svg.getBoundingClientRect(); const lab = t.querySelector('.lab').getBoundingClientRect();
            return { k: t.dataset.tile, n: t.dataset.n, badgeFirst: !!(row && row.firstElementChild === b && row.lastElementChild === t.querySelector('.num')),
              badge: br ? [Math.round(br.width), Math.round(br.height)] : null, round: bs ? bs.borderTopLeftRadius : null,
              icon: sr ? [Math.round(sr.width), Math.round(sr.height)] : null, paths: svg ? svg.querySelectorAll('path, circle').length : 0,
              hidden: svg ? svg.getAttribute('aria-hidden') : null,
              /* The exact tint: the tile's own colour at 15% (review round 3: "differs from the tile" could not fail). */
              tinted: bs ? bs.backgroundColor === probe('color-mix(in srgb, ' + cs.getPropertyValue('--tsk-c').trim() + ' 15%, transparent)', 'backgroundColor')
                && bs.backgroundColor !== probe('transparent', 'backgroundColor') : false,
              badgeRed: bs ? bs.color === danger : null, pad: cs.padding, h: Math.round(t.getBoundingClientRect().height),
              gap: Math.round(lab.top - (row ? row.getBoundingClientRect().bottom : 0)), bg: cs.backgroundColor, redFill: cs.backgroundColor === tint };
          });
        });
        const hs = new Set(c2.map((x) => x.h));
        const dec = c2.find((x) => x.k === 'decision');
        chk(c2.length === 6 && c2.every((x) => x.badgeFirst && x.badge && x.badge[0] === 36 && x.badge[1] === 36 && x.round === '50%'
            && x.icon && x.icon[0] === 19 && x.icon[1] === 19 && x.paths >= 2 && x.hidden === 'true' && x.tinted
            && x.pad === '16px 16px 15px' && x.h >= 108 && x.gap === 10) && hs.size === 1,
          `${tag} each tile has its 36px tinted badge with a 19px icon before the number, 16px padding, a 10px gap and one shared height (#4053)`, JSON.stringify(c2));
        chk(dec && dec.n === '1' && dec.badgeRed && dec.redFill && c2.filter((x) => x.redFill).length === 1 && c2.filter((x) => x.badgeRed).length === 1,
          `${tag} Needs Your Decision with a count has a red badge and the only red-tinted fill (#4053)`, JSON.stringify(dec));
        /* Review: one shared height must hold when the row wraps too. Five columns leaves Completed (a one-line
           label) alone on the second row, where it would size to itself without the rule. */
        {
          const five = await page.evaluate(() => {
            const g = document.getElementById('tsk-tiles'); const was = g.style.width; g.style.width = (5 * 138 + 4 * 10 + 20) + 'px';
            const tops = new Set(); const hs = new Set();
            for (const t of g.querySelectorAll('.tsk-tile')) { const r = t.getBoundingClientRect(); tops.add(Math.round(r.top)); hs.add(Math.round(r.height)); }
            g.style.width = was; return { rows: tops.size, heights: [...hs] };
          });
          chk(five.rows === 2 && five.heights.length === 1, `${tag} with the tiles wrapped (five across), every tile keeps one height (#4053 review)`, JSON.stringify(five));
        }
        /* Review: the red fill outranks the shared selected rule, so selecting the red tile must still show (deeper red, red edge). */
        {
          await page.mouse.move(0, 0);
          const sel = await page.evaluate(() => {
            const t = document.querySelector('#tsk-tiles [data-tile="decision"]'); const before = getComputedStyle(t);
            const b = { bg: before.backgroundColor, edge: before.borderTopColor };
            t.click(); const t2 = document.querySelector('#tsk-tiles [data-tile="decision"]'); const cs = getComputedStyle(t2);
            const out = { pressed: t2.getAttribute('aria-pressed'), before: b, bg: cs.backgroundColor, edge: cs.borderTopColor };
            t2.click(); return out;
          });
          chk(sel.pressed === 'true' && sel.bg !== sel.before.bg && sel.edge !== sel.before.edge,
            `${tag} the red Needs Your Decision tile still shows it is selected (#4053 review)`, JSON.stringify(sel));
        }
        /* The same through the wire (review round 11): the route answers rosterUnreadable, and the page's own read
           (tskLoad) takes it; no flag set by hand. The rows are the route's own, with Max's decision as the route
           would derive it with no roster (not a decision). */
        await page.route('**/api/tasks?view=tasks*', async (route) => {
          const resp = await route.fetch();
          const json = await resp.json();
          json.rosterUnreadable = true;
          json.tasks = json.tasks.map((t) => (t.state === 'decision' ? Object.assign({}, t, { state: 'assigned', waitingOnPerson: false }) : t));
          await route.fulfill({ response: resp, json });
        });
        const wire = await page.evaluate(async () => {
          await tskLoad();
          const t = document.querySelector('#tsk-tiles [data-tile="decision"]');
          const sec = document.querySelector('#tsk-groups .tsk-grp[data-unknown]');
          return { num: t.querySelector('.num').textContent, flag: TSK.rosterUnknown, group: sec ? sec.textContent : null };
        });
        await page.unroute('**/api/tasks?view=tasks*');
        const wireBack = await page.evaluate(async () => { await tskLoad(); return { num: document.querySelector('#tsk-tiles [data-tile="decision"] .num').textContent, flag: TSK.rosterUnknown }; });
        chk(wire.num === '?' && wire.flag === true && wire.group && /cannot tell/.test(wire.group) && wireBack.num === '1' && wireBack.flag === false,
          `${tag} an unreadable roster from the route reaches the tile and its group through the page's own read, and a good read clears it`, JSON.stringify({ wire, wireBack }));
        await page.fill('#tsk-search', 'podcast');
        /* Its own clear button: shown with text, clears and hides again. */
        const clr = await page.evaluate(() => !document.getElementById('tsk-qclear').hidden);
        chk(clr, `${tag} the search's clear button shows once there is text`);
        await page.click('#tsk-qclear');
        const cleared = await page.evaluate(() => ({ v: document.getElementById('tsk-search').value, hidden: document.getElementById('tsk-qclear').hidden, rows: document.querySelectorAll('#tsk-groups .tsk-row').length }));
        chk(cleared.v === '' && cleared.hidden && cleared.rows > 1, `${tag} clear empties the search and brings the rows back`, JSON.stringify(cleared));
        /* No match says so, and what to do (Mona a40bbe1); a tick it hides is dropped. */
        await page.check('#tsk-groups input[data-key="' + launch.id + '#1"]');
        await page.fill('#tsk-search', 'zzz nothing like this');
        const hid = await page.evaluate(() => ({ sel: TSK.sel.size, bar: document.getElementById('tsk-bulk').hidden }));
        chk(hid.sel === 0 && hid.bar, `${tag} a search that hides every row drops the ticks (Close them cannot reach them)`, JSON.stringify(hid));
        const none = await page.evaluate(() => document.getElementById('tsk-groups').textContent);
        chk(/No tasks match .zzz nothing like this.\. Try fewer words, or clear the search\./.test(none), `${tag} a search with no match says so`, none);
        const liveNone = await page.evaluate(() => document.getElementById('tsk-found').textContent);
        chk(/^No tasks match/.test(liveNone), `${tag} the no-match result is announced to a screen reader`, liveNone);
        await page.fill('#tsk-search', 'podcast');
        const liveSome = await page.evaluate(() => document.getElementById('tsk-found').textContent);
        chk(liveSome === '1 task matches.', `${tag} a search's match count is announced`, liveSome);
        await page.fill('#tsk-search', '');
        const liveOff = await page.evaluate(() => document.getElementById('tsk-found').textContent);
        chk(liveOff === '', `${tag} with no search, nothing is announced`, JSON.stringify(liveOff));
        await page.fill('#tsk-search', '');
        /* Group by Project regroups the same rows. */
        await page.selectOption('#tsk-by', 'project');
        const heads = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-grp h3')].map((h) => h.firstChild.textContent));
        chk(JSON.stringify(heads) === JSON.stringify(['Newsletter', 'Spring launch']), `${tag} Group by Project shows one group per project`, JSON.stringify(heads));
        const byProj = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => ({ t: r.querySelector('.tl').textContent, s: (r.querySelector('.tsk-state') || {}).textContent || '' })));
        const dateP = byProj.find((r) => r.t === 'Pick the launch date');
        chk(dateP && /In progress/.test(dateP.s), `${tag} grouped by project, each row carries its state`, JSON.stringify(dateP));
        const podP = await page.evaluate(() => { const r = [...document.querySelectorAll('#tsk-groups .tsk-row')].find((x) => x.querySelector('.tl').textContent === 'Book the podcast tour'); return r ? !!r.querySelector('.tsk-who.nobody') : null; });
        chk(podP === true, `${tag} grouped by project (states mixed), an unassigned row keeps its Nobody yet chip`, String(podP));
        await page.selectOption('#tsk-by', 'status');
        /* Bulk close two tasks with a note. */
        await page.check('#tsk-groups input[data-key="' + news.id + '#2"]');
        await page.check('#tsk-groups input[data-key="' + launch.id + '#1"]');
        const barShown = await page.evaluate(() => !document.getElementById('tsk-bulk').hidden);
        chk(barShown, `${tag} ticking rows brings up the Close bar`);
        /* #3949: the Close bar is sticky to the window's bottom (#3559's position: sticky; bottom: 14px). It only
           started to stick when the view stopped clipping (the old frame's overflow: hidden made the view its scroll
           box). Measured in a short window, so the list is always longer than it and sticking is observable. */
        /* A short window makes the list longer than it whatever the fixture's size, so this cannot quietly skip. */
        await page.setViewportSize({ width, height: 520 });
        const stick = await page.evaluate(() => { scrollTo(0, 0); const b = document.getElementById('tsk-bulk').getBoundingClientRect();
          return { tall: document.getElementById('tsk-groups').getBoundingClientRect().bottom > innerHeight, top: Math.round(b.top), bottom: Math.round(b.bottom), h: innerHeight }; });
        await page.setViewportSize({ width, height: 1000 });
        chk(stick.tall && stick.top >= 0 && stick.bottom <= stick.h, `${tag} with a list longer than the window the Close bar stays on screen at the bottom (sticky)`, JSON.stringify(stick));
        /* Clear hides the bar with its own button in it: focus lands on the search, not the body. */
        await page.click('#tsk-bclear');
        const afterClear = await page.evaluate(() => ({ id: document.activeElement.id, sel: TSK.sel.size }));
        chk(afterClear.id === 'tsk-search' && afterClear.sel === 0, `${tag} Clear empties the ticks and keeps focus (on the search)`, JSON.stringify(afterClear));
        await page.check('#tsk-groups input[data-key="' + news.id + '#2"]');
        await page.check('#tsk-groups input[data-key="' + launch.id + '#1"]');
        await page.fill('#tsk-bnote', 'not doing these this season');
        const groupsTopBefore = await page.evaluate(() => Math.round(document.getElementById('tsk-groups').getBoundingClientRect().top + window.scrollY));
        await page.click('#tsk-bclose');
        await page.waitForFunction(() => /Closed 2 tasks/.test(document.getElementById('tsk-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        const msg = await page.evaluate(() => document.getElementById('tsk-msg').textContent);
        chk(/Closed 2 tasks/.test(msg), `${tag} Close them closes both and says so`, msg);
        /* The status line keeps its reserved line (Mona's gap fix must not bring back a jump): the
           list does not move down under the pointer when the message appears. */
        const groupsTopAfter = await page.evaluate(() => Math.round(document.getElementById('tsk-groups').getBoundingClientRect().top + window.scrollY));
        chk(groupsTopAfter === groupsTopBefore, `${tag} the message appearing does not shift the list`, JSON.stringify({ groupsTopBefore, groupsTopAfter }));
        const landed = await page.evaluate(() => document.activeElement && document.activeElement.id);
        chk(landed === 'tsk-msg', `${tag} after Close them, focus lands on what happened (not the page body)`, landed);
        const stored = projects.readAll();
        const closedBoth = stored.find((p) => p.id === news.id).tasks.find((t) => t.number === 2).closedAt
          && stored.find((p) => p.id === launch.id).tasks.find((t) => t.number === 1).closedAt;
        chk(!!closedBoth, `${tag} both tasks are closed in the store`);
        const note = taskchat.read(news.id, 2).filter((e) => e.kind === 'said').map((e) => e.text);
        chk(note.includes('not doing these this season'), `${tag} the note is on the task's history`, JSON.stringify(note));
        for (const [pid, n] of [[news.id, 2], [launch.id, 1]]) tasks.reopen(pid, n); // the other passes start from the seeded state
      }
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await page.close();
    }

    /* The consolidated view: the tab bar is hidden there, so the projects rail carries the way in. */
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await clearFirstRun(page);
    await page.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) }).then((r) => r.text()));
    await page.reload({ waitUntil: 'networkidle' });
    await clearFirstRun(page);
    await page.waitForFunction(() => document.body.classList.contains('consolidated'), null, { timeout: 8000 }).catch(() => {});
    const inCons = await page.evaluate(() => ({
      cons: document.body.classList.contains('consolidated'),
      btn: (() => { const b = document.getElementById('rail-projects-tasks'); return !!b && b.getClientRects().length > 0; })(),
    }));
    chk(inCons.cons && inCons.btn, '[consolidated] the projects rail shows a Tasks button', JSON.stringify(inCons));
    if (inCons.btn) {
      await page.click('#rail-projects-tasks');
      await page.waitForFunction(() => !document.getElementById('panel-tasks').hidden && document.querySelectorAll('#tsk-tiles .tsk-tile').length === 5, null, { timeout: 8000 }).catch(() => {});
      const got = await page.evaluate(() => {
        const pt = document.getElementById('panel-tasks');
        return {
          shown: !pt.hidden && pt.getClientRects().length > 0,
          tiles: document.querySelectorAll('#tsk-tiles .tsk-tile').length,
          stillCons: document.body.classList.contains('consolidated'),
          inColumn: pt.parentElement && pt.parentElement.id === 'panel-projects',
          noRail: !pt.querySelector('aside, .tsk-rail'),
          dropdown: document.getElementById('tsk-projsel').getClientRects().length > 0,
        };
      });
      chk(got.shown && got.tiles === 6, '[consolidated] it opens the Tasks view', JSON.stringify(got));
      chk(got.stillCons && got.inColumn, '[consolidated] it stays in the consolidated view, in the display column (#2842)', JSON.stringify(got));
      chk(got.noRail && got.dropdown, '[consolidated] no project column of its own; the project dropdown is there', JSON.stringify(got));
      /* Mona's look review of #3701, in the column too: the gap above the title is about halved. */
      const consGap = await page.evaluate(() => {
        const pt = document.getElementById('panel-tasks').getBoundingClientRect();
        return { aboveTitle: Math.round(document.getElementById('tsk-title').getBoundingClientRect().top - pt.top), crumbEmpty: document.getElementById('tsk-crumb').textContent === '' };
      });
      chk(consGap.crumbEmpty && consGap.aboveTitle >= 16 && consGap.aboveTitle <= 32, '[consolidated] the gap above the title is about half, not the stacked 49px', JSON.stringify(consGap));
      /* #3880 (Josh, 2026-09-25 22:01): no outer rounded box around the title, New task and list in the column.
         The tiles keep their own borders. */
      const frame = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('#panel-tasks .tsk-view'));
        const t = document.querySelector('#tsk-tiles .tsk-tile');
        const tile = t ? getComputedStyle(t) : null;
        return { w: cs.borderTopWidth, r: cs.borderTopLeftRadius, bg: cs.backgroundColor, tileW: tile ? tile.borderTopWidth : null };
      });
      chk(frame.w === '0px' && frame.r === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(frame.bg), '[consolidated] the view has no outer rounded box (#3880)', JSON.stringify(frame));
      chk(frame.tileW !== null && frame.tileW !== '0px', '[consolidated] the tiles keep their own border', JSON.stringify(frame));
      /* #3949: the white band bleeds only to the column. The projects rail beside it, at the height of Group by, keeps
         the page's ground: the column's scroll box is what contains the bleed, and nothing else would. */
      {
        const cg = await page.evaluate(() => { const rail = document.getElementById('rail-projects-tasks').closest('aside, nav, section, div[class*="rail"]') || document.getElementById('rail-projects-tasks').parentElement;
          const r = rail.getBoundingClientRect(); const u = document.getElementById('tsk-under').getBoundingClientRect();
          const probe = (v) => { const e = document.createElement('i'); e.style.color = v; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c.match(/\d+/g).slice(0, 3).map(Number); };
          return { x: Math.round(r.right - 6), y: Math.round(u.top + u.height / 2), railRight: Math.round(r.right), colLeft: Math.round(document.getElementById('panel-tasks').getBoundingClientRect().left),
            surface: probe('var(--k-surface)'), bg: probe('var(--k-bg)') }; });
        const b64 = (await page.screenshot({ clip: { x: cg.x, y: cg.y, width: 1, height: 1 } })).toString('base64');
        const railPx = await page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas');
          c.width = 1; c.height = 1; const x2 = c.getContext('2d'); x2.drawImage(i, 0, 0); ok([...x2.getImageData(0, 0, 1, 1).data].slice(0, 3)); };
          i.src = 'data:image/png;base64,' + src; }), b64);
        const near = (p, q) => p.every((v, k) => Math.abs(v - q[k]) <= 2);
        chk(cg.railRight <= cg.colLeft && !near(railPx, cg.surface), '[consolidated] the white band stays in the column: the rail beside it is not painted', JSON.stringify({ cg, railPx }));
        /* And the bands themselves in the column: ground behind the tiles, surface at Group by, a shaded card. */
        const readAt = async (x, y) => { const b = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64');
          return page.evaluate((src) => new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas');
            c.width = 1; c.height = 1; const x2 = c.getContext('2d'); x2.drawImage(i, 0, 0); ok([...x2.getImageData(0, 0, 1, 1).data].slice(0, 3)); };
            i.src = 'data:image/png;base64,' + src; }), b); };
        const cp = await page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const col = r('#panel-tasks');
          const tiles = r('#tsk-tiles'); const under = r('#tsk-under'); const list = r('#tsk-groups .tsk-list');
          return { x: Math.round(col.left + 4), bandY: Math.round(tiles.bottom + 6), belowY: Math.round(under.top + under.height / 2), lx: Math.round(list.left + 6), ly: Math.round(list.top + 6) }; });
        const colPx = { band: await readAt(cp.x, cp.bandY), below: await readAt(cp.x, cp.belowY), card: await readAt(cp.lx, cp.ly) };
        chk(near(colPx.band, cg.bg) && near(colPx.below, cg.surface) && near(colPx.card, cg.bg),
          '[consolidated] in the column: the ground under the tiles, the surface from Group by, the cards shaded', JSON.stringify({ cp, colPx, bg: cg.bg, surface: cg.surface }));
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tasks-from-consolidated.png'), fullPage: false });
      /* From consolidated Kosmos+ settings, Tasks takes the Plus chrome down (#3599's rule). */
      const plus = await page.evaluate(() => {
        if (typeof openConsolidatedSettings !== 'function') return { skipped: true };
        SETTINGS_SEC = 'plus';
        openConsolidatedSettings();
        const up = document.body.classList.contains('plus-active');
        openConsolidatedTasks();
        return { up, after: document.body.classList.contains('plus-active') };
      });
      chk(!plus.skipped && plus.after === false, '[consolidated] Tasks from Kosmos+ settings takes the blue down', JSON.stringify(plus));
      /* Opening a project from the consolidated rail replaces the Tasks view. */
      await page.click('#pj-list [data-project="' + launch.id + '"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => ({ tasksHidden: document.getElementById('panel-tasks').hidden }));
      chk(after.tasksHidden, '[consolidated] opening a project replaces the Tasks view', JSON.stringify(after));
    }
    await page.close();
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
