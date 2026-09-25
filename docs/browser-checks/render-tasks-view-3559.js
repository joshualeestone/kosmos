// Browser-check-surface: panel-tasks tsk-tiles tsk-groups tsk-search tsk-bulk rail-projects-tasks
'use strict';
/**
 * The Tasks view on a screen (#3559): the third top-level tab, every task on every project,
 * grouped by where the work is.
 *
 * What this pins, and why each line can fail:
 *  - the Tasks tab is in the top nav and opens #panel-tasks; in the consolidated view (tab bar
 *    hidden) the projects rail's Tasks button opens it,
 *  - the tiles are exactly the four groups the engine can prove, with the right counts, and
 *    NO "Waiting on you" / "Done, check it" / category appears anywhere (they are not guessed),
 *  - a row sits in the group its evidence says (the agent that named its task is In progress),
 *  - the search filters as you type (sentence, number, project, agent), and combines with the
 *    project rail,
 *  - Group by Project regroups the same rows,
 *  - ticking two rows and Close them closes both, with the note on each history,
 *  - no element in the view carries a coloured left border (Josh, 2026-09-24 12:52),
 *  - light, dark, a 760-wide and a 390-wide window (the rail becomes a dropdown, the search goes
 *    full width below it), with no sideways scroll.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-tasks-view-3559.js            # headed
 *   HEADED=0 node docs/browser-checks/render-tasks-view-3559.js   # headless
 */
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
  fleet.install([
    fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
    fleet.agent('rex', { state: 'idle', displayName: 'Rex', role: 'a writer' }),
  ]);
  const launch = projects.create({ name: 'Spring launch' });
  const news = projects.create({ name: 'Newsletter' });
  for (const [p, a] of [[launch, 'ada'], [launch, 'rex'], [news, 'rex']]) projects.addAgent(p.id, a, null);
  tasks.create(launch.id, { sentence: 'Book the podcast tour' });                 // 1 nobody
  tasks.create(launch.id, { sentence: 'Order proof copies', who: 'rex' });        // 2 assigned
  tasks.create(launch.id, { sentence: 'Pick the launch date', who: 'ada' });      // 3 working
  tasks.create(launch.id, { sentence: 'Old checklist', who: 'ada' });             // 4 closed
  tasks.close(launch.id, 4);
  tasks.create(news.id, { sentence: 'Clean up bounced addresses', who: 'rex' });  // 1 assigned
  tasks.create(news.id, { sentence: 'Welcome email for new subscribers' });       // 2 nobody
  commitments.report('ada', [{ what: 'working on task 3 of Spring launch' }]);
  const EXPECT = { nobody: 2, assigned: 2, working: 1, closed: 1 };

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const read = () => {
    const panel = document.getElementById('panel-tasks');
    const tiles = [...document.querySelectorAll('#tsk-tiles .tsk-tile')].map((t) => ({ k: t.dataset.tile, n: Number(t.querySelector('.num').textContent) }));
    const rows = [...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => ({
      text: r.querySelector('.tl').textContent,
      state: (r.querySelector('.tsk-state') || {}).textContent || '',
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
      bars,
      railShown: getComputedStyle(document.querySelector('.tsk-rail')).display !== 'none',
      /* On-screen boxes, not computed display: the dropdown's WRAPPER is what hides. */
      selShown: document.getElementById('tsk-projsel').getClientRects().length > 0,
      searchBelowSel: (() => {
        const a = document.getElementById('tsk-projsel').getBoundingClientRect();
        const q = document.getElementById('tsk-search').getBoundingClientRect();
        return a.height > 0 && q.top >= a.bottom;
      })(),
      searchW: Math.round(document.getElementById('tsk-search').getBoundingClientRect().width),
      mainW: Math.round(document.querySelector('.tsk-main').getBoundingClientRect().width),
    };
  };
  try {
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
      chk(JSON.stringify(a.tiles.map((t) => t.k)) === JSON.stringify(['nobody', 'assigned', 'working', 'closed']), `${tag} the tiles are exactly the four provable groups`, JSON.stringify(a.tiles));
      chk(a.tiles.every((t) => t.n === EXPECT[t.k]), `${tag} each tile counts its group`, JSON.stringify(a.tiles));
      chk(!/Waiting on you|Done, check it|Categor/i.test(a.text), `${tag} no unprovable group or category is drawn`);
      const date = a.rows.find((r) => r.text === 'Pick the launch date');
      chk(date && /In progress/.test(date.state), `${tag} the task its agent named is In progress`, JSON.stringify(date));
      const proof = a.rows.find((r) => r.text === 'Order proof copies');
      chk(proof && /Assigned, not started/.test(proof.state), `${tag} an assigned task its agent has not named is Assigned`, JSON.stringify(proof));
      chk(a.bars.length === 0, `${tag} no element carries a coloured left border`, JSON.stringify(a.bars.slice(0, 5)));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      chk(sideways <= 0, `${tag} no sideways scroll`, String(sideways));
      if (width < 1000) {
        chk(!a.railShown && a.selShown, `${tag} a narrow window folds the rail into a dropdown`, JSON.stringify({ rail: a.railShown, sel: a.selShown }));
        chk(a.searchBelowSel && a.searchW >= a.mainW - 40, `${tag} the search sits below the dropdown, full width (Mona a40bbe1)`, JSON.stringify({ below: a.searchBelowSel, w: a.searchW, main: a.mainW }));
      } else {
        chk(!a.selShown, `${tag} the dropdown is hidden while the rail shows`, JSON.stringify({ sel: a.selShown }));
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
        /* Search: by agent name, then by number, combined with the rail. */
        await page.fill('#tsk-search', 'rex');
        let rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(rows.length === 2 && rows.includes('Order proof copies') && rows.includes('Clean up bounced addresses'), `${tag} search finds tasks by agent name`, JSON.stringify(rows));
        await page.click('#tsk-projects .tsk-ritem[data-proj="' + news.id + '"]');
        rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(JSON.stringify(rows) === JSON.stringify(['Clean up bounced addresses']), `${tag} search combines with the project rail`, JSON.stringify(rows));
        await page.fill('#tsk-search', '');
        await page.click('#tsk-crumb [data-proj=""]');
        await page.fill('#tsk-search', 'podcast');
        rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
        chk(JSON.stringify(rows) === JSON.stringify(['Book the podcast tour']), `${tag} search finds a task by what it says`, JSON.stringify(rows));
        /* Its own clear button: shown with text, clears and hides again. */
        const clr = await page.evaluate(() => !document.getElementById('tsk-qclear').hidden);
        chk(clr, `${tag} the search's clear button shows once there is text`);
        await page.click('#tsk-qclear');
        const cleared = await page.evaluate(() => ({ v: document.getElementById('tsk-search').value, hidden: document.getElementById('tsk-qclear').hidden, rows: document.querySelectorAll('#tsk-groups .tsk-row').length }));
        chk(cleared.v === '' && cleared.hidden && cleared.rows > 1, `${tag} clear empties the search and brings the rows back`, JSON.stringify(cleared));
        /* No match says so, and what to do (Mona a40bbe1). */
        await page.fill('#tsk-search', 'zzz nothing like this');
        const none = await page.evaluate(() => document.getElementById('tsk-groups').textContent);
        chk(/No tasks match .zzz nothing like this.\. Try fewer words, or clear the search\./.test(none), `${tag} a search with no match says so`, none);
        await page.fill('#tsk-search', '');
        /* Group by Project regroups the same rows. */
        await page.click('#tsk-by [data-by="project"]');
        const heads = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-grp h3')].map((h) => h.firstChild.textContent));
        chk(JSON.stringify(heads) === JSON.stringify(['Newsletter', 'Spring launch']), `${tag} Group by Project shows one group per project`, JSON.stringify(heads));
        await page.click('#tsk-by [data-by="status"]');
        /* Bulk close two tasks with a note. */
        await page.check('#tsk-groups input[data-key="' + news.id + '#2"]');
        await page.check('#tsk-groups input[data-key="' + launch.id + '#1"]');
        const barShown = await page.evaluate(() => !document.getElementById('tsk-bulk').hidden);
        chk(barShown, `${tag} ticking rows brings up the Close bar`);
        await page.fill('#tsk-bnote', 'not doing these this season');
        await page.click('#tsk-bclose');
        await page.waitForFunction(() => /Closed 2 tasks/.test(document.getElementById('tsk-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        const msg = await page.evaluate(() => document.getElementById('tsk-msg').textContent);
        chk(/Closed 2 tasks/.test(msg), `${tag} Close them closes both and says so`, msg);
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
      await page.waitForFunction(() => !document.getElementById('panel-tasks').hidden && document.querySelectorAll('#tsk-tiles .tsk-tile').length === 4, null, { timeout: 8000 }).catch(() => {});
      const got = await page.evaluate(() => {
        const pt = document.getElementById('panel-tasks');
        return {
          shown: !pt.hidden && pt.getClientRects().length > 0,
          tiles: document.querySelectorAll('#tsk-tiles .tsk-tile').length,
          stillCons: document.body.classList.contains('consolidated'),
          inColumn: pt.parentElement && pt.parentElement.id === 'panel-projects',
          ownRailHidden: getComputedStyle(pt.querySelector('.tsk-rail')).display === 'none',
          dropdown: document.getElementById('tsk-projsel').getClientRects().length > 0,
        };
      });
      chk(got.shown && got.tiles === 4, '[consolidated] it opens the Tasks view', JSON.stringify(got));
      chk(got.stillCons && got.inColumn, '[consolidated] it stays in the consolidated view, in the display column (#2842)', JSON.stringify(got));
      chk(got.ownRailHidden && got.dropdown, '[consolidated] its own project rail folds to the dropdown beside the projects rail', JSON.stringify(got));
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
