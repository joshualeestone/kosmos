/* Drive-through of the project settings screen (pack section 3099): the
 * door from the project page, the pack's fields painting from the record,
 * the immediate-parent location sentence, a save round trip, and the
 * relocated archive/remove blocks present with their original ids.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pjsettings.js
 * Sandboxed roots; kills only what it starts; Reveal is NOT clicked (it
 * opens a real Finder window; its route is wire-tested instead). */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
/* Rendered text, not DOM text (#687): `innerText` honours CSS display and
   visibility, and an element with no box has no rendered text at all, so a
   sentence nobody can see reads as '' here and the assertion fails. */
const shown = async (loc) => ((await loc.boundingBox()) ? loc.innerText() : '');

const REPO = path.resolve(__dirname, '..', '..');
/* Screenshots go to SHOT_DIR or a fresh temp dir, never into the repo (#630):
   they differ byte for byte run to run and dirtied the shared checkout under
   every cut. The path is printed at the end so a person can find them. */
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pjsettings-shots-'));
/* A free port, asked of the kernel, never a number (#708): the gate got this
   in #633 and the self-booting checks still carried fixed ports, so two agents
   running the same check collided exactly as before. */
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') }, // sandboxed whole (#634)
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.evaluate(async () => {
      for (const name of ['Settings Drive', 'Second Project']) {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }) });
        if (!r.ok) throw new Error('fixture create failed: ' + name);
      }
    });
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Settings Drive').first().click();

    // The project page no longer shows the path; the door is there.
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
    const pageText = await p.locator('#pj-one-view').innerText();
    if (/\/var\/folders|\/Users\//.test(pageText)) die('a filesystem path is still on the project page');

    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    if ((await p.inputValue('#pjs-name')) !== 'Settings Drive') die('name did not paint');
    const folderName = (await shown(p.locator('#pjs-folder-name'))).trim();
    if (folderName !== 'Settings Drive') die('folder name line: ' + folderName);
    const where = (await shown(p.locator('#pjs-folder-where'))).trim();
    // Sandboxed root is a temp dir, not the Kosmos folder: the parent rule
    // must produce "In your <tempdirname> folder." — assert the SHAPE.
    if (!/^In (your .+ folder\.|a folder you chose\.)$/.test(where)) die('location sentence shape: ' + where);
    for (const id of ['pjs-reveal', 'pj-one-archive', 'pj-one-remove', 'pjs-save']) {
      if (!(await p.locator('#' + id).isVisible())) die(id + ' is missing from settings');
    }
    await p.screenshot({ path: path.join(OUT, 'project-settings.png') });

    // Save round trip: rename, verify it lands, confirm, and #3134 returns to it.
    // #2923: delay the PUT so the in-flight Sweep spinner is observable (the
    // local round trip is otherwise instant, which would let a regression that
    // dropped the spinner injection still pass). Only the PUT is delayed; the
    // GET /api/projects reload is untouched.
    await p.route('**/api/project/**', async (route) => {
      if (route.request().method() === 'PUT') { await new Promise((r) => setTimeout(r, 500)); }
      await route.continue();
    });
    await p.fill('#pjs-name', 'Settings Drive Renamed');
    await p.click('#pjs-save');
    // The Sweep spinner must render in #pjs-save-live WHILE the save is in
    // flight (the headline behavior). Attached, because it is aria-hidden
    // decorative markup injected via innerHTML.
    await p.waitForSelector('#pjs-save-live .spin-sweep', { state: 'attached', timeout: 3000 });
    // #2923: the save confirmation then lands to the LEFT of the button in
    // #pjs-save-live, still ON the settings panel (kept visible for a beat so a
    // description-only save -- no visible effect on the detail, #2838 -- is
    // confirmed before #3134 advances). Assert it shows there, sits left of the
    // button, and is NOT duplicated below.
    await p.waitForFunction(() => { const m = document.getElementById('pjs-save-live'); return m && m.getBoundingClientRect().height > 0 && m.innerText.trim() === 'Saved.'; }, null, { timeout: 10000 });
    const savedPos = await p.evaluate(() => {
      const s = document.getElementById('pjs-save-live').getBoundingClientRect();
      const b = document.getElementById('pjs-save').getBoundingClientRect();
      return { statusRight: s.right, btnLeft: b.left };
    });
    if (!(savedPos.statusRight <= savedPos.btnLeft + 1)) die('the "Saved." status is not to the LEFT of the Save changes button: ' + JSON.stringify(savedPos));
    if ((await p.locator('#pjs-msg').innerText()).trim() === 'Saved.') die('"Saved." is still duplicated below the button (#pjs-msg)');
    // #3134 (Josh, 6.68): a beat after the confirmation it AUTO-ADVANCES to the
    // project detail instead of leaving the person "stuck on settings". This
    // navigation is the card's core and returns the dangerous answer on
    // origin/main (which stays on settings). The auto-advance is ~1s in code, so
    // a generous timeout here.
    await p.waitForSelector('#pj-one-view', { state: 'visible', timeout: 10000 });
    if (await p.locator('#pj-settings-view').isVisible()) die('after Save Changes, still on the settings view (#3134: should auto-advance to the project)');
    if ((await shown(p.locator('#pj-one-name'))).trim() !== 'Settings Drive Renamed') die('the project page missed the rename after save');
    // #3134 a11y: the timer-initiated advance moves focus to the settings cog on the
    // detail (matching pj-settings-back), so a keyboard/screen-reader user is not
    // dropped to <body>. On origin/main this path does not exist; a regression that
    // dropped the focus() would leave activeElement on the hidden Save button or body.
    const focusedId = await p.evaluate(() => (document.activeElement && document.activeElement.id) || '');
    if (focusedId !== 'pj-settings-link') die('after the auto-advance, focus is not on the settings cog (activeElement=' + focusedId + ') -- a keyboard/SR user was dropped');
    await p.unroute('**/api/project/**');  // later saves need no delay

    // A no-change save says so instead of lying "Saved." -- and a no-op does NOT
    // navigate (it returns before the fetch, so no auto-advance is scheduled and
    // it stays on settings). Re-open settings from the project we returned to.
    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    // The settings back-link label (paintProjectSettings sets #pj-settings-backname
    // to p.name) reflects the rename that just landed -- coverage kept from before
    // the #3134 rewrite, since the label is still painted on every settings open.
    const backname = (await shown(p.locator('#pj-settings-backname'))).trim();
    if (backname !== 'Settings Drive Renamed') die('the settings back-link label did not pick up the rename: ' + backname);
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-msg'); return m.getBoundingClientRect().height > 0 && m.innerText.trim() === 'Nothing has changed.'; }, null, { timeout: 5000 });
    // Give the (non-scheduled) auto-advance no chance to fire, then confirm we are STILL on settings.
    await p.waitForTimeout(1300);
    if (!(await p.locator('#pj-settings-view').isVisible())) die('a no-op save must stay on the settings view, not navigate (#3134 auto-advances only on a real save)');
    // The manual back link (leaving settings WITHOUT saving) still works.
    await p.click('#pj-settings-back');
    await p.waitForSelector('#pj-one-view', { state: 'visible' });

    // #2923 BLOCKER, re-checked under #3134: a prior project's "Saved." must not
    // survive into another project's settings. Make a real save (sets "Saved." in
    // #pjs-save-live, then auto-advances to the detail), then open a DIFFERENT
    // project's settings and confirm paintProjectSettings cleared #pjs-save-live.
    // Non-vacuous: the waitForFunction proves "Saved." was actually set first.
    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    await p.fill('#pjs-desc', 'a real change so this save is not a no-op');
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-save-live'); return m && m.innerText.trim() === 'Saved.'; }, null, { timeout: 10000 });
    await p.waitForSelector('#pj-one-view', { state: 'visible', timeout: 10000 });   // auto-advanced
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Second Project').first().click();
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    const staleLive = await p.evaluate(() => document.getElementById('pjs-save-live').textContent.trim());
    if (staleLive !== '') die('a prior project\'s "Saved." survived into the next project\'s settings (#pjs-save-live not cleared by paintProjectSettings): ' + JSON.stringify(staleLive));

    // #3134 BLOCKER guard (interleaved saves): a SECOND save click within the
    // prior save's ~1s auto-advance window must CANCEL that pending advance, or
    // the timer fires and yanks the person off the screen the second click just
    // put them on. We are on Second Project's settings. Make a real save
    // (schedules the auto-advance), and WHILE its "Saved." is up -- before the
    // ~1s advance -- click Save again with no edit: a no-op that stays on
    // settings and must clear the pending timer. Then wait PAST the advance
    // window and assert we are STILL on settings. On the pre-fix handler the
    // first save's timer was cleared only on the success path, so it fired here
    // and navigated to #pj-one-view -- the dangerous answer this guards.
    await p.route('**/api/project/**', async (route) => {
      if (route.request().method() === 'PUT') { await new Promise((r) => setTimeout(r, 300)); }
      await route.continue();
    });
    await p.fill('#pjs-desc', 'interleave test: the first save schedules the advance');
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-save-live'); return m && m.innerText.trim() === 'Saved.'; }, null, { timeout: 10000 });
    // second click, no edit -> no-op; must cancel the pending advance
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-msg'); return m.getBoundingClientRect().height > 0 && m.innerText.trim() === 'Nothing has changed.'; }, null, { timeout: 5000 });
    await p.unroute('**/api/project/**');
    await p.waitForTimeout(1400);   // well past the ~1s auto-advance window
    if (!(await p.locator('#pj-settings-view').isVisible())) die('#3134 BLOCKER: a no-op second save within the prior save\'s auto-advance window did not cancel it -- a stale timer navigated off the settings view');

    // #3134 guard (leaving the Projects tab): the auto-advance must NOT fire an
    // invisible pjView('one') while the person is on another tab. Still on Second
    // Project's settings. Make a real save (schedules the advance), switch to the
    // Agents tab WITHIN the window, wait past it, and assert PJ_VIEW is still
    // 'settings' -- the panel-hidden guard suppressed the advance. Without that
    // guard the timer would flip PJ_VIEW to 'one' invisibly (the dangerous answer).
    await p.route('**/api/project/**', async (route) => {
      if (route.request().method() === 'PUT') { await new Promise((r) => setTimeout(r, 300)); }
      await route.continue();
    });
    await p.fill('#pjs-desc', 'tab-switch test: the save schedules the advance');
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-save-live'); return m && m.innerText.trim() === 'Saved.'; }, null, { timeout: 10000 });
    await p.unroute('**/api/project/**');
    await p.click('[data-tab="agents"]');   // leave the Projects tab before the advance fires
    await p.waitForTimeout(1400);
    const viewAfterTab = await p.evaluate(() => (typeof PJ_VIEW !== 'undefined' ? PJ_VIEW : null));
    if (viewAfterTab !== 'settings') die('#3134: the auto-advance fired while on another tab (PJ_VIEW=' + viewAfterTab + '); the panel-hidden guard did not suppress it');

    // #3134 guard (re-opening settings): save -> leave settings -> deliberately
    // re-open it within the ~1s window must CANCEL the pending advance (re-entering
    // settings clears the timer), or the timer re-satisfies its fire-time guard and
    // pulls the person off the settings they just re-opened. Get back to a project's
    // settings in the tab view first, from whatever sub-view we are on.
    await p.click('[data-tab="projects"]');
    await p.waitForSelector('#panel-projects', { state: 'visible' });
    if (await p.locator('#pj-one-view').isVisible()) { await p.click('#pj-back'); }   // to the list
    await p.waitForSelector('#pj-list-view', { state: 'visible', timeout: 5000 });
    await p.locator('#pj-list').getByText('Second Project').first().click();
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    await p.route('**/api/project/**', async (route) => {
      if (route.request().method() === 'PUT') { await new Promise((r) => setTimeout(r, 300)); }
      await route.continue();
    });
    await p.fill('#pjs-desc', 're-open test unique change 987');    // a real change, so the save is not a no-op
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-save-live'); return m && m.innerText.trim() === 'Saved.'; }, null, { timeout: 10000 });
    await p.unroute('**/api/project/**');
    // leave settings, then deliberately re-open it, both within the window
    await p.click('#pj-settings-back');
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    await p.waitForTimeout(1400);                                  // past the advance window
    if (!(await p.locator('#pj-settings-view').isVisible())) die('#3134: re-opening settings within the window did not cancel the pending advance -- the timer pulled the person off the settings they re-opened');

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('PJSETTINGS DRIVE OK: door, paint, parent sentence, back-link rename, save round trip (spinner in-flight + "Saved." left of button + #3134 auto-advance to the project + focus to the cog), honest no-op stays on settings, manual back works, no cross-project "Saved." leak, an interleaved second save cancels the pending advance, the advance is suppressed on another tab, re-opening settings cancels a pending advance, relocated blocks present, no path on the project page, 0 page errors; shots in ' + OUT);
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
