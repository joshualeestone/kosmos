'use strict';
/* #1652: after the file-access grant, found agents load onto screen 9 -- no link.
 *
 * Josh's 0.6.39 ruling (verbatim): "There is no link to appear, even. It just
 * pulls them in." The auto scan (/api/scan-agents) is TCC-free (#2125) and skips
 * Documents/Downloads/Desktop, so a person whose agent folders sit there was told
 * to "create their first agent" though they have one. Once Screen 2's file-access
 * permission is GRANTED (the real prompt fires via Kitty's #2347), the fix belongs
 * in DETECTION: `frScanAgents` reaches those folders via the import scan
 * (/api/scan-import -> discover.scan({importScan:true})), so the folder candidates
 * load onto screen 9 through the ordinary frPaintScan path.
 *
 * This drives the SHIPPED page, never a copy. The three network routes are stubbed
 * so the check controls the grant verdict and the scan population deterministically
 * (the real macOS TCC prompt -> grant -> disk walk is an operator fresh-install
 * pass, #2243; this proves the FRONT-END route selection and rendering):
 *   1. GRANTED: /api/file-access-status -> {checkable:true, granted:true}. Assert
 *      frScanAgents fetches /api/scan-import (NOT the bare scan), and the returned
 *      candidates render on screen 9 via frPaintScan ("We found N agents...").
 *   2. CONTROL (declined): granted:false -> frScanAgents fetches the bare
 *      /api/scan-agents, NOT the TCC-walking import scan. This is the #2125
 *      no-ambush guarantee: the import scan never fires without a positive grant.
 *   3. CONTROL (uncheckable, e.g. a browser with no native writer):
 *      checkable:false -> bare /api/scan-agents, same as declined.
 *
 * DOM-state + which-route assertions only, so headless is fine.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-firstrun-scan-on-grant-1652.js
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
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'sog-' + k.toLowerCase() + '-'));
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

    /* Which scan route frScanAgents actually reached. Reset before each scenario;
       the route handlers push their own name so an assertion can tell scan-import
       (TCC-reaching) from scan-agents (bare) rather than inferring from output. */
    const hits = { scanImport: 0, scanAgents: 0 };
    let grant = { checkable: false };            // mutated per scenario
    let importCandidates = [];                    // what scan-import returns

    await p.route('**/api/file-access-status', (r) => r.fulfill({ json: grant }));
    await p.route('**/api/scan-import', (r) => {
      hits.scanImport++;
      r.fulfill({ json: { ok: true, candidates: importCandidates, importable: [], bounded: {} } });
    });
    await p.route('**/api/scan-agents', (r) => {
      hits.scanAgents++;
      r.fulfill({ json: { ok: true, candidates: [], importable: [], bounded: {} } });
    });

    // Load the first-run flow so every fr-pane exists, then jump to the step that
    // holds #fr-fleet, keyed by identity not a hard number.
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1', { waitUntil: 'domcontentloaded' });
    const fleetStep = await p.evaluate(() => {
      const el = document.getElementById('fr-fleet');
      const pane = el && el.closest('.fr-pane');
      const m = pane && /^fr-pane-(\d+)$/.exec(pane.id || '');
      return m ? Number(m[1]) : null;
    });
    if (!fleetStep) { bad('discover the fleet/fork step', 'no #fr-pane-N around #fr-fleet'); }
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1&fr-step=' + (fleetStep || 9), { waitUntil: 'networkidle' });

    // Helper: reset state to the create empty-state and run one scan scenario.
    const runScan = async () => p.evaluate(async () => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };  // found() empty -> falls through to scan
      FR_SCAN = null;
      FR_SCAN_GEN = 0;
      await frScanAgents();   // fetches file-access-status, then the chosen scan route
    });
    const readScreen = async () => p.evaluate(() => {
      const box = document.getElementById('fr-fleet');
      const title = document.getElementById('fr-fleet-title');
      return {
        title: title ? title.textContent : '',
        rows: box ? box.querySelectorAll('.fr-scanrow').length : 0,
        offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1,
      };
    });

    // ── 1. GRANTED: the import scan runs and its candidates load onto screen 9. ──
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: true, at: Date.now() };
    importCandidates = [
      { dir: '/Users/x/Documents/site-monitor', name: 'Site monitor', role: 'Watches the site', preview: 'You watch the site.' },
      { dir: '/Users/x/Documents/mailer', name: 'Mailer', role: 'Sends the digest', preview: 'You send the digest.' },
    ];
    await runScan();
    const g = await readScreen();
    if (hits.scanImport === 1 && hits.scanAgents === 0) ok('GRANTED: frScanAgents reaches the TCC folders via /api/scan-import (not the bare scan)'); else bad('GRANTED uses import scan', 'scanImport=' + hits.scanImport + ' scanAgents=' + hits.scanAgents);
    if (g.offer === 2) ok('GRANTED: the import-scan candidates become the screen-9 offer'); else bad('GRANTED offer count', JSON.stringify(g));
    if (/We found 2 agents on this computer/i.test(g.title)) ok('GRANTED: screen 9 loads the found agents ("We found 2 agents on this computer.")'); else bad('GRANTED screen-9 title', JSON.stringify(g.title));
    if (g.rows === 2) ok('GRANTED: both found agents render as add/skip rows on screen 9'); else bad('GRANTED rendered rows', JSON.stringify(g));

    // ── 2. CONTROL (declined): granted:false -> bare scan, NO TCC import walk. ──
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };
    importCandidates = [];
    await runScan();
    if (hits.scanAgents === 1 && hits.scanImport === 0) ok('CONTROL declined: the TCC-walking import scan NEVER fires without a grant (#2125 no-ambush)'); else bad('CONTROL declined uses bare scan', 'scanImport=' + hits.scanImport + ' scanAgents=' + hits.scanAgents);

    // ── 3. CONTROL (uncheckable, e.g. a browser with no native writer). ──
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: false, because: 'no native writer' };
    await runScan();
    if (hits.scanAgents === 1 && hits.scanImport === 0) ok('CONTROL uncheckable: an unmeasured grant keeps the bare TCC-free scan'); else bad('CONTROL uncheckable uses bare scan', 'scanImport=' + hits.scanImport + ' scanAgents=' + hits.scanAgents);

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 7) { console.log('scan-on-grant: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('scan-on-grant: ' + failures + ' FAILED'); process.exit(1); }
  console.log('scan-on-grant: all good, ' + ran + ' checks');
/* A throw BEFORE the body's try (temp-dir setup, the server spawn, or
   chromium.launch()) would otherwise crash the process with no quotable line, and
   the gate reds with the confusing "(no FAIL line...)" (#1864). The top-level
   catch below prints a quotable failure line so an unexpected launch throw reads
   as a real failure. It is kept on ONE line to match the established top-level
   catch shape (render-optout-403-2020 etc.), so the reason-grep tripwires count it
   -- and this comment deliberately does NOT put the promise-catch token and a
   quoted failure prefix on the same line, since the catch/launch scan would then
   count the comment itself as a site (see the reason-grep test's own warning). */
})().catch((e) => { console.error('FAIL  render-firstrun-scan-on-grant-1652 threw: ' + ((e && e.stack) || e)); process.exit(1); });
