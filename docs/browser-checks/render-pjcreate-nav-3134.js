/* #3134 (Josh, 6.68): after "Create project", return to the projects LIST (his
 * ask: "return to the projects list / the view I was on - currently stuck on the
 * create-project view"), not into the new project's empty detail.
 *
 * Drives the SHIPPED #pj-create handler against a real server (sandboxed roots),
 * in BOTH the tab and consolidated views. Asserts that after a successful create
 * the LIST is shown (#pj-list-view visible), the create form (#pj-add-view) and
 * the project detail (#pj-one-view) are hidden, and the new project appears in
 * the list. Non-vacuous: on origin/main the handler dives into the new project
 * (openProject), so #pj-one-view would be VISIBLE and #pj-list-view hidden -- the
 * dangerous answer this guards against.
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

    // Reads the four view states + whether the named project shows in the list.
    const stateAfter = async (name) => p.evaluate((nm) => ({
      listShown: !document.getElementById('pj-list-view').hidden,
      oneHidden: document.getElementById('pj-one-view').hidden,
      addHidden: document.getElementById('pj-add-view').hidden,
      newInList: new RegExp(nm).test(document.getElementById('pj-list').textContent || ''),
    }), name);

    // ---- Tab view ----
    await p.click('[data-tab="projects"]');
    await p.click('#pj-new');
    await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
    await p.fill('#pj-name', 'Tab Created Project');
    await p.click('#pj-create');
    await p.waitForSelector('#pj-add-view', { state: 'hidden', timeout: 10000 });
    const tab = await stateAfter('Tab Created Project');
    if (!tab.listShown) die('tab: after create the projects list is not shown (#3134)');
    if (!tab.oneHidden) die('tab: after create the project detail is shown -- it dived into the new project instead of returning to the list (#3134 regression)');
    if (!tab.addHidden) die('tab: after create the create form (#pj-add-view) is still shown');
    if (!tab.newInList) die('tab: the new project does not appear in the list after create');

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
    const cons = await stateAfter('Cons Created Project');
    if (!cons.listShown) die('consolidated: after create the projects list is not shown (#3134)');
    if (!cons.oneHidden) die('consolidated: after create the project detail is shown -- dived into the new project instead of the list (#3134 regression)');
    if (!cons.addHidden) die('consolidated: after create the create form (#pj-add-view) is still shown');
    if (!cons.newInList) die('consolidated: the new project does not appear in the list after create');
    // the consolidated layout must survive the create (a showTab-style navigation would drop it)
    if (!(await p.evaluate(() => document.body.classList.contains('consolidated')))) die('consolidated: the layout was dropped by the create navigation');

    // ---- Read-back-failure fallback (the openProject else branch) ----
    // Route the create POST to the "created but read-back failed" shape
    // (body.project null, only body.id) so pjById is false and the handler falls
    // back to openProject, which surfaces its "created but we could not read it
    // back" notice on #pj-list-msg and returns to the list rather than a silent
    // empty screen. Covers the else branch the plan's Verification section names.
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
    console.log('PJCREATE NAV OK (#3134): after Create project the projects LIST is shown (not the new project detail, not the create form), the new project is in the list, in both the tab and consolidated views; the read-back-failure fallback returns to the list with the "could not read it back" notice; no page errors.');
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
