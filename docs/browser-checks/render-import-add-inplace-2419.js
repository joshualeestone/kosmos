'use strict';
/* #2419: the found-agents IMPORT rows add in place, in one click, without jumping.
 *
 * Josh's 0.6.45 ruling: each discovered agent FILE shows only its name + an "Add to
 * Kosmos" button; clicking Add creates the agent behind the scenes and turns the
 * button into a green "Added to Kosmos" check WHERE IT IS -- the list stays put and
 * the flow never navigates to the create-agent page (the old "Import this one"
 * button did exactly that).
 *
 * This drives the SHIPPED page, never a copy. Four network routes are stubbed so the
 * check controls the scan population, the parse, and the create deterministically
 * (the real disk walk + create is an operator fresh-install pass):
 *   - /api/file-access-status -> granted, /api/scan-agents -> empty, so the find-agents
 *     screen (#fr-fleet) is reached through the ordinary frScanAgents/frPaintScan path.
 *   - /api/scan-import -> one loose agent FILE in `importable`, which renders as one
 *     .fr-importrow with an "Add to Kosmos" button.
 *   - /api/agent-import-file -> the parsed shape the Add reads (name/displayName/
 *     instructions/provider); flippable to a refusal for the control.
 *   - /api/agents -> the create the Add posts behind the scenes; the check records the
 *     body so it can assert the mapping (name + own role + label + instructions +
 *     provider, and NO tellKosmos).
 *
 * ASSERTS:
 *   1. the row shows name + "Add to Kosmos" only -- no path, no preview, no "Import".
 *   2. clicking Add posts /api/agents with the parsed fields mapped to the own role,
 *      and NOT tellKosmos (it defers to the global ping, #2020).
 *   3. the button becomes "Added to Kosmos" with the green check (::before glyph +
 *      the `added` class), the row is marked done, and it STAYS on the list.
 *   4. it did NOT navigate to the create-agent page (still on #firstrun/#fr-fleet;
 *      the create form's name step never showed).
 *   5. CONTROL: a parse refusal shows the reason on the row, re-enables the button,
 *      does NOT mark the row done, and fires NO create. Without this arm the positive
 *      arm could pass on a flow that "adds" regardless of what the file is.
 *
 * DOM-state + which-route assertions only (a button's text/class, a recorded POST
 * body, a computed ::before), so headless is fine.
 *
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

    // State the routes read/mutate per scenario.
    let importFiles = [{ file: '/Users/x/Downloads/rust-starter.md', name: 'Rust starter template', role: 'A Rust template', preview: 'You are a Rust starter template.' }];
    let parseReply = { ok: true, name: 'Rust starter template', displayName: 'Rust starter', instructions: 'You are a Rust starter template.', provider: 'anthropic' };
    const createBodies = [];   // every POST /api/agents body the Add fires

    await p.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: true, at: Date.now() } }));
    await p.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [], importable: [], bounded: {} } }));
    await p.route('**/api/scan-import', (r) => r.fulfill({ json: { ok: true, candidates: [], importable: importFiles, bounded: {} } }));
    await p.route('**/api/agent-import-file', (r) => r.fulfill({ json: parseReply }));
    await p.route('**/api/agents', (r) => {
      let body = {};
      try { body = JSON.parse(r.request().postData() || '{}'); } catch { /* recorded as {} */ }
      createBodies.push(body);
      r.fulfill({ json: { ok: true, outcome: 'created', name: body.name || 'rust-starter' } });
    });

    // Load first-run, jump to the #fr-fleet step (keyed by identity, not a number).
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1', { waitUntil: 'domcontentloaded' });
    const fleetStep = await p.evaluate(() => {
      const el = document.getElementById('fr-fleet');
      const pane = el && el.closest('.fr-pane');
      const m = pane && /^fr-pane-(\d+)$/.exec(pane.id || '');
      return m ? Number(m[1]) : null;
    });
    if (!fleetStep) { bad('discover the fleet step', 'no #fr-pane-N around #fr-fleet'); }
    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1&fr-step=' + (fleetStep || 9), { waitUntil: 'networkidle' });

    // Paint the find-agents screen with the one loose import file.
    await p.evaluate(async () => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = null; FR_SCAN_GEN = 0;
      await frScanAgents();
      if (typeof frRescanStop === 'function') frRescanStop();
    });

    // ── 1. The row shows name + "Add to Kosmos" only. ──
    const row1 = await p.evaluate(() => {
      const box = document.getElementById('fr-fleet');
      const rows = box ? box.querySelectorAll('.fr-importrow') : [];
      const row = rows[0];
      const go = row ? row.querySelector('.fr-importgo') : null;
      return {
        count: rows.length,
        name: row ? (row.querySelector('.fr-importname') || {}).textContent : '',
        goText: go ? go.textContent.trim() : '',
        html: row ? row.innerHTML : '',
      };
    });
    if (row1.count === 1) ok('one importable file renders as one .fr-importrow'); else bad('import row count', JSON.stringify(row1.count));
    if (/Rust starter template/.test(row1.name)) ok('the row shows the agent name'); else bad('row name', JSON.stringify(row1.name));
    if (row1.goText === 'Add to Kosmos') ok('the button reads "Add to Kosmos" (not "Import this one")'); else bad('button label', JSON.stringify(row1.goText));
    if (!/rust-starter\.md|Downloads|You are a Rust starter|fr-scanpreview|What it says/.test(row1.html)) ok('the row shows NO path, NO preview, NO "what it says"'); else bad('row still shows path/preview', row1.html.slice(0, 240));

    // ── 2 + 3 + 4. Click Add; it creates behind the scenes and stays in place. ──
    createBodies.length = 0;
    await p.click('#fr-fleet .fr-importrow .fr-importgo');
    await p.waitForFunction(() => {
      const b = document.querySelector('#fr-fleet .fr-importrow .fr-importgo');
      return b && /Added to Kosmos/.test(b.textContent);
    }, { timeout: 8000 }).catch(() => {});
    const after = await p.evaluate(() => {
      const box = document.getElementById('fr-fleet');
      const row = box ? box.querySelector('.fr-importrow') : null;
      const go = row ? row.querySelector('.fr-importgo') : null;
      const before = go ? getComputedStyle(go, '::before').content : '';
      const create = document.getElementById('panel-create');
      // "still on find-agents": #firstrun is visible and the create panel + its name step are not.
      const firstrunShown = (() => { const fr = document.getElementById('firstrun'); return !!(fr && !fr.hidden); })();
      const nameStepShown = (() => { const s = document.getElementById('cstep-name'); return !!(s && !s.hidden); })();
      return {
        rowStillThere: !!row,
        goText: go ? go.textContent.trim() : '',
        added: go ? go.classList.contains('added') : false,
        checkGlyph: before,
        rowDone: row ? row.classList.contains('done') : false,
        createShown: create ? !create.hidden : false,
        firstrunShown, nameStepShown,
      };
    });
    if (createBodies.length === 1) ok('clicking Add fires exactly one create (POST /api/agents)'); else bad('create count', JSON.stringify(createBodies.length));
    const b = createBodies[0] || {};
    // The anthropic default is omitted (create-go's "only what changed travels" rule),
    // and tellKosmos is omitted so the create defers to the person's global ping.
    const bodyOk = b.name === 'Rust starter template' && b.role === 'own' && b.label === 'Rust starter'
      && b.instructions === 'You are a Rust starter template.'
      && !('provider' in b) && !('tellKosmos' in b);
    if (bodyOk) ok('the create maps name + own role + label + instructions, omits the anthropic default and tellKosmos'); else bad('create body', JSON.stringify(b));
    if (after.goText === 'Added to Kosmos') ok('the button becomes "Added to Kosmos" in place'); else bad('added label', JSON.stringify(after.goText));
    if (after.added) ok('the button carries the `added` class (the green receipt state)'); else bad('added class', 'missing');
    if (/✓/.test(after.checkGlyph)) ok('the green CHECK renders (::before glyph), so the state is not colour-only'); else bad('check glyph', JSON.stringify(after.checkGlyph));
    if (after.rowDone) ok('the row is marked done'); else bad('row done', 'missing');
    if (after.rowStillThere) ok('the row STAYS on the list (add, add, add down the rows)'); else bad('row vanished', 'the import row is gone after Add');
    if (!after.createShown && !after.nameStepShown && after.firstrunShown) ok('it did NOT jump to the create-agent page (still on the find-agents screen)'); else bad('jumped to create', JSON.stringify(after));

    // ── 5. CONTROL: a parse refusal shows the reason, re-enables, fires no create. ──
    importFiles = [{ file: '/Users/x/Downloads/not-an-agent.md', name: 'Grocery list', role: '', preview: 'milk, eggs' }];
    parseReply = { ok: false, because: 'That file is not an agent we can bring in.' };
    createBodies.length = 0;
    await p.evaluate(async () => { FR_SCAN = null; FR_SCAN_GEN = 0; await frScanAgents(); if (typeof frRescanStop === 'function') frRescanStop(); });
    await p.click('#fr-fleet .fr-importrow .fr-importgo');
    await p.waitForFunction(() => {
      const s = document.querySelector('#fr-fleet .fr-importrow .fr-importsaid');
      return s && /not an agent/i.test(s.textContent);
    }, { timeout: 8000 }).catch(() => {});
    const ctrl = await p.evaluate(() => {
      const row = document.querySelector('#fr-fleet .fr-importrow');
      const go = row ? row.querySelector('.fr-importgo') : null;
      const said = row ? row.querySelector('.fr-importsaid') : null;
      return {
        reason: said ? said.textContent : '',
        goText: go ? go.textContent.trim() : '',
        goDisabled: go ? go.disabled : true,
        added: go ? go.classList.contains('added') : false,
        rowDone: row ? row.classList.contains('done') : false,
      };
    });
    if (/not an agent/i.test(ctrl.reason)) ok('CONTROL: a parse refusal shows its reason on the row'); else bad('CONTROL reason', JSON.stringify(ctrl.reason));
    if (ctrl.goText === 'Add to Kosmos' && !ctrl.goDisabled && !ctrl.added && !ctrl.rowDone) ok('CONTROL: the button re-enables to "Add to Kosmos", the row is not done'); else bad('CONTROL button reset', JSON.stringify(ctrl));
    if (createBodies.length === 0) ok('CONTROL: a refused parse fires NO create'); else bad('CONTROL fired a create', JSON.stringify(createBodies));

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 14) { console.log('import-add-inplace: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('import-add-inplace: ' + failures + ' FAILED'); process.exit(1); }
  console.log('import-add-inplace: all good, ' + ran + ' checks');
})();
