'use strict';
/* #2497: the found-agents IMPORT rows are GONE from first run (kosmos#2419 behavior superseded).
 *
 * #2419 put loose discovered agent FILES on the first-run Screen 9 as .fr-importrow "Add to
 * Kosmos" rows that created the agent in place. #2497 (Josh, 2026-09-08, watching Ben + Nacho test)
 * removed the whole found/scan/import list from onboarding: a developer's many tmux Claude Code
 * sessions filled first run with garbage agents. First run now ALWAYS lands on the no-agent
 * "Create your first agent." / Giddy Up screen, so no import rows render on first-run S9, whatever
 * the disk scan returns.
 *
 * This check now guards the SUPPRESSION: with file access granted and /api/scan-import returning a
 * loose importable FILE (exactly the input that used to raise an import row), first-run S9 must
 * show the create / Giddy Up screen with NO import rows, and must not auto-parse or auto-create
 * anything. The import engine is kept-but-bypassed (per the card); a user pulls agents in later via
 * the manual Import Agent (#1652) on the Create Agent screen, which uses /api/scan-import there.
 *
 * Self-contained: boots its own sandboxed board.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-import-add-inplace-2419.js
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
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'iai-' + k.toLowerCase() + '-'));
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

    // File access granted and the disk scan returns a loose importable FILE: exactly the input
    // that used to raise an import row. Count auto-parse / auto-create so we can assert neither fires.
    let importParseCalls = 0;
    let createCalls = 0;
    const importFiles = [{ file: '/Users/x/Downloads/rust-starter.md', name: 'Rust starter template', role: 'A Rust template', preview: 'You are a Rust starter template.' }];
    await p.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: true, at: Date.now() } }));
    await p.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [], importable: [], bounded: {} } }));
    await p.route('**/api/scan-import', (r) => r.fulfill({ json: { ok: true, candidates: [], importable: importFiles, bounded: {} } }));
    await p.route('**/api/agent-import-file', (r) => { importParseCalls += 1; r.fulfill({ json: { ok: true, name: 'Rust starter template', displayName: 'Rust starter', instructions: 'x', provider: 'anthropic' } }); });
    await p.route('**/api/agents', (r) => { createCalls += 1; r.fulfill({ status: 200, json: { outcome: 'created', name: 'rust-starter' } }); });

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
    await p.waitForTimeout(600);

    const view = await p.evaluate(() => ({
      title: (document.getElementById('fr-fleet-title') || {}).textContent || '',
      box: (document.getElementById('fr-fleet') || {}).innerHTML || '',
      importRows: document.querySelectorAll('#fr-fleet .fr-importrow').length,
      scanRows: document.querySelectorAll('#fr-fleet .fr-scanrow, #fr-fleet .fr-foundrow').length,
    }));

    if (/create your first agent/i.test(view.title)) ok('first run shows the create heading, not an import list'); else bad('create heading', JSON.stringify(view.title));
    if (/let’s get started/i.test(view.box)) ok('the Giddy Up copy is present'); else bad('Giddy Up copy', view.box.slice(0, 160));
    if (view.importRows === 0) ok('no import rows render on first run'); else bad('import rows still render', String(view.importRows));
    if (view.scanRows === 0) ok('no scan/found rows render on first run'); else bad('scan/found rows still render', String(view.scanRows));
    if (createCalls === 0) ok('no agent was auto-created on first run'); else bad('auto-created on first run', String(createCalls));
    // Note: importParseCalls may be >0 only if the (bypassed) code path still parsed; assert it did not.
    if (importParseCalls === 0) ok('no import file was auto-parsed on first run'); else bad('auto-parsed on first run', String(importParseCalls));
    if (errs.length === 0) ok('no page errors'); else bad('no page errors', errs.join(' | '));

    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 6) { console.log('import-add-inplace: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('import-add-inplace: ' + failures + ' FAILED'); process.exit(1); }
  console.log('import-add-inplace: all good, ' + ran + ' checks');
})();
