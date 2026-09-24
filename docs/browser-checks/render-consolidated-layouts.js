'use strict';

/**
 * The consolidated view under each Agents layout: no org chart over the rails, and an empty centre that says what to press (#774).
 *
 * 🔑 THE BUG WAS STATE CARRIED IN FROM ANOTHER SCREEN. Josh: "depending on what
 * I left my agents on affects how the consolidated view renders." The org chart
 * is a tab-view layout, and with the Agents page last left on it, the chart
 * painted full-width above the rails. A rendered check is the only kind that
 * can see that: the markup is the same in all three cases.
 *
 * Also here: with nothing open the centre is not blank. It says what to press,
 * and says it differently when the projects rail is folded, because a blank
 * centre with both rails folded read as "I have no way to get back".
 *
 *   node docs/browser-checks/render-consolidated-layouts.js <url> <sandbox-root>
 *
 * Seeds one project of its own to open, inside the sandbox, and PROVES the
 * server writes there before it touches anything (the seed lands in
 * <sandbox>/data/Kosmos/projects.json or the check refuses). Puts the
 * board's saved layout back to what it was, and removes the seeded folder.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
(async () => {
  /* #1156: this check POSTs to whatever BASE it is given, so it declines
     rather than mutating a board that is not a fixture. */
  require('./lib-sandbox-guard.js').requireSandbox('render-consolidated-layouts.js');
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const SANDBOX = process.argv[3] || '';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  const style = (layout) => pg.evaluate((l) => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: l }) }).then((r) => r.text()), layout);
  /* null means hidden; a selector that matches nothing is 'missing', so an
     absence line cannot pass on a page that has lost the element. */
  const rect = (sel) => pg.$eval(sel, (el) => { if (el.hidden || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }).catch(() => 'missing');
  const up = (sel) => pg.$eval(sel, (el) => !(el.hidden || getComputedStyle(el).display === 'none')).catch(() => false);
  /* The state, not a timer: the layout arrives by paintStyles -> applyLayout ->
     showTab after the page loads, and a slow fixture would make a fixed wait
     flaky. A short settle after it lands lets the rails finish their first paint. */
  const settled = async (cons) => { await pg.waitForFunction((c) => document.body.classList.contains('consolidated') === c, cons, { timeout: 15000 }); await pg.waitForTimeout(300); };
  const none = () => pg.$eval('#pj-none', (e) => (e.hidden ? null : e.textContent)).catch(() => '(no #pj-none on the page)');
  /* #867 (Josh, 2026-08-25 11:02): a project now auto-opens on the first
     consolidated load (this check always has one seeded), so "nothing
     is open" is no longer this page's own starting state -- it is a
     state a person REACHES (closing what auto-opened, or the projects
     genuinely running out), and this check still has to prove Kosmos
     renders it correctly when reached. Forces exactly that state via
     the same PROJECTS/flags reset `paintAs` below already uses, rather
     than a real click: in the consolidated view the list is the rail
     beside the open project, so there is no real click that reaches the
     "nothing is open" state from here. */
  /* ⚠️ pjMarkOpen(null) IS PART OF REACHING THIS STATE, not decoration. #980
     gave the rail a persistent open marker (class + aria-current), and every
     real route out of a project clears it: the projects-tab re-click calls
     pjMarkOpen(null). Resetting PJ_CURRENT alone left the
     previously-open row still lit and still aria-current="true", so this
     check screenshotted a "nothing is open" state with one project marked
     open -- a combination no person can reach, pinned as if it were correct.
     🔑 A forced state has to force EVERY write the real route performs, or
     the check certifies a screen that does not exist. */
  const forceNothingOpen = () => pg.evaluate(() => { PJ_CURRENT = null; pjView('list'); pjMarkOpen(null); paintPjNone(); });

  let seedFolder = '';
  let savedLayout = 'tabs';
  try {
  await pg.goto(URL + '/?tab=projects', { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  /* This check writes to the board it is pointed at (a project, the saved
     layout). It seeds one project of its own to open and, like
     render-projects, proves the record landed inside the sandbox it was
     handed before it goes on; pointed at a person's own Kosmos it refuses. */
  if (!SANDBOX) throw new Error('pass the server\'s sandbox root as the 2nd argument; this check adds a project and rewrites the saved layout on the server it is pointed at');
  seedFolder = fs.mkdtempSync(path.join(SANDBOX, 'cons-774-seed-'));
  const made = await pg.evaluate((f) => fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Consolidated check', folder: f }) }).then((r) => r.status), seedFolder);
  say(made >= 200 && made < 300, 'seeded one project for the check', String(made));
  const store = path.join(SANDBOX, 'data', 'Kosmos', 'projects.json');
  if (!fs.existsSync(store) || !fs.readFileSync(store, 'utf8').includes('Consolidated check')) {
    throw new Error('the server at ' + URL + ' did not write the seed to ' + store + ': it is NOT running against the sandbox passed. Refusing to touch it.');
  }
  savedLayout = await pg.evaluate(() => fetch('/api/style').then((r) => r.json()).then((j) => (j && j.layout) || 'tabs').catch(() => 'tabs'));
  await style('consolidated');

  for (const lay of ['grid', 'list', 'org']) {
    for (const tab of ['agents', 'projects']) {
      await pg.goto(URL + '/?tab=' + tab, { waitUntil: 'networkidle' });
      await pg.evaluate((l) => { localStorage.setItem('kosmos.layout.agents', l); sessionStorage.removeItem('rail-fold-a'); sessionStorage.removeItem('rail-fold-p'); }, lay);
      await pg.reload({ waitUntil: 'networkidle' });
      await settled(true);
      await forceNothingOpen();
      const tag = 'agents left on ' + lay + ', arriving on ' + tab;
      say(await pg.evaluate(() => document.body.classList.contains('consolidated')), tag + ': the consolidated view is up');
      say((await rect('#orgview')) === null, tag + ': the org chart is not painted');
      say((await rect('#grid')) === null, tag + ': the grid is not painted');
      const list = await rect('#alist'); const rail = await rect('#pj-list-view');
      say(!!list && !!rail, tag + ': the agents rail and the projects rail are both up', JSON.stringify({ list, rail }));
      /* The two rails start within their own padding of each other (measured
         8px apart on a correct page: the projects rail carries its 8px inset).
         The sentence taking grid row 1 pushed the projects rail down 273px in
         the first cut, so 12px is the whole tolerance and deleting its
         grid-row rule fails this line. Geometry, run headless: the runner's
         caveat is about PAINT (compositor, scroll, screenshots); grid
         placement is layout, which headless computes the same way, and this
         line measures placement only. */
      const ra = await rect('#rail-agents'); const rp = await rect('#rail-projects');
      say(!!ra && !!rp && Math.abs(ra.y - rp.y) <= 12, tag + ': the two rails start at the same height', ra && rp ? ra.y + ' vs ' + rp.y : JSON.stringify({ ra, rp }));
      const said = await none();
      say(!!said && /Open or create a project to get started/.test(said), tag + ': the empty centre says what to press', JSON.stringify(said));
    }
  }

  // #3126 (Josh, 6.68): the projects column is no longer collapsible - there is no
  // projects-fold control and no "projects list is folded" sentence. Folding the
  // AGENTS rail alone does not change the projects centre sentence.
  await forceNothingOpen();
  say((await pg.$('#rail-projects-fold')) === null, 'the projects fold control is gone (#3126)');
  await pg.click('#rail-agents-fold'); await pg.waitForTimeout(300);
  say(/Open or create a project to get started/.test((await none()) || ''), 'agents rail folded: the projects centre sentence is unchanged');
  await pg.click('#rail-agents-fold'); await pg.waitForTimeout(300);
  say(/Open or create a project to get started/.test((await none()) || ''), 'agents rail open again: still the plain sentence');

  // the New project form open: the sentence is not painted over it by a fold press
  await pg.click('#rail-projects-new'); await pg.waitForTimeout(400);
  await pg.click('#rail-agents-fold'); await pg.waitForTimeout(300);
  say((await none()) === null, 'New project form open, then a fold press: the sentence stays hidden');
  // #pj-add-back (the "← All projects" control) is visibility:hidden in the
  // consolidated layout (index.html hides it under html[data-layout="consolidated"]),
  // so clicking it hangs until Playwright's actionability timeout. Leave the New
  // project form the layout-independent way this file resets everywhere else:
  // forceNothingOpen() runs pjView('list') -- exactly what #pj-add-back's own
  // click handler calls -- so it returns to the list view without the hidden click.
  await pg.click('#rail-agents-fold'); await forceNothingOpen(); await pg.waitForTimeout(400);

  // #3597 (Josh, 0.6.91 QA): a board with no projects yet shows the centred sentence too
  // ("when there's no project available"); a failed read stays silent. #3126: the
  // projects column is no longer collapsible, so the folded variants (press + /
  // "folded; press ›") were removed - fold-p can never be set.
  const paintAs = (loaded, failed) => pg.evaluate(([l, f]) => {
    const keep = { P: PROJECTS, L: PJ_LOADED_ONCE, F: PJ_READ_FAILED };
    PROJECTS = []; PJ_LOADED_ONCE = l; PJ_READ_FAILED = f;
    paintPjNone('list');
    const el = document.getElementById('pj-none'); const t = el.hidden ? null : el.textContent;
    PROJECTS = keep.P; PJ_LOADED_ONCE = keep.L; PJ_READ_FAILED = keep.F; paintPjNone('list');
    return t;
  }, [loaded, failed]);
  say(/Open or create a project to get started/.test((await paintAs(true, false)) || ''), 'no projects yet: the centre says to open or create one (#3597)');
  say(/Open or create a project to get started/.test((await paintAs(false, false)) || ''), 'before the first read: never "No projects yet"');
  say((await paintAs(true, true)) === null, 'after a failed read, rail open: silence beside the rail\'s own message');

  // open a project: the sentence goes
  const first = await pg.$('#pj-list [data-project]'); // active rows only; the seed is active
  if (first) {
    await first.click(); await pg.waitForTimeout(700);
    say((await none()) === null, 'a project open: the sentence is gone');
    say(await up('#pj-one-view'), 'a project open: the project page is up');

    // #3218: the four fixed columns are ~16.6 / 16.6 / 50 / 16.6 of the viewport (Agents /
    // Projects / Conversation / right stack). Measured with a project open so all four are up.
    const cw = await pg.evaluate(() => document.documentElement.clientWidth);
    const rAgents = await rect('#alist'); const rProjects = await rect('#pj-list-view'); const rDialog = await rect('.pjmid');
    const pct = (r) => (r ? Math.round((r.w / cw) * 1000) / 10 : null);
    const fA = pct(rAgents), fP = pct(rProjects), fD = pct(rDialog);
    const fR = (fA !== null && fP !== null && fD !== null) ? Math.round((100 - fA - fP - fD) * 10) / 10 : null;
    say(fA !== null && Math.abs(fA - 16.6) <= 2, '#3218: Agents column ~16.6% of viewport', fA + '%');
    say(fP !== null && Math.abs(fP - 16.6) <= 2, '#3218: Projects column ~16.6% of viewport', fP + '%');
    say(fD !== null && Math.abs(fD - 50) <= 3, '#3218: Conversation column ~50% of viewport', fD + '%');
    say(fR !== null && Math.abs(fR - 16.6) <= 2.5, '#3218: right (Tasks/Files) column ~16.6% of viewport (residual)', fR + '%');

    // #3218 flex: folding the Agents column grows ONLY the dialog; Projects stays pinned.
    const dBefore = (await rect('.pjmid') || {}).w; const pBefore = (await rect('#pj-list-view') || {}).w;
    await pg.click('#rail-agents-fold'); await pg.waitForTimeout(320);
    const dAfter = (await rect('.pjmid') || {}).w; const pAfter = (await rect('#pj-list-view') || {}).w;
    await pg.click('#rail-agents-fold'); await pg.waitForTimeout(220);   // restore
    say(dAfter > dBefore + 20 && Math.abs(pAfter - pBefore) <= 2,
      '#3218: folding Agents grows ONLY the dialog (Projects pinned)', JSON.stringify({ dBefore, dAfter, pBefore, pAfter }));

    /* #3218 increment 3: the separate Members card is GONE from the consolidated view -- its agents
       moved to the top of the Agents list. This is a deletion, so it ships with an absence assertion.
       rect() returns null for an element that EXISTS but is display:none, and the string 'missing'
       when the selector matches nothing at all -- so `=== null` is a positive control in one line:
       it passes only when the card is still in the DOM (the tab view needs it) AND hidden here. A
       markup deletion would read 'missing' and fail; a broken hide would read a rect and fail. */
    const membersRect = await rect('.pjcard-members');
    say(membersRect === null, '#3218: the Members card is in the DOM but hidden in the consolidated view', JSON.stringify(membersRect));

    /* #3218 increment 4: with Members gone the right column is Tasks (top) over Files (bottom), 50/50.
       Both fill their 1fr track by construction, so the heights are ~equal even with empty lists. */
    const rTasks = await rect('.pj3 > aside.pjcol:not(.pjsplit)');
    const rFiles = await rect('.pj3 > .pjsplit > .pjcard-files');
    const okRects = rTasks && rFiles && typeof rTasks === 'object' && typeof rFiles === 'object' && rTasks.h > 40 && rFiles.h > 40;
    const skew = okRects ? Math.abs(rTasks.h - rFiles.h) / Math.max(rTasks.h, rFiles.h) : null;
    say(skew !== null && skew <= 0.15, '#3218: Tasks and Files split the right column ~50/50',
      JSON.stringify({ tasks: okRects ? rTasks.h : rTasks, files: okRects ? rFiles.h : rFiles, skew }));

    /* #3218 increment 5: View All rides the section HEADER, pinned top-right and always visible,
       instead of sitting under the list. The controls are `hidden` until the runtime has an overflow
       to reveal, so force them visible and measure each against its own card: a small gap from the
       card's top and right edge means it is in the header row at the far right. */
    const va = await pg.evaluate(() => {
      const out = {};
      const test = (cardSel, btnSel, key) => {
        const card = document.querySelector(cardSel); const btn = document.querySelector(btnSel);
        if (!card || !btn) { out[key] = 'missing'; return; }
        btn.hidden = false; if (!btn.textContent) btn.textContent = 'View All';
        const c = card.getBoundingClientRect(); const r = btn.getBoundingClientRect();
        out[key] = { topGap: Math.round(r.top - c.top), rightGap: Math.round(c.right - r.right) };
      };
      test('#pj-tasks-field', '#pj-alltasks', 'tasks');
      test('.pjcard-files', '#pj-docs-all', 'files');
      return out;
    });
    const headerTR = (o) => o && typeof o === 'object' && o.topGap >= -2 && o.topGap <= 44 && o.rightGap >= -2 && o.rightGap <= 44;
    say(headerTR(va.tasks), '#3218: Tasks View All sits in the header, top-right', JSON.stringify(va.tasks));
    say(headerTR(va.files), '#3218: Files View All sits in the header, top-right', JSON.stringify(va.files));

    /* #3304 (Josh 2026-09-19): the Tasks header reordered to TASKS | View All | +, so the + now
       sits to the RIGHT of the View All door (was to its left). Measured live, not from CSS text. */
    const tOrder = await pg.evaluate(() => {
      const va = document.querySelector('#pj-alltasks'); const plus = document.querySelector('#pj-newtask');
      if (!va || !plus) return 'missing';
      va.hidden = false; if (!va.textContent) va.textContent = 'View All';
      const v = va.getBoundingClientRect(); const p = plus.getBoundingClientRect();
      return { plusRightOfViewAll: p.left >= v.right - 2, plusLeft: Math.round(p.left), vaRight: Math.round(v.right) };
    });
    say(tOrder && tOrder.plusRightOfViewAll === true, '#3304: the Tasks + sits to the right of View All', JSON.stringify(tOrder));

    /* #3308 (Josh 2026-09-19): the agents rail and the tasks/files column sit on the TOP-HEADER
       ground (--k-bg), not the old --k-side tone. Compared as a computed color against .apphead so
       a token rename that moved either apart from the header goes red here. */
    const grounds = await pg.evaluate(() => {
      const head = getComputedStyle(document.querySelector('.apphead')).backgroundColor;
      const rail = document.querySelector('#rail-agents'); const pj3 = document.querySelector('.pj3');
      return { head, rail: rail ? getComputedStyle(rail).backgroundColor : 'missing', pj3: pj3 ? getComputedStyle(pj3).backgroundColor : 'missing' };
    });
    say(grounds.rail === grounds.head && grounds.pj3 === grounds.head, '#3308: the agents rail + tasks/files column use the top-header ground', JSON.stringify(grounds));

    /* #3218 increment 2 / #3387: the open project's agents sort to the TOP of the single Agents list,
       then an "Other Agents" sub-header (was a plain rule), then the rest. Drive paintAgentList
       directly with a known roster + board sample so the ordering is deterministic without live tmux.
       running:false rows render from record fields only (the branch lrow keeps for a stopped agent),
       so the fixture cannot take a field-hungry path. */
    const grouping = await pg.evaluate(() => {
      const proj = pjById(PJ_CURRENT);
      proj.agents = [{ sessionName: 'mem-1' }, { sessionName: 'mem-2' }];
      const mk = (s) => ({ sessionName: s, name: s, role: '', running: false, state: 'stopped', context: null });
      LAST = [mk('out-a'), mk('mem-1'), mk('out-b'), mk('mem-2')];
      paintAgentList();
      const kids = [...document.getElementById('alist').children];
      const hdrs = kids.filter((k) => k.classList && k.classList.contains('alist-grouphdr'));
      const hdrAt = kids.findIndex((k) => k.classList && k.classList.contains('alist-grouphdr'));
      const hdr = hdrs[0] || null;
      return {
        total: kids.length, hdrCount: hdrs.length, hdrAt,
        hdrLabel: hdr ? (hdr.querySelector('.railname') || {}).textContent : null,
        hdrHasPlus: !!(hdr && hdr.querySelector('.alist-newagent')),
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
      };
    });
    // 4 rows + 1 sub-header; the two project members are the two rows above it (index 0,1), the
    // "Other Agents" header is at index 2, the two non-members below it. The top rail head reads
    // "Project Members" while grouped.
    say(grouping.hdrCount === 1 && grouping.hdrAt === 2 && grouping.total === 5
        && grouping.hdrLabel === 'Other Agents' && grouping.hdrHasPlus === true
        && grouping.railName === 'Project Members',
      '#3387: the Agents list groups Project Members first, then an "Other Agents" sub-header, then the rest', JSON.stringify(grouping));

    // negative control: no project open -> a flat list with no sub-header, and the head back to
    // "Agents" (proves the grouping + rename are conditional).
    const flat = await pg.evaluate(() => {
      PJ_CURRENT = null;
      const mk = (s) => ({ sessionName: s, name: s, role: '', running: false, state: 'stopped', context: null });
      LAST = [mk('x'), mk('y')];
      paintAgentList();
      return {
        hdrs: [...document.getElementById('alist').children].filter((k) => k.classList && k.classList.contains('alist-grouphdr')).length,
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
      };
    });
    say(flat.hdrs === 0 && flat.railName === 'Agents', '#3387: with no project open the Agents list is flat and the head reads "Agents"', JSON.stringify(flat));

    // #3218: paintAgentList() keeps the empty-board fallback -- with no agents it draws boardEmpty(),
    // not a blank list. Drive LAST=[] through it (the pre-first-poll / removed-last-agent shape) and
    // assert the empty-state markup, no rows, no sub-header. This is the runtime execution coverage
    // the node source-regex test cannot give.
    const emptyBoard = await pg.evaluate(() => {
      LAST = [];
      paintAgentList();
      const al = document.getElementById('alist');
      return { hasEmpty: !!al.querySelector('.pj-empty'), hasRows: !!al.querySelector('.lrow'), hasHdr: !!al.querySelector('.alist-grouphdr') };
    });
    say(emptyBoard.hasEmpty && !emptyBoard.hasRows && !emptyBoard.hasHdr,
      '#3218: paintAgentList with no agents draws the empty board, not a blank list', JSON.stringify(emptyBoard));
  } else {
    say(false, 'the board has a project to open (this check needs one)');
  }

  // the tab view keeps the person's org chart and never shows the sentence
  await style('tabs');
  await pg.goto(URL + '/?tab=agents', { waitUntil: 'networkidle' }); await settled(false);
  say(!(await pg.evaluate(() => document.body.classList.contains('consolidated'))), 'tabs: the consolidated view is down');
  say(await up('#orgview'), 'tabs, agents left on org: the org chart is painted');
  say((await none()) === null, 'tabs: the sentence is never shown');
  // positive control for the grid absence lines above: the grid does paint when asked for
  await pg.evaluate(() => localStorage.setItem('kosmos.layout.agents', 'grid'));
  await pg.reload({ waitUntil: 'networkidle' }); await settled(false);
  say(await up('#grid'), 'tabs, agents left on grid: the grid is painted (control)');
  // leaving the consolidated view without a reload (the resize handler's path): the chart comes back
  await pg.evaluate(() => localStorage.setItem('kosmos.layout.agents', 'org'));
  await style('consolidated'); await pg.reload({ waitUntil: 'networkidle' }); await settled(true);
  say((await rect('#orgview')) === null, 'back in the consolidated view: the chart is hidden again');
  await pg.evaluate(() => { document.documentElement.setAttribute('data-layout', 'tabs'); showTab('agents'); });
  await pg.waitForTimeout(300);
  say(await up('#orgview'), 'to tabs without a reload: the chart is painted again on the same tick');
  } finally {
    /* Whatever happened, the board's saved layout goes back to what it was,
       the seeded folder goes, and the browser closes; a selector timeout must
       not leave the next check on a consolidated board. The seeded record
       dies with the sandbox. */
    try { await style(savedLayout); } catch { /* the server may be gone */ }
    if (seedFolder) { try { fs.rmSync(seedFolder, { recursive: true, force: true }); } catch { /* fine */ } }
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
