// Browser-check-surface: panel-tasks tsk-tiles tsk-groups tsk-search tsk-bulk rail-projects-tasks
'use strict';
/**
 * The Tasks view on a screen (#3559): the third top-level tab, every task on every project,
 * grouped by where the work is.
 *
 * What this pins, and why each line can fail:
 *  - the Tasks tab and the consolidated rail's Tasks button are hidden below 25 tasks ever and
 *    shown once the saved flag is set (Josh's ruling); then the tab opens #panel-tasks, and in
 *    the consolidated view (tab bar hidden) the rail button opens it,
 *  - #3949 (Josh, 2026-09-26): five single-label tiles in his order (Needs Your Decision, red; In
 *    progress; Assigned but not started; Unassigned; Completed), with the right counts and no byline;
 *    Completed also stays the folded list; NO "Built but waiting" (#3951), "Done, check it" or
 *    category is drawn (they are not guessed). Needs Your Decision's task is a real one: its agent
 *    (Max) reports a question about its project, and the pane is asking,
 *  - #3949 layout: no left Projects column; search about half the width with the open-task count to
 *    its right; Project and Created: dropdowns on one row; Group by and Sort dropdowns under the
 *    tiles; no tile hint,
 *  - a row sits in the group its evidence says (the agent that named its task is In progress),
 *  - the search filters as you type (sentence, number, project, agent), and combines with the
 *    project dropdown,
 *  - Group by Project regroups the same rows,
 *  - ticking two rows and Close them closes both, with the note on each history,
 *  - no element in the view carries a coloured left border (Josh, 2026-09-24 12:52),
 *  - light, dark, a 760-wide and a 390-wide window (the search goes full width), with no sideways
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
  commitments.report('ada', [{ what: 'working on task 3 of Spring launch' }]);
  // An ARCHIVED project's task must not appear anywhere in the view.
  const old = projects.create({ name: 'Old catalog' });
  tasks.create(old.id, { sentence: 'Archived away task' });
  projects.setArchived(old.id, true);
  const EXPECT = { decision: 1, working: 1, assigned: 2, nobody: 2, closed: 1 };

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
      /* #3949 positions: the count beside the search; Project and Created: on one row above the tiles;
         Group by and Sort on one row under them. */
      subRightOfSearch: rect('tsk-sub').left >= rect('tsk-search').right - 1 && Math.abs(rect('tsk-sub').top - rect('tsk-search').top) < 30,
      filtersAbove: rect('tsk-win').bottom <= rect('tsk-tiles').top && rect('tsk-projsel').bottom <= rect('tsk-tiles').top,
      filtersRow: Math.abs(rect('tsk-projsel').top - rect('tsk-win').top) < 4,
      underBelow: rect('tsk-by').top >= rect('tsk-tiles').bottom && rect('tsk-sort').top >= rect('tsk-tiles').bottom,
      underRow: Math.abs(rect('tsk-by').top - rect('tsk-sort').top) < 4,
      createdLabel: (document.querySelector('label[for="tsk-win"]') || {}).textContent || '',
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
      /* #3880's control: the tab view KEEPS its outer frame (Josh scoped #3880 to the consolidated
         view); only the column drops it (asserted below), so a rule that removed it everywhere fails here. */
      const tabFrame = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#panel-tasks .tsk-view')); return { w: cs.borderTopWidth, r: cs.borderTopLeftRadius }; });
      chk(tabFrame.w === '1px' && tabFrame.r === '14px', `${tag} the tab view keeps its outer frame (#3880 is the consolidated view only)`, JSON.stringify(tabFrame));
      /* #3949 (Josh): five single-label tiles in his order; Completed is a tile and still the fold below. */
      chk(JSON.stringify(a.tiles.map((t) => t.k)) === JSON.stringify(['decision', 'working', 'assigned', 'nobody', 'closed']), `${tag} the tiles are the five provable groups in Josh's order`, JSON.stringify(a.tiles.map((t) => t.k)));
      chk(JSON.stringify(a.tiles.map((t) => t.label)) === JSON.stringify(['Needs Your Decision', 'In progress', 'Assigned but not started', 'Unassigned', 'Completed']), `${tag} each tile is one label`, JSON.stringify(a.tiles.map((t) => t.label)));
      chk(a.tiles.every((t) => t.bylines === 0), `${tag} no tile carries a byline`);
      chk(a.tiles[0].color === a.danger && a.tiles.slice(1).every((t) => t.color !== a.danger), `${tag} Needs Your Decision, and only it, is red`, JSON.stringify(a.tiles.map((t) => t.color).concat(a.danger)));
      chk(a.fold, `${tag} Completed stays the folded list`);
      chk(a.foldCount === EXPECT.closed, `${tag} the Completed fold counts the closed tasks`, JSON.stringify({ fold: a.foldCount, expect: EXPECT.closed }));
      chk(!a.rail && a.selShown, `${tag} no left Projects column; the project dropdown is there`, JSON.stringify({ rail: a.rail, sel: a.selShown }));
      chk(!a.hint, `${tag} the tile hint is gone`);
      /* On a phone-width window each pair may wrap onto two lines; above it they share one (Josh: "the same line"). */
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
      chk(!/Waiting on you|Built but waiting|Done, check it|Categor/i.test(a.text), `${tag} no unprovable group or category is drawn`);
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
      if (width <= 760) {
        chk(a.searchW >= a.mainW - 60, `${tag} a narrow window gives the search the full width`, JSON.stringify({ w: a.searchW, main: a.mainW }));
      } else {
        /* #3949 (Josh): about half as wide, with the count to its right. */
        chk(a.searchW >= a.mainW * 0.4 && a.searchW <= a.mainW * 0.6, `${tag} the search is about half the width`, JSON.stringify({ w: a.searchW, main: a.mainW }));
        chk(a.subRightOfSearch, `${tag} the open-task count sits to the right of the search`);
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
        chk(rows.length === 2 && rows.includes('Order proof copies') && rows.includes('Clean up bounced addresses'), `${tag} search finds tasks by agent name`, JSON.stringify(rows));
        await page.selectOption('#tsk-projsel', news.id);
        rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(JSON.stringify(rows) === JSON.stringify(['Clean up bounced addresses']), `${tag} search combines with the project dropdown`, JSON.stringify(rows));
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
          return { n: Number(t.querySelector('.num').textContent), red: getComputedStyle(t.querySelector('.num')).color === danger };
        });
        chk(zero.n === 0 && !zero.red, `${tag} a zero Needs Your Decision is not red`, JSON.stringify(zero));
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
        await page.selectOption('#tsk-by', 'status');
        /* Bulk close two tasks with a note. */
        await page.check('#tsk-groups input[data-key="' + news.id + '#2"]');
        await page.check('#tsk-groups input[data-key="' + launch.id + '#1"]');
        const barShown = await page.evaluate(() => !document.getElementById('tsk-bulk').hidden);
        chk(barShown, `${tag} ticking rows brings up the Close bar`);
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
      chk(got.shown && got.tiles === 5, '[consolidated] it opens the Tasks view', JSON.stringify(got));
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
