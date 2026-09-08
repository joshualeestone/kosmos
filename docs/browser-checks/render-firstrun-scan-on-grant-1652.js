'use strict';
/* #2497: the first-run auto-scan (and its grant-flip re-scan) is GONE (kosmos#1652 behavior superseded).
 *
 * #1652 made first-run Screen 9 auto-scan for agents on the disk and, after a late file-access
 * grant, re-scan via /api/scan-import and load the found agents onto the screen ("it just pulls
 * them in"). #2497 (Josh, 2026-09-08, watching Ben + Nacho test) removed ALL auto-scan/auto-import
 * from onboarding: a developer's many tmux Claude Code sessions filled first run with garbage
 * agents. First run now ALWAYS lands on the no-agent "Create your first agent." / Giddy Up screen,
 * so it fires no disk scan on entry and arms no grant-flip poll, whatever the grant or the disk.
 *
 * This check now guards the SUPPRESSION: with file access GRANTED and /api/scan-import holding
 * candidates (exactly the input that used to load agents onto S9), first-run S9 must land on the
 * create / Giddy Up screen, render NO scan rows, and NEVER auto-fetch /api/scan-import (nor
 * /api/scan-agents) from the onboarding flow, even after a wait long enough that a grant-flip poll
 * would have fired. The discovery engine + /api/scan-import route are kept for the manual Import
 * Agent path (#1652 on the Create Agent screen), which is not this flow.
 *
 * Self-contained: boots its own sandboxed board.
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

    // GRANTED file access, and /api/scan-import HAS candidates: the exact input that used to load
    // agents onto S9. Count the scan fetches so we can assert onboarding auto-fetches neither.
    let scanImportCalls = 0;
    let scanAgentsCalls = 0;
    await p.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: true, at: Date.now() } }));
    await p.route('**/api/scan-import', (r) => { scanImportCalls += 1; r.fulfill({ json: { ok: true, candidates: [{ dir: '/Users/x/Documents/site-monitor' }, { dir: '/Users/x/Downloads/scratch' }], importable: [], bounded: {} } }); });
    await p.route('**/api/scan-agents', (r) => { scanAgentsCalls += 1; r.fulfill({ json: { ok: true, candidates: [{ dir: '/Users/x/Documents/site-monitor' }], importable: [] } }); });

    // Load first-run and jump to the #fr-fleet step (keyed by identity, not a number).
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1', { waitUntil: 'domcontentloaded' });
    const fleetStep = await p.evaluate(() => {
      const el = document.getElementById('fr-fleet');
      const pane = el && el.closest('.fr-pane');
      const m = pane && /^fr-pane-(\d+)$/.exec(pane.id || '');
      return m ? Number(m[1]) : null;
    });
    if (!fleetStep) { bad('discover the fleet step', 'no #fr-pane-N around #fr-fleet'); }
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1&fr-step=' + (fleetStep || 9), { waitUntil: 'networkidle' });
    await p.waitForSelector('#fr-fleet', { timeout: 10000 });
    // Wait longer than the old grant-flip poll interval (~1.5s) so a re-scan would have fired if armed.
    await p.waitForTimeout(2500);

    const view = await p.evaluate(() => ({
      title: (document.getElementById('fr-fleet-title') || {}).textContent || '',
      box: (document.getElementById('fr-fleet') || {}).innerHTML || '',
      scanRows: document.querySelectorAll('#fr-fleet .fr-scanrow, #fr-fleet .fr-foundrow, #fr-fleet .fr-adoptrow').length,
    }));

    if (/create your first agent/i.test(view.title)) ok('first run lands on the create heading even with a grant + candidates'); else bad('create heading', JSON.stringify(view.title));
    if (/let’s get started/i.test(view.box)) ok('the Giddy Up copy is present'); else bad('Giddy Up copy', view.box.slice(0, 160));
    if (view.scanRows === 0) ok('no scan/found rows render on first run'); else bad('scan/found rows still render', String(view.scanRows));
    if (scanImportCalls === 0) ok('onboarding never auto-fetched /api/scan-import (no auto-scan, no grant-flip re-scan)'); else bad('auto scan-import fired', String(scanImportCalls));
    if (scanAgentsCalls === 0) ok('onboarding never auto-fetched /api/scan-agents'); else bad('auto scan-agents fired', String(scanAgentsCalls));
    if (errs.length === 0) ok('no page errors'); else bad('no page errors', errs.join(' | '));

    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 6) { console.log('scan-on-grant: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('scan-on-grant: ' + failures + ' FAILED'); process.exit(1); }
  console.log('scan-on-grant: all good, ' + ran + ' checks');
})();
