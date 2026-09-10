'use strict';
/* #1652 -> #5: the fresh-install create ending shows NO find-agents link.
 *
 * The #1652 "Look in my Documents and Downloads" link was added to screen-9's
 * create arm (Mona's mock) and then REMOVED after Josh's 0.6.39 fresh-account test:
 * he saw the link on the empty screen and ruled it should not appear ("There is no
 * link to appear, even"), all the more so because the permissions were never
 * actually granted; and clicking it jumped him to create-agent instead of loading
 * found agents onto screen 9. The fix for agents in Documents/Downloads belongs in
 * DETECTION: once the permission flow (#1) grants access, a full scan of those
 * folders runs and any agents load onto screen 9 via the found path, not a link.
 *
 * This drives the SHIPPED page, never a copy:
 *   1. Force the first-run create empty state (found() + scan() both empty) and
 *      assert the single "Giddy Up" primary, ONE fork button, and NO .fr-lookimport
 *      link and NO "Documents and Downloads" copy.
 *   2. CONTROL: the adopt ending (a real fleet) also has no link.
 *   3. CONTROL: opening create with no mode (openCreate()) lands on 'pm', not
 *      import -- the mode threading still works and does not leak 'import'.
 *
 * DOM-state assertions only (hidden flags, checked, text), so headless is fine.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-firstrun-import-1652.js
 */
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

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-' + k.toLowerCase() + '-'));
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
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|status 404/.test(m.text())) errs.push(m.text()); });

    // Load the first-run flow so every fr-pane exists, then jump to the step that
    // holds #fr-fleet (the fork/ending), keyed by identity not a hard number.
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1', { waitUntil: 'domcontentloaded' });
    const fleetStep = await p.evaluate(() => {
      const el = document.getElementById('fr-fleet');
      const pane = el && el.closest('.fr-pane');
      const m = pane && /^fr-pane-(\d+)$/.exec(pane.id || '');
      return m ? Number(m[1]) : null;
    });
    if (!fleetStep) { bad('discover the fleet/fork step', 'no #fr-pane-N around #fr-fleet'); }
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1&fr-step=' + (fleetStep || 9), { waitUntil: 'networkidle' });

    // ── 1. Force the CREATE empty state (found + scan both empty) and paint. ──
    await p.evaluate(() => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = { ok: true, candidates: [] };
      frPaintFleet();
      // #3/#4(a): frPaintFleet's create/unknown arms now arm the grant-flip re-scan poll
      // (frArmRescanOnGrant). This check drives frPaintFleet directly, with no frGo navigation
      // to retire it, so stop the poll explicitly -- otherwise a leaked setInterval fires
      // background /api/file-access-status GETs (benign while the server returns checkable:false,
      // but a latent flake if that ever changes).
      if (typeof frRescanStop === 'function') frRescanStop();
    });
    const createEnding = await p.evaluate(() => {
      const box = document.getElementById('fr-fleet');
      const link = box ? box.querySelector('.fr-lookimport') : null;
      return {
        body: box ? box.innerHTML : '',
        primaryText: (document.getElementById('fr-next') || {}).textContent || '',
        primaryShown: document.getElementById('fr-next') ? !document.getElementById('fr-next').hidden : false,
        // Josh's ruling: the create ending is ONE button. The affordance is an
        // inline link in the copy, NOT a second fork button.
        altShown: document.getElementById('fr-alt') ? !document.getElementById('fr-alt').hidden : false,
        linkPresent: !!link,
        linkText: link ? link.textContent : '',
      };
    });
    if (createEnding.primaryShown && /giddy up/i.test(createEnding.primaryText)) ok('create ending keeps its single primary "Giddy Up"'); else bad('create ending primary', JSON.stringify(createEnding.primaryText));
    if (!createEnding.altShown) ok('the create ending keeps ONE fork button (Josh ruling), no second button'); else bad('create ending grew a second fork button', 'fr-alt is shown');
    // #5 (Josh's 0.6.39 ruling): the create ending (screen 9b) shows NO find-agents
    // link and NO "Documents and Downloads" copy. His words: "There is no link to
    // appear, even." Agents in Documents/Downloads are reached by the permission-
    // granted scan loading them onto this screen via the found path, not a link.
    if (!createEnding.linkPresent) ok('#5: the create ending shows NO find-agents link (Josh 0.6.39 ruling)'); else bad('#5 no find-agents link', 'a .fr-lookimport is present: ' + JSON.stringify(createEnding.linkText));
    if (!/Documents and Downloads/i.test(createEnding.body)) ok('#5: the create ending has no "Documents and Downloads" find-agents copy'); else bad('#5 no find-agents copy', createEnding.body.slice(0, 200));

    // ── 2. CONTROL: the ADOPT ending (a real fleet) gets NO import link. ──
    await p.evaluate(() => {
      FR = { path: 'adopt', fleetCount: 2 };
      FR_FOUND = { ok: true, agents: [{ dir: '/x/a', name: 'Ada', role: 'r', already: true }, { dir: '/x/b', name: 'Bo', role: 'r', already: true }], adoptable: [] };
      FR_SCAN = { ok: true, candidates: [] };
      frPaintFleet();
      // #3/#4(a): frPaintFleet's create/unknown arms now arm the grant-flip re-scan poll
      // (frArmRescanOnGrant). This check drives frPaintFleet directly, with no frGo navigation
      // to retire it, so stop the poll explicitly -- otherwise a leaked setInterval fires
      // background /api/file-access-status GETs (benign while the server returns checkable:false,
      // but a latent flake if that ever changes).
      if (typeof frRescanStop === 'function') frRescanStop();
    });
    const adoptHasLink = await p.evaluate(() => { const box = document.getElementById('fr-fleet'); return !!(box && box.querySelector('.fr-lookimport')); });
    if (!adoptHasLink) ok('CONTROL: the adopt ending shows no import link (scoped to the create ending)'); else bad('CONTROL adopt has no import link', 'a .fr-lookimport is present on the adopt ending');

    // ── 3. CONTROL: openCreate() with no mode lands on 'pm', not import. ──
    // (The import panel + /api/scan-import are still available via openCreate('import'),
    //  they are just no longer reached from a first-run link, per #5.)
    await p.evaluate(() => openCreate());
    // loadRoles is async on the first fetch (no section caches it now), so wait for
    // pickMode('pm') to land rather than reading synchronously.
    await p.waitForFunction(() => { const r = document.querySelector('input[name="rmode"][value="pm"]'); return !!(r && r.checked); }, { timeout: 8000 }).catch(() => {});
    const control = await p.evaluate(() => ({
      importPanelShown: document.getElementById('importpick') ? !document.getElementById('importpick').hidden : false,
      pmChecked: (() => { const r = document.querySelector('input[name="rmode"][value="pm"]'); return !!(r && r.checked); })(),
      importChecked: (() => { const r = document.querySelector('input[name="rmode"][value="import"]'); return !!(r && r.checked); })(),
    }));
    if (control.pmChecked && !control.importChecked && !control.importPanelShown) ok('CONTROL: openCreate() with no mode lands on prompt mode, not import'); else bad('CONTROL bare openCreate defaults pm', JSON.stringify(control));

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 7) { console.log('firstrun-import: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('firstrun-import: ' + failures + ' FAILED'); process.exit(1); }
  console.log('firstrun-import: all good, ' + ran + ' checks');
})();
