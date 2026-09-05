'use strict';
/* #1652: the fresh-install "find my agents" affordance, checked in the real page.
 *
 * Root cause (traced on origin/main): the AUTO first-run scan (/api/scan-agents ->
 * discover.scan() bare) deliberately skips Documents/Downloads/Desktop to avoid a
 * TCC permission bombardment on a brand-new user (#2125). The path that DOES scan
 * those folders -- where people keep a sent/downloaded agent file -- is the create
 * import panel (populateFoundImports -> /api/scan-import -> scan({importScan:true})),
 * which a fresh user has no reason to open. So a fresh install found none of Josh's
 * files in Documents/Downloads and sent him straight to "Create an agent".
 *
 * The fix adds a CONTEXTUAL one-click on the first-run create ending: a quiet link
 * "I already have agent files here" that opens the create form on the IMPORT mode,
 * whose populateFoundImports() fires the on-demand TCC scan (the permission prompt
 * is expected because the person chose it). #2125's TCC-free auto scan is unchanged.
 *
 * This drives the SHIPPED page, never a copy:
 *   1. Force the first-run create empty state (found() + scan() both empty) and
 *      assert the link + the Documents/Downloads copy render, alongside "Giddy Up".
 *   2. CONTROL: the adopt ending (a real fleet) does NOT get the import link -- the
 *      link is scoped to the create branch, the one with a free action slot.
 *   3. Click the link and assert it lands on the create tab, import mode selected,
 *      with the found-on-this-computer scan container present (the scan path fired).
 *   4. CONTROL: opening create with no mode (openCreate()) lands on 'pm', not
 *      import -- so the new mode threading cannot leak 'import' into the default.
 *
 * DOM-state assertions only (hidden flags, checked, text), so headless is fine and
 * mode-independent. The permission-flow itself (the real macOS TCC prompt) is NOT
 * asserted here -- that rides Josh's fresh-install verify (#2243).
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
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1&fr-step=' + (fleetStep || 7), { waitUntil: 'networkidle' });

    // ── 1. Force the CREATE empty state (found + scan both empty) and paint. ──
    await p.evaluate(() => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = { ok: true, candidates: [] };
      frPaintFleet();
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
    if (createEnding.linkPresent && /Documents and Downloads/i.test(createEnding.linkText)) ok('the inline "Look in my Documents and Downloads" link renders in the create-ending copy'); else bad('inline import link renders', 'present=' + createEnding.linkPresent + ' text=' + JSON.stringify(createEnding.linkText));
    if (/Documents and Downloads/.test(createEnding.body) && /ask macOS for permission/.test(createEnding.body)) ok('the copy names the folders + the permission prompt'); else bad('affordance copy', createEnding.body.slice(0, 200));

    // ── 2. CONTROL: the ADOPT ending (a real fleet) gets NO import link. ──
    await p.evaluate(() => {
      FR = { path: 'adopt', fleetCount: 2 };
      FR_FOUND = { ok: true, agents: [{ dir: '/x/a', name: 'Ada', role: 'r', already: true }, { dir: '/x/b', name: 'Bo', role: 'r', already: true }], adoptable: [] };
      FR_SCAN = { ok: true, candidates: [] };
      frPaintFleet();
    });
    const adoptHasLink = await p.evaluate(() => { const box = document.getElementById('fr-fleet'); return !!(box && box.querySelector('.fr-lookimport')); });
    if (!adoptHasLink) ok('CONTROL: the adopt ending shows no import link (scoped to the create ending)'); else bad('CONTROL adopt has no import link', 'a .fr-lookimport is present on the adopt ending');

    // ── 3. Re-paint the create ending, CLICK the link, land on create+import. ──
    await p.evaluate(() => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = { ok: true, candidates: [] };
      frPaintFleet();
    });
    // Record whether /api/scan-import is requested after the click (the TCC scan).
    let scanImportHit = false;
    p.on('request', (req) => { if (/\/api\/scan-import/.test(req.url())) scanImportHit = true; });
    await p.click('#fr-fleet .fr-lookimport');
    // The click runs frFinish(() => openCreate('import')): completes first run, opens
    // the create tab, selects import mode, and populateFoundImports fires the scan.
    await p.waitForSelector('#importpick:not([hidden])', { timeout: 10000 }).catch(() => {});
    const afterClick = await p.evaluate(() => ({
      importPanelShown: document.getElementById('importpick') ? !document.getElementById('importpick').hidden : false,
      importRadioChecked: (() => { const r = document.querySelector('input[name="rmode"][value="import"]'); return !!(r && r.checked); })(),
      foundContainer: (() => { const el = document.getElementById('import-found'); const panel = document.getElementById('importpick'); return !!(el && panel && panel.contains(el)); })(),
      roleStepShown: document.getElementById('cstep-role') ? !document.getElementById('cstep-role').hidden : false,
    }));
    if (afterClick.importPanelShown) ok('clicking the link opens the create IMPORT panel'); else bad('link opens import panel', JSON.stringify(afterClick));
    if (afterClick.importRadioChecked) ok('the import mode radio is selected'); else bad('import radio selected', JSON.stringify(afterClick));
    if (afterClick.foundContainer) ok('the found-on-this-computer scan container is present in the panel'); else bad('scan container present', JSON.stringify(afterClick));
    // Give the async populateFoundImports a moment, then check the scan fired.
    await p.waitForTimeout(800);
    if (scanImportHit) ok('the on-demand TCC scan (/api/scan-import) fired on the import panel'); else bad('/api/scan-import fired', 'no request to /api/scan-import seen after the click');

    // ── 4. CONTROL: openCreate() with no mode lands on 'pm', not import. ──
    const control = await p.evaluate(() => {
      openCreate();
      return {
        importPanelShown: document.getElementById('importpick') ? !document.getElementById('importpick').hidden : false,
        pmChecked: (() => { const r = document.querySelector('input[name="rmode"][value="pm"]'); return !!(r && r.checked); })(),
        importChecked: (() => { const r = document.querySelector('input[name="rmode"][value="import"]'); return !!(r && r.checked); })(),
      };
    });
    // loadRoles is async on first fetch but the roles are cached from step 3, so pickMode('pm') is synchronous here.
    if (control.pmChecked && !control.importChecked && !control.importPanelShown) ok('CONTROL: openCreate() with no mode lands on prompt mode, not import'); else bad('CONTROL bare openCreate defaults pm', JSON.stringify(control));

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 10) { console.log('firstrun-import: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('firstrun-import: ' + failures + ' FAILED'); process.exit(1); }
  console.log('firstrun-import: all good, ' + ran + ' checks');
})();
