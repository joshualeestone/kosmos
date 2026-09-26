/* #1382 + #3703: the project View-all door, in a real browser.
 *
 * Josh (#1382): "for tasks, i want to see a view of them in a list form basically". Since #3703
 * the door opens the Tasks view (#3559) scoped to its project: ONE list screen (Mona's mock). The
 * old all-tasks screen is retired, and what it guaranteed is measured here on the new destination:
 *   - the door is offered, reads "View All", carries no count (#1346's second number);
 *   - it lands on Tasks scoped to THIS project: its title, its rail item, only its rows, and its
 *     finished work reachable (Created: All, the Completed fold) (#2498; #3949 renamed both);
 *   - #1346: the sub-line's open count equals the open rows ON SCREEN, counted inside the view;
 *   - "+ New task" there files to the picked project, or asks which project on All tasks;
 *   - an ARCHIVED project's own door still lists its tasks, and All tasks sets them aside again;
 *   - the consolidated layout opens it in the display column; 390 wide scrolls nothing sideways.
 * The #2762 member-face arm stays: it measures the project column, which is unchanged.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-alltasks.js
 */
// Browser-check-surface: pj-alltasks tkFace tsk-crumb tsk-new nt-projrow nt-proj
// ⚠️ `tkFace` here fires only when a line CONTAINING that literal changes (a
// signature or a call site). The gate keeps `+`/`-` diff-body lines and not context,
// so an edit to the function BODY -- which is where #2762 lived -- does not trip it.
// Measured. Keep the token, do not read it as covering the body.
// (#2518) the distinctive web/index.html tokens this check asserts, so a change to the
// View-all door, its Tasks-view landing or the New task picker is required to update this check.
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());
const PORT = freePort();

