/* #4583 (#4580 items 3 and 4): the create form asks what done looks like, the projects list says "Done not set"
 * for a project whose brief does not say it, and a second coordinator added to a project is warned about in the
 * project notice until it no longer holds or the person dismisses it.
 *
 * Drives the SHIPPED page against a real server (sandboxed roots):
 *  1. Create with done left blank: the POST carries no `done` key; the row shows "Done not set".
 *  2. Create with done typed: the POST carries it; the row shows no badge (control for 1).
 *  3. Coordinators (the page's own rules; the server's are in server.projects.test.js): the add answer and the
 *     project read are stubbed. A project read that says two coordinators shows NOTHING until an add brought it on
 *     (a warning at add time, not a standing nag); after the add it shows; Dismiss removes it; and a read that no
 *     longer has two coordinators drops it by itself.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-project-done-4583.js
 *      (HEADED=0 on a machine with no console session)
 * Sandboxed roots; kills only what it starts.
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();
const WARN = 'Ada and Bo both have a coordinating role on this project. So they do not split the work by hand, decide who owns what now: one owns the brief (BRIEF.md) and the other owns the task queue.';

let passed = 0;
const failed = [];
const ok = (label, cond, detail) => { if (cond) { passed += 1; console.log('PASS  ' + label); } else { failed.push(label); console.log('FAIL  ' + label + (detail ? '  --  ' + String(detail).slice(0, 300) : '')); } };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjdone-' + k.toLowerCase() + '-'));
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const posted = [];
  p.on('request', (r) => { if (r.method() === 'POST' && /\/api\/projects$/.test(r.url())) posted.push(JSON.parse(r.postData() || '{}')); });
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    const create = async (name, done) => {
      await p.click('[data-tab="projects"]');
      await p.click('#pj-new');
      await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
      await p.fill('#pj-name', name);
      await p.fill('#pj-add-desc', 'What it is for.');
      ok(name + ': the Done looks like box is on the form and empty', (await p.inputValue('#pj-add-done')) === '');
      if (done) await p.fill('#pj-add-done', done);
      await p.click('#pj-create');
      await p.waitForSelector('#pj-add-view', { state: 'hidden', timeout: 10000 });
    };
    const rowBadge = (name) => p.evaluate((n) => {
      const card = [...document.querySelectorAll('#pj-list .pc, #pj-list [data-pj], #pj-list > *')].find((el) => (el.textContent || '').includes(n));
      return card ? { found: true, badge: !!card.querySelector('.pj-doneunset'), text: (card.querySelector('.pj-doneunset') || {}).textContent || '' } : { found: false };
    }, name);

    await create('Blank Done Project', '');
    ok('blank: the create POST carries no done key', posted.length === 1 && !('done' in posted[0]), JSON.stringify(posted[0]));
    await create('Given Done Project', 'The lease is signed.');
    ok('given: the create POST carries the typed done', posted.length === 2 && posted[1].done === 'The lease is signed.', JSON.stringify(posted[1]));

    // Review round 4: a done that is too long is caught AT its box before any request; a done the engine refuses
    // is shown at the box too.
    const before = posted.length;
    await p.click('[data-tab="projects"]');
    await p.click('#pj-new');
    await p.waitForSelector('#pj-add-view', { state: 'visible', timeout: 5000 });
    await p.fill('#pj-name', 'Too Long Done');
    await p.fill('#pj-add-done', 'x'.repeat(1001));
    await p.click('#pj-create');
    await p.waitForTimeout(300);
    const longErr = await p.evaluate(() => ({ err: document.getElementById('pj-add-done-err').textContent, focus: document.activeElement && document.activeElement.id, open: !document.getElementById('pj-add-view').hidden }));
    ok('too long: said at the done box, focused, form still open, nothing sent', /longer than 1000/.test(longErr.err) && longErr.focus === 'pj-add-done' && longErr.open && posted.length === before, JSON.stringify(longErr));
    await p.route('**/api/projects', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'what done looks like has to be words' }) })
      : route.continue()));
    await p.fill('#pj-add-done', 'Short.');
    await p.click('#pj-create');
    await p.waitForTimeout(400);
    const refused = await p.evaluate(() => document.getElementById('pj-add-done-err').textContent);
    ok('refused by the engine: the reason is at the done box', refused === 'What done looks like has to be words.', refused);
    await p.unroute('**/api/projects');
    await p.evaluate(() => { document.getElementById('pj-add-view').hidden = true; });

    await p.evaluate(() => loadProjects());
    await p.evaluate(() => pjView('list'));
    const blank = await rowBadge('Blank Done Project');
    const given = await rowBadge('Given Done Project');
    ok('blank: its row shows Done not set', blank.found && blank.badge && blank.text === 'Done not set', JSON.stringify(blank));
    ok('given: its row shows no badge (control)', given.found && !given.badge, JSON.stringify(given));

    // ---- coordinators (page rules; the add answer and the read are stubbed) ----
    const id = await p.evaluate(() => (PROJECTS.find((x) => x.name === 'Given Done Project') || {}).id);
    let readSaysTwo = true;
    await p.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      for (const pr of body.projects || []) if (pr.id === id) pr.coordinators = readSaysTwo ? WARN : null;
      return route.fulfill({ response: res, json: body });
    });
    await p.route('**/api/project/*/agent/*', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ project: null, told: { state: 'not_tried' }, said: null, coordinators: WARN }) }));
    await p.evaluate((pid) => openProject(pid), id);
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    const notice = () => p.evaluate(() => (document.getElementById('pj-one-notice').textContent || ''));
    ok('coordinators: a read that says two shows nothing before an add brought it on', !/coordinator/i.test(await notice()), await notice());
    await p.evaluate(() => addMemberToProject('pm-y', document.getElementById('pj-one-msg')));
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: after the add the warning is in the project notice', (await notice()).includes('Two coordinators on this project') && (await notice()).includes('owns the task queue'), await notice());
    await p.click('#pj-one-notice [data-pn-coord-dismiss]');
    await p.waitForTimeout(200);
    ok('coordinators: Dismiss removes it', !/coordinator/i.test(await notice()), await notice());
    await p.evaluate(() => addMemberToProject('pm-y', document.getElementById('pj-one-msg')));
    readSaysTwo = false;
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: a read with no longer two coordinators drops it by itself', !/coordinator/i.test(await notice()), await notice());
    readSaysTwo = true;
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: once dropped, it does not come back without a new add', !/coordinator/i.test(await notice()), await notice());
    // Review round 2: a repaint on the read from BEFORE the add (coordinators still null) must not clear the warning
    // before it was ever shown; the next read, which knows about the add, shows it.
    readSaysTwo = false;
    await p.evaluate(() => loadProjects());
    await p.evaluate(() => addMemberToProject('pm-y', document.getElementById('pj-one-msg')));
    await p.evaluate(() => paintOneProject());   // the stale read: coordinators null
    readSaysTwo = true;
    await p.evaluate(() => loadProjects());
    await p.waitForTimeout(300);
    ok('coordinators: a stale repaint between the add and the next read does not swallow the warning', (await notice()).includes('Two coordinators on this project'), await notice());
    await p.unroute('**/api/projects');
    await p.unroute('**/api/project/*/agent/*');

    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally {
    await b.close();
    srv.kill();
  }
  console.log(failed.length ? passed + ' passed, ' + failed.length + ' FAILED' : 'all project-done checks passed (' + passed + ')');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
