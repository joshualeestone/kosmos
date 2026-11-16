// Browser-check-surface: st-pjattn-tile pj-attn-exit filter-pjattn data-attn pjNeedsPerson
'use strict';
/* kosmos#8592 (a tester through Josh, 2026-11-16): on the Projects tab, "1 Issue" did nothing when clicked. It is now
 * a control, as the Agents tab's Issue tile is (#3423):
 *   - one project needs the person: the tile opens that project, the same as clicking its card;
 *   - several: it filters the list to just those (a second click, or "View all projects", shows all again);
 *   - none left while the filter is on: the filter turns itself off (the tile hides, so nothing could turn it off).
 *
 * This drives the shipped page with projects seeded in the page and the projects read stubbed, so a poll repaints
 * the same rows. Each assertion has a control that can come out the other way:
 *   1. the marker: data-attn on exactly the rows the tile counts (a red Issue, a held-for-you task, a sub-project),
 *      never on an idle one; and the tile's count equals the marked rows.
 *   2. several: a click turns body.filter-pjattn on with aria-pressed=true; only the marked rows are displayed (the
 *      idle rows are display:none, measured, not assumed); the exit link shows; the sub-project is laid flat with its
 *      parent chip; a second click shows every row again (control: before the click every row is displayed).
 *   3. "View all projects" clears it the same way.
 *   4. one: a click opens that project (PJ_CURRENT and the detail panel), and turns no filter on.
 *   5. none: with the filter on, a paint with no project needing the person turns the filter off.
 *   6. keyboard: Enter on the tile does what a click does.
 *   7. control on the Agents tab: its Issue tile still toggles body.filter-attn and leaves filter-pjattn alone.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-pj-issue-tile-8592.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };
const check = (cond, n, why) => (cond ? ok(n) : bad(n, why));

const SEVERAL = [
  { id: 'red', name: 'Red Issue', archived: false, agents: [], summary: { total: 1, needsYou: 1 } },
  { id: 'held', name: 'Held Task', archived: false, agents: [], summary: { total: 1, heldForYou: 1 } },
  { id: 'calm', name: 'Calm Parent', archived: false, agents: [], summary: { total: 1, working: 1 } },
  { id: 'kid', name: 'Kid Needs You', parent: 'calm', archived: false, agents: [], summary: { total: 1, needsYou: 1 } },
  { id: 'idle', name: 'Idle One', archived: false, agents: [], summary: { total: 0 } },
];
const ONE = [
  { id: 'solo', name: 'Solo Issue', archived: false, agents: [], summary: { total: 1, needsYou: 1 } },
  { id: 'idle', name: 'Idle One', archived: false, agents: [], summary: { total: 0 } },
];
const NONE = [{ id: 'idle', name: 'Idle One', archived: false, agents: [], summary: { total: 0 } }];

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjit-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    // The projects read answers with whatever the test has seeded, so a background poll repaints the same rows.
    await p.route('**/api/projects', (route) => p.evaluate(() => window.__seed || []).then((rows) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: rows }) })));
    await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));   // past the guided setup, which this does not walk
    await p.goto('http://127.0.0.1:' + PORT + '/#projects', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof window.paintProjects === 'function' && typeof window.pjAttnTileClick === 'function', { timeout: 10000 });

    const seed = (rows, layout) => p.evaluate(([r, lay]) => {
      window.__seed = r;
      PROJECTS = JSON.parse(JSON.stringify(r));
      PJ_CURRENT = null; PJ_AGENTS_UNREADABLE = false; PJ_LOADED_ONCE = true;
      showTab('projects'); layoutApply('projects', lay || 'roadmap'); pjView('list');
      paintProjects();
    }, [rows, layout]);
    const state = () => p.evaluate(() => {
      const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
      const rows = [...document.querySelectorAll('#pj-list .pj-row[data-project]')];
      const kid = document.querySelector('#pj-list .pj-row[data-project="kid"]');
      const chip = kid && kid.querySelector('.pj-parent');
      return {
        count: document.getElementById('st-pjattn').textContent,
        tileHidden: document.getElementById('st-pjattn-tile').hidden,
        pressed: document.getElementById('st-pjattn-tile').getAttribute('aria-pressed'),
        title: document.getElementById('st-pjattn-tile').title,
        filter: document.body.classList.contains('filter-pjattn'),
        agentsFilter: document.body.classList.contains('filter-attn'),
        marked: rows.filter((r) => r.hasAttribute('data-attn')).map((r) => r.dataset.project).sort(),
        displayed: rows.filter(shown).map((r) => r.dataset.project).sort(),
        all: rows.map((r) => r.dataset.project).sort(),
        exitShown: shown(document.getElementById('pj-attn-exit')),
        kidIndent: kid ? parseFloat(getComputedStyle(kid).marginLeft) + parseFloat(getComputedStyle(kid).paddingLeft) : null,
        kidChip: shown(chip),
        current: PJ_CURRENT,
        detailShown: !document.getElementById('pj-detail') || !document.getElementById('pj-detail').hidden,
      };
    });

    // 1. the marker matches the tile's count.
    await seed(SEVERAL);
    let s = await state();
    check(JSON.stringify(s.marked) === JSON.stringify(['held', 'kid', 'red']), '1. data-attn on exactly the projects that need the person (red Issue, held task, sub-project)', JSON.stringify(s));
    check(s.count === '3' && !s.tileHidden, '1. the tile counts the same three', JSON.stringify(s));
    check(s.title === 'Show only projects that need you', '1. the tile says what a click does with several', s.title);
    check(!s.filter && s.displayed.length === s.all.length && s.all.length === 5, '2. control: before a click every row is displayed', JSON.stringify(s));
    const kidIndentBefore = s.kidIndent;

    // 2. several: filter on, then off.
    await p.click('#st-pjattn-tile');
    s = await state();
    check(s.filter && s.pressed === 'true', '2. a click turns the filter on (body class and aria-pressed)', JSON.stringify(s));
    check(JSON.stringify(s.displayed) === JSON.stringify(['held', 'kid', 'red']), '2. only the projects that need the person are displayed', JSON.stringify(s.displayed));
    check(s.exitShown, '2. "View all projects" shows while the filter is on', JSON.stringify(s));
    const topIndent = await p.evaluate(() => { const r = document.querySelector('#pj-list .pj-row[data-project="red"]'); return parseFloat(getComputedStyle(r).marginLeft) + parseFloat(getComputedStyle(r).paddingLeft); });
    check(kidIndentBefore > topIndent && s.kidIndent === topIndent, '2. the sub-project is laid flat, level with the top rows (it was indented before)', 'before ' + kidIndentBefore + ', after ' + s.kidIndent + ', top row ' + topIndent);
    check(s.kidChip, '2. the sub-project shows its parent chip while laid flat', JSON.stringify(s));
    if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'pj-issue-filter-8592.png') });
    check(!s.agentsFilter, '2. the Agents filter is untouched', JSON.stringify(s));
    check(s.title === 'Show all projects', '2. while pressed the tile says a click shows all', s.title);
    await p.click('#st-pjattn-tile');
    s = await state();
    check(!s.filter && s.pressed === 'false' && s.displayed.length === 5 && !s.exitShown, '2. a second click shows every project again', JSON.stringify(s));

    // 2a. a folded parent never hides a marked sub-project while the filter is on (review round 1). The filter is off here.
    await p.evaluate(() => { PJ_TREE_FOLDED.add('calm'); applyConsFold(); });
    s = await state();
    check(!s.displayed.includes('kid'), '2a. control: with "Calm Parent" folded and no filter, its sub-project is hidden', JSON.stringify(s.displayed));
    await p.click('#st-pjattn-tile');                       // on
    s = await state();
    check(JSON.stringify(s.displayed) === JSON.stringify(['held', 'kid', 'red']), '2a. with the parent folded, the filter still shows the marked sub-project', JSON.stringify(s.displayed));
    const folds = await p.evaluate(() => [...document.querySelectorAll('#pj-list .pjtreefold')].filter((c) => getComputedStyle(c).display !== 'none').length);
    check(folds === 0, '2a. no fold caret shows while the filter is on', String(folds));
    await p.evaluate(() => { const b = document.querySelector('[data-pj-collapse-all], #pj-rm-collapse'); if (b) b.click(); else { PJ_TREE_FOLDED.add('red'); PJ_TREE_FOLDED.add('held'); applyConsFold(); } });
    s = await state();
    check(JSON.stringify(s.displayed) === JSON.stringify(['held', 'kid', 'red']), '2a. collapsing while filtered hides none of the marked projects', JSON.stringify(s.displayed));
    const stripes = await p.evaluate(() => [...document.querySelectorAll('#pj-list .pj-row[data-project]')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.classList.contains('pj-stripe')));
    check(JSON.stringify(stripes) === JSON.stringify([false, true, false]), '2a. the shading alternates over the rows shown', JSON.stringify(stripes));
    await p.click('#st-pjattn-tile');                       // off
    await p.evaluate(() => { PJ_TREE_FOLDED.clear(); pjSaveFold(); applyConsFold(); });

    // 2c. the consolidated layout is never filtered (it has no tile to undo it; review round 1).
    await p.click('#st-pjattn-tile');                       // on
    const cons = await p.evaluate(() => {
      document.body.classList.add('consolidated');
      applyConsFold();
      const n = [...document.querySelectorAll('#pj-list .pj-row[data-project]')].filter((r) => getComputedStyle(r).display !== 'none').length;
      document.body.classList.remove('consolidated');
      applyConsFold();
      return n;
    });
    check(cons === 5, '2c. under the consolidated layout every project row shows even with the filter class on', String(cons));
    await p.click('#st-pjattn-tile');                       // off

    // 2b. the Grid layout filters the same way.
    await seed(SEVERAL, 'grid');
    await p.click('#st-pjattn-tile');
    s = await state();
    check(s.filter && JSON.stringify(s.displayed) === JSON.stringify(['held', 'kid', 'red']), '2b. Grid: only the projects that need the person are displayed', JSON.stringify(s.displayed));
    await p.click('#st-pjattn-tile');
    s = await state();
    check(!s.filter && s.displayed.length === 5, '2b. Grid: a second click shows every project again', JSON.stringify(s.displayed));
    await seed(SEVERAL);

    // 3. the exit link.
    await p.click('#st-pjattn-tile');
    await p.click('#pj-attn-exit');
    s = await state();
    check(!s.filter && s.pressed === 'false' && s.displayed.length === 5, '3. "View all projects" turns the filter off', JSON.stringify(s));

    // 5. none: a filter left on turns itself off when nothing needs the person.
    await p.click('#st-pjattn-tile');
    await seed(NONE);
    s = await state();
    check(s.tileHidden && !s.filter && s.pressed === 'false', '5. with nothing needing the person the tile hides and the filter is off', JSON.stringify(s));

    // 4. one: the click opens that project.
    await seed(ONE);
    s = await state();
    check(s.count === '1' && s.title === 'Open the project that needs you', '4. one project: the tile says it opens it', JSON.stringify(s));
    await p.click('#st-pjattn-tile');
    await p.waitForFunction(() => PJ_CURRENT === 'solo', { timeout: 3000 }).catch(() => {});
    s = await state();
    check(s.current === 'solo' && s.detailShown, '4. one project: a click opens it', JSON.stringify(s));
    check(!s.filter, '4. one project: no filter is turned on', JSON.stringify(s));

    // 6. keyboard, on several.
    await seed(SEVERAL);
    await p.focus('#st-pjattn-tile');
    await p.keyboard.press('Enter');
    s = await state();
    check(s.filter && s.pressed === 'true', '6. Enter on the tile turns the filter on, as a click does', JSON.stringify(s));
    await p.keyboard.press('Enter');
    s = await state();
    check(!s.filter, '6. Enter again turns it off', JSON.stringify(s));

    // 7. control: the Agents tab's Issue tile is unchanged.
    const ag = await p.evaluate(() => {
      showTab('agents');
      const t = document.getElementById('st-attn-tile');
      t.hidden = false;
      t.click();
      const on = document.body.classList.contains('filter-attn');
      const pj = document.body.classList.contains('filter-pjattn');
      t.click();
      return { on, pj, off: !document.body.classList.contains('filter-attn') };
    });
    check(ag.on && ag.off && !ag.pj, '7. control: the Agents Issue tile still toggles its own filter only', JSON.stringify(ag));

    check(errs.length === 0, 'no page errors', errs.join(' | '));
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 27) { console.log('pj-issue-tile: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  console.log(failures ? failures + ' FAILED' : 'ALL PASS (' + ran + ')');
  process.exit(failures ? 1 : 0);
})();