let failures = 0, ran = 0;
const say = (n, cond, note) => {
  ran++;
  if (cond) console.log('PASS  ' + n + (note ? '  ' + note : ''));
  else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); }
};

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'at-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE member, never a live agent: assignment requires membership, and
     naming a real session would type into that agent's live pane. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'tasker-discord', claim: 'tasker', title: '✳ idle' }));
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'tasker-discord\n');

  /* #2762: give the fixture member a PICTURE, so this check exercises the avatar
     path of `tkFace` rather than the initials path. Without it every browser
     check renders initials and the member-face URL is never looked at in a real
     browser at all -- which is exactly how #2762 shipped.
     The env var is set before requiring the store because store.js resolves its
     root per call (#1443), and this is the same root the server below is given. */
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  // The 8-byte PNG signature is a real PNG to store.imageTypeOf.
  require('../../engine/store').saveAvatar('tasker', 'image/png',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    /* TWO projects, so "across every project" is actually exercised. A
       single-project fixture would pass on a per-project screen, which is the
       thing this card exists to replace. */
    const made = await p.evaluate(async () => {
      const out = [];
      for (const name of ['Alpha Project', 'Beta Project']) {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }) });
        if (!r.ok) throw new Error('project create failed: ' + r.status);
        const body = await r.json();
        await fetch('/api/project/' + body.project.id + '/agent/tasker', { method: 'POST',
          headers: { 'content-type': 'application/json' } });
        out.push(body.project.id);
      }
      for (const id of out) {
        for (const s of ['First job here', 'Second job here']) {
          await fetch('/api/project/' + id + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sentence: s + ' (' + id + ')', who: 'tasker' }) });
        }
      }
      /* #3171: put TWO open and TWO closed tasks on the project the door opens
         (out[0]), so the check exercises the closed pill AND the open/closed
         divider against MULTI-item groups -- a 1-open/1-closed fixture cannot
         catch an interleave within a group. out[0] already has tasks 1-2; add
         3-4, then close 1-2, leaving 3-4 open. */
      for (const s of ['Third job here', 'Fourth job here']) {
        await fetch('/api/project/' + out[0] + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sentence: s + ' (' + out[0] + ')', who: 'tasker' }) });
      }
      for (const n of [1, 2]) {
        await fetch('/api/project/' + out[0] + '/task/' + n + '/close', { method: 'POST',
          headers: { 'content-type': 'application/json' } });
      }
      return out;
    });
    say('the fixture made two projects with tasks on each', made.length === 2, JSON.stringify(made));

    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Alpha Project').first().click();
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    await p.waitForTimeout(400);

    /* THE DOOR IS UNCONDITIONAL, and it carries no count (#1346). */
    say('the door is offered on the project page', await p.isVisible('#pj-alltasks'));
    const doorText = (await p.textContent('#pj-alltasks')) || '';
    say('the door carries no count', !/\(\d+\)/.test(doorText), JSON.stringify(doorText));
    // Josh, 2026-09-10 (#2711 item 12): the door reads exactly "View All".
    say('the door reads "View All"', doorText.trim() === 'View All', JSON.stringify(doorText));

    /* #2762: the member face must carry the avatar VERSION, not a bare URL.
       A bare `/api/agent/<name>/avatar` is byte-identical before and after a
       picture change, so the list's identical-HTML repaint skip (TK_LIST_HTML)
       never recreates the <img> and the face stays stale. This is the same class
       #2698 fixed on the org chart, asserted here in a real browser against the
       real rendered src. */
    /* 🛑 SCOPED TO THE PROJECT'S OWN TASK LIST (#pj-tasklist), WITH NO FALLBACK. #2762 is about
       `tkFace` in `paintProjectTasks`, which paints that list on the project page. Measured then:
       the retired all-tasks screen (#3703) held `.tkcard` rows with no `.lav img`, and an earlier
       version of this arm queried that screen with an unscoped fallback and passed while the
       FALLBACK did all the work, reporting a result from a screen it did not name. A fallback that
       rescues a wrong selector does not make an arm robust, it makes it untruthful about what it
       measured, so a scoped miss here is a finding, not something to route around. */
    const face = await p.evaluate(() => {
      const list = document.getElementById('pj-tasklist');
      const img = list && list.querySelector('.lav img');
      return img ? img.getAttribute('src') : null;
    });

    say('the member face renders a picture at all (else the arm below is vacuous)',
      typeof face === 'string' && /\/api\/agent\/[^/]+\/avatar/.test(face), JSON.stringify(face));
    /* 🛑 NON-ZERO, not `\d+`. `?v=0` is what `(m.avatarVer || 0)` yields when the
       version never reaches the page, which is exactly the "producer drops
       avatarVer" failure this arm should catch. `\d+` matches `0`, so the arm would
       have greened on the broken case it was added for. */
    say('#2762: the member face URL carries a NON-ZERO avatar version, not a bare URL and not v=0',
      typeof face === 'string' && /\/avatar\?v=[1-9]\d*/.test(face), JSON.stringify(face));

    /* ---- the door lands on the Tasks view, scoped to Alpha ---- */
    await p.click('#pj-alltasks');
    await p.waitForFunction(() => !document.getElementById('panel-tasks').hidden
      && document.querySelectorAll('#tsk-groups .tsk-row').length > 0, null, { timeout: 10000 });
    const landed = await p.evaluate(() => {
      const pt = document.getElementById('panel-tasks');
      const rows = [...pt.querySelectorAll('#tsk-groups .tsk-row')];
      const seen = (r) => r.getBoundingClientRect().height > 0;
      const fold = pt.querySelector('.tsk-fold summary');
      /* #3949: the project and Created: pickers are dropdowns (the rail and the button row are gone). */
      const win = document.getElementById('tsk-win');
      const projSel = document.getElementById('tsk-projsel');
      return {
        shown: !pt.hidden && pt.getClientRects().length > 0,
        projectPageHidden: document.getElementById('pj-one-view').getClientRects().length === 0,
        title: document.getElementById('tsk-title').textContent.trim(),
        rail: projSel ? projSel.value : null,
        win: win ? win.value : null,
        keys: rows.map((r) => r.dataset.key),
        openOnScreen: rows.filter((r) => seen(r) && !r.closest('.tsk-fold')).length,
        sub: document.getElementById('tsk-sub').textContent.trim(),
        fold: fold ? fold.textContent.trim() : null,
        crumb: !!document.querySelector('#tsk-crumb [data-open-project]'),
        search: document.getElementById('tsk-search').value,
      };
    });
    say('the door opens the Tasks view (not a separate screen)', landed.shown && landed.projectPageHidden, JSON.stringify(landed));
    say('it is scoped to the project the door was opened from: title and project dropdown', landed.title === 'Alpha Project' && landed.rail === made[0], JSON.stringify(landed));
    say('every row is this project\'s, all four of them (open and closed)',
      landed.keys.length === 4 && landed.keys.every((k) => k.startsWith(made[0] + '#')), JSON.stringify(landed.keys));
    say('the other project\'s tasks are not listed', !landed.keys.some((k) => k.startsWith(made[1] + '#')), JSON.stringify(landed.keys));
    say('the window opens at All, so finished work is reachable', landed.win === '0', JSON.stringify(landed.win));
    say('finished work sits in the Completed fold, counted', landed.fold === 'Completed (2)', JSON.stringify(landed.fold));
    /* 🔑 THE #1346 ASSERTION on the new destination: the stated open count equals the open rows
       a person can SEE, counted inside the view (the project page behind renders task cards too). */
    const statedOpen = Number((landed.sub.match(/^(\d+) open/) || [])[1]);
    say('#1346: the stated open count matches the open rows on screen', statedOpen === 2 && landed.openOnScreen === 2,
      'says ' + JSON.stringify(landed.sub) + ', open rows on screen ' + landed.openOnScreen);
    say('the way back is the crumb\'s Open project', landed.crumb);

    /* ---- + New task with a project picked: it files to that project, and answers here ---- */
    await p.click('#tsk-new');
    await p.waitForSelector('#nt-modal', { state: 'visible', timeout: 5000 });
    const dlgA = await p.evaluate(() => ({
      pickerHidden: document.getElementById('nt-projrow').hidden,
      project: document.getElementById('nt-project').textContent.trim(),
    }));
    say('+ New task on a picked project: its dialog, no picker', dlgA.pickerHidden && dlgA.project === 'Alpha Project', JSON.stringify(dlgA));
    await p.fill('#nt-what', 'Made from the Tasks view');
    await p.click('#nt-go');
    await p.waitForFunction(() => /Added task/.test(document.getElementById('tsk-msg').textContent), null, { timeout: 8000 }).catch(() => {});
    await p.waitForFunction(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].some((b) => b.textContent === 'Made from the Tasks view'), null, { timeout: 8000 }).catch(() => {});
    const madeA = await p.evaluate((id) => ({
      msg: document.getElementById('tsk-msg').textContent.trim(),
      modalHidden: document.getElementById('nt-modal').hidden,
      focus: document.activeElement && document.activeElement.id,
      row: [...document.querySelectorAll('#tsk-groups .tsk-row')].find((r) => r.querySelector('.tl').textContent === 'Made from the Tasks view'),
      key: (() => { const r = [...document.querySelectorAll('#tsk-groups .tsk-row')].find((x) => x.querySelector('.tl').textContent === 'Made from the Tasks view'); return r ? r.dataset.key : null; })(),
      stillTasks: !document.getElementById('panel-tasks').hidden,
      id,
    }), made[0]);
    say('it says where the task went', madeA.msg === 'Added task 5 to Alpha Project.' || madeA.msg.startsWith('Added task 5 to Alpha Project. '), JSON.stringify(madeA.msg));
    say('the new task is listed, on Alpha, without leaving the view', madeA.stillTasks && madeA.key === made[0] + '#5', JSON.stringify(madeA.key));
    say('focus returns to + New task', madeA.modalHidden && madeA.focus === 'tsk-new', JSON.stringify(madeA.focus));

    /* ---- + New task on All tasks: the dialog asks which project ---- */
    await p.selectOption('#tsk-projsel', '');
    await p.waitForTimeout(200);
    await p.click('#tsk-new');
    await p.waitForSelector('#nt-modal', { state: 'visible', timeout: 5000 });
    const dlgAll = await p.evaluate(() => ({
      pickerShown: document.getElementById('nt-projrow').getClientRects().length > 0,
      inHidden: document.getElementById('nt-in').hidden,
      options: [...document.querySelectorAll('#nt-proj option')].map((o) => o.textContent),
    }));
    say('on All tasks the dialog asks which project', dlgAll.pickerShown && dlgAll.inHidden, JSON.stringify(dlgAll));
    /* The sandbox seeds its welcome project too, so the list is every live project, by name. */
    const sortedOpts = dlgAll.options.slice().sort((x, y) => x.localeCompare(y));
    say('it offers the live projects, by name', dlgAll.options.includes('Alpha Project') && dlgAll.options.includes('Beta Project')
      && JSON.stringify(dlgAll.options) === JSON.stringify(sortedOpts), JSON.stringify(dlgAll.options));
    await p.fill('#nt-what', 'Aimed at Beta');
    await p.selectOption('#nt-proj', made[1]);
    const kept = await p.inputValue('#nt-what');
    say('changing the project keeps what was typed', kept === 'Aimed at Beta', JSON.stringify(kept));
    await p.click('#nt-go');
    // Wait for THIS create's answer: the Alpha one above already says "Added task".
    await p.waitForFunction(() => /to Beta Project\./.test(document.getElementById('tsk-msg').textContent), null, { timeout: 8000 }).catch(() => {});
    const onBeta = await p.evaluate(async (id) => {
      const r = await fetch('/api/tasks?project=' + encodeURIComponent(id), { cache: 'no-store' });
      const body = await r.json();
      return { has: (body.tasks || []).some((t) => t.sentence === 'Aimed at Beta'), msg: document.getElementById('tsk-msg').textContent.trim() };
    }, made[1]);
    say('the task lands on the project picked in the dialog', onBeta.has && /to Beta Project\./.test(onBeta.msg), JSON.stringify(onBeta));

    /* ---- an ARCHIVED project's own door still lists its tasks ---- */
    await p.evaluate(async (id) => {
      await fetch('/api/project/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    }, made[1]);
    await p.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, made[1]);
    await p.waitForSelector('#pj-alltasks', { state: 'visible', timeout: 8000 });
    await p.click('#pj-alltasks');
    await p.waitForFunction((id) => !document.getElementById('panel-tasks').hidden
      && [...document.querySelectorAll('#tsk-groups .tsk-row')].some((r) => r.dataset.key.startsWith(id + '#')), made[1], { timeout: 10000 }).catch(() => {});
    const arch = await p.evaluate((id) => ({
      title: document.getElementById('tsk-title').textContent.trim(),
      rows: [...document.querySelectorAll('#tsk-groups .tsk-row')].filter((r) => r.dataset.key.startsWith(id + '#')).length,
    }), made[1]);
    say('an archived project\'s door still lists its tasks', arch.title === 'Beta Project' && arch.rows === 3, JSON.stringify(arch));
    /* Read once the view's own read has come back (it knows Beta is archived); the arrival paint
       before it draws from the previous read, when Beta was not archived yet. */
    await p.waitForFunction(() => (TSK.data || []).some((t) => t.projectArchived), null, { timeout: 8000 }).catch(() => {});
    /* #3949: the All projects count is on the dropdown's first option, "All projects (N)". */
    const allCount = () => Number((document.querySelector('#tsk-projsel option[value=""]').textContent.match(/\((\d+)\)$/) || [])[1]);
    const railAllBefore = await p.evaluate(allCount);
    await p.selectOption('#tsk-projsel', '');
    await p.waitForTimeout(200);
    const railAllAfter = await p.evaluate((src) => ({
      badge: new Function('return ' + src)()(),
      openRows: Number((document.getElementById('tsk-sub').textContent.match(/^(\d+) open/) || [])[1]),
    }), allCount.toString());
    /* #1346 on the picker: while scoped to an archived project, "All projects" counts what picking it shows. */
    say('the dropdown\'s All projects count agrees with its destination, even from an archived door',
      railAllBefore === railAllAfter.badge && railAllAfter.badge === railAllAfter.openRows, JSON.stringify({ railAllBefore, ...railAllAfter }));
    const setAside = await p.evaluate((id) => [...document.querySelectorAll('#tsk-groups .tsk-row')].filter((r) => r.dataset.key.startsWith(id + '#')).length, made[1]);
    say('on All tasks the archived project is set aside again', setAside === 0, String(setAside));
    /* And the All-tasks picker leaves it out too (Beta is archived now; Alpha is not). */
    await p.click('#tsk-new');
    await p.waitForSelector('#nt-modal', { state: 'visible', timeout: 5000 });
    const optsNow = await p.evaluate(() => [...document.querySelectorAll('#nt-proj option')].map((o) => o.textContent));
    say('the All-tasks picker leaves the archived project out', optsNow.includes('Alpha Project') && !optsNow.includes('Beta Project'), JSON.stringify(optsNow));
    await p.click('#nt-back');

    /* ---- the consolidated layout: the door opens Tasks in the display column ---- */
    await p.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) }).then((r) => r.text()));
    await p.setViewportSize({ width: 1400, height: 950 });
    /* The consolidated layout applies on the two tabs it merges, so land on Projects (a reload
       would come back on ?tab=tasks, which is its own page). */
    await p.goto(`http://127.0.0.1:${PORT}/?tab=projects`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.body.classList.contains('consolidated'), null, { timeout: 8000 }).catch(() => {});
    await p.click('#pj-list [data-project="' + made[0] + '"]', { timeout: 5000 }).catch(() => {});
    await p.waitForSelector('#pj-alltasks', { state: 'visible', timeout: 8000 }).catch(() => {});
    await p.click('#pj-alltasks', { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => !document.getElementById('panel-tasks').hidden
      && document.querySelectorAll('#tsk-groups .tsk-row').length > 0, null, { timeout: 8000 }).catch(() => {});
    const cons = await p.evaluate(() => {
      const pt = document.getElementById('panel-tasks');
      return {
        cons: document.body.classList.contains('consolidated'),
        shown: !pt.hidden && pt.getClientRects().length > 0,
        inColumn: pt.parentElement && pt.parentElement.id === 'panel-projects',
        title: document.getElementById('tsk-title').textContent.trim(),
      };
    });
    say('[consolidated] the door opens Tasks in the display column, scoped', cons.cons && cons.shown && cons.inColumn && cons.title === 'Alpha Project', JSON.stringify(cons));

    /* ---- a phone: the head with its button scrolls nothing sideways ---- */
    const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
    ph.on('pageerror', (e) => errs.push(String(e)));
    await ph.evaluate(() => 0).catch(() => {});
    await ph.goto(`http://127.0.0.1:${PORT}/?tab=tasks`, { waitUntil: 'networkidle' });
    if (await ph.isVisible('#firstrun')) await ph.keyboard.press('Escape');
    await ph.waitForFunction(() => !document.getElementById('panel-tasks').hidden, null, { timeout: 8000 }).catch(() => {});
    const narrow = await ph.evaluate(() => ({
      btn: document.getElementById('tsk-new').getClientRects().length > 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    say('390 wide: + New task shows and nothing scrolls sideways', narrow.btn && narrow.overflow <= 0, JSON.stringify(narrow));
    await ph.close();

    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    say('the check ran to completion', false, String(e && e.message ? e.message : e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }
  console.log((failures ? 'FAIL' : 'PASS') + '  render-alltasks  (' + ran + ' assertions)');
  process.exit(failures ? 1 : 0);
})();
