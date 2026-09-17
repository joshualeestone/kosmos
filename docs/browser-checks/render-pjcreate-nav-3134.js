/* #3134 (Josh 6.70, supersedes the 6.68 "return to the projects list"): after
 * "Create project", land the person INSIDE the new project. Josh's 6.70
 * verification: "once you create a project ... it should take you directly into
 * that project." (The 6.68 behaviour -- return to the list -- was PR #3160; this
 * check asserted that, and is rewritten here for the reversal.)
 *
 * Drives the SHIPPED #pj-create handler against a real server (sandboxed roots),
 * in BOTH the tab and consolidated views. Asserts that after a successful create
 * the new project's DETAIL is shown (#pj-one-view visible, #pj-one-name is the new
 * project's name) and the create form (#pj-add-view) is hidden. In the tab view
 * the list (#pj-list-view) is hidden by the detail; in the consolidated view the
 * list stays visible as the rail beside the detail, so that arm does not assert it
 * hidden. Non-vacuous: on the 6.68 page (openProject replaced by pjView('list'))
 * the detail would be HIDDEN and the list shown -- the dangerous answer this now
 * guards against, in the opposite direction from before.
 *
 * The read-back-failure fallback (openProject's else branch: a created-but-
 * unreadable project cannot be shown, so it returns to the list with the "could
 * not read it back" notice) is UNCHANGED by the 6.70 reversal and still asserted.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pjcreate-nav-3134.js
 *      (HEADED=0 on a machine with no console session)
 * Sandboxed roots; kills only what it starts.
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjcreate-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    // Reads the view states + which project the detail is showing.
    const stateAfter = async () => p.evaluate(() => ({
      oneShown: !document.getElementById('pj-one-view').hidden,
      listShown: !document.getElementById('pj-list-view').hidden,
      addHidden: document.getElementById('pj-add-view').hidden,
      detailName: (document.getElementById('pj-one-name').textContent || '').trim(),
    }));

    // ---- Tab view ----
    await p.click('[data-tab="projects"]');
    await p.click('#pj-new');
    await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
    await p.fill('#pj-name', 'Tab Created Project');
    await p.click('#pj-create');
    await p.waitForSelector('#pj-add-view', { state: 'hidden', timeout: 10000 });
    const tab = await stateAfter();
    if (!tab.oneShown) die('tab: after create the project detail (#pj-one-view) is not shown -- it did not land inside the new project (#3134, Josh 6.70)');
    if (tab.detailName !== 'Tab Created Project') die('tab: the detail is not the newly-created project (#pj-one-name is ' + JSON.stringify(tab.detailName) + ')');
    if (tab.listShown) die('tab: after create the projects list is still shown instead of the new project detail (the 6.68 return-to-list behaviour Josh reversed in 6.70)');
    if (!tab.addHidden) die('tab: after create the create form (#pj-add-view) is still shown');

    // ---- Consolidated view ----
    await p.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) }).then((r) => r.text()));
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForTimeout(600);
    if (!(await p.evaluate(() => document.body.classList.contains('consolidated')))) die('the consolidated layout did not take (fixture control)');
    await p.click('#rail-projects-new');   // the rail's New project +
    await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
    await p.fill('#pj-name', 'Cons Created Project');
    await p.click('#pj-create');
    await p.waitForSelector('#pj-add-view', { state: 'hidden', timeout: 10000 });
    const cons = await stateAfter();
    if (!cons.oneShown) die('consolidated: after create the project detail (#pj-one-view) is not shown -- it did not land inside the new project (#3134, Josh 6.70)');
    if (cons.detailName !== 'Cons Created Project') die('consolidated: the detail is not the newly-created project (#pj-one-name is ' + JSON.stringify(cons.detailName) + ')');
    if (!cons.addHidden) die('consolidated: after create the create form (#pj-add-view) is still shown');
    // In the consolidated layout the list stays visible as the rail beside the
    // detail (pjView keeps #pj-list-view shown when which !== 'list'), so this arm
    // does NOT assert the list hidden -- only that the detail is the new project.
    // The consolidated layout must survive the create (a showTab-style navigation would drop it).
    if (!(await p.evaluate(() => document.body.classList.contains('consolidated')))) die('consolidated: the layout was dropped by the create navigation');

    // ---- Read-back-failure fallback (openProject's internal else branch) ----
    // Route the create POST to the "created but read-back failed" shape
    // (body.project null, only body.id) so the created id is not in PROJECTS.
    // The handler always calls openProject(newProjectId); openProject's own
    // pjById check is then false, so it surfaces the "created but we could not
    // read it back" notice on #pj-list-msg and returns to the list rather than a
    // silent empty screen. This path is unchanged by the 6.70 reversal.
    await p.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'tabs' }) }).then((r) => r.text()));
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.route('**/api/projects', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'ghost-unreadable', project: null }) });
      } else {
        await route.continue();   // the follow-up GET (loadProjects) hits the real server; no such id exists there
      }
    });
    await p.click('[data-tab="projects"]');
    await p.click('#pj-new');
    await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
    await p.fill('#pj-name', 'Ghost Project');
    await p.click('#pj-create');
    await p.waitForSelector('#pj-add-view', { state: 'hidden', timeout: 10000 });
    const fallback = await p.evaluate(() => ({
      listShown: !document.getElementById('pj-list-view').hidden,
      oneHidden: document.getElementById('pj-one-view').hidden,
      notice: (document.getElementById('pj-list-msg').textContent || '').trim(),
    }));
    await p.unroute('**/api/projects');
    if (!fallback.listShown) die('fallback: after a read-back-failed create the list is not shown');
    if (!fallback.oneHidden) die('fallback: after a read-back-failed create the project detail is shown instead of the list');
    if (!/could not read it back|created, but/i.test(fallback.notice)) die('fallback: the "created but could not read it back" notice is missing from #pj-list-msg: ' + JSON.stringify(fallback.notice));

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('PJCREATE NAV OK (#3134, Josh 6.70): after Create project the new project DETAIL is shown (#pj-one-view, #pj-one-name is the new project; not the list, not the create form) in both the tab and consolidated views; the read-back-failure fallback still returns to the list with the "could not read it back" notice; no page errors.');
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
