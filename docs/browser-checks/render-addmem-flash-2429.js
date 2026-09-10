// Browser-check-surface: pj-one-add-go
'use strict';
/* #2429: the add-member modal closes on a successful add BEFORE the board refresh,
 * so the free-agent picker's empty-state line never flashes.
 *
 * Josh (0.6.45): after adding the last free agent, the modal "blipped out and then said
 * 'everyone can already see on it'". The modal already closed on success, but
 * `addMemberToProject` did `await loadProjects()` (which repaints the open detail's
 * picker) BEFORE the handler's `amClose()` -- so `paintFreeAgentPicker`'s empty-state
 * option ("every agent we can see is already on it") flashed into the still-open picker
 * and only then closed. The fix moves the refresh to the caller, AFTER amClose.
 *
 * This drives the shipped page. It seeds one free agent, opens the modal, stubs the
 * add POST + the /api/projects refresh (which returns the agent now ON the project, so
 * the picker WOULD go empty), and:
 *   - records, via a MutationObserver on the picker, whether the empty-state text ever
 *     appears WHILE the modal is visible (the flash);
 *   - records whether the modal was already hidden at the moment loadProjects ran (the
 *     ordering the fix guarantees).
 * The old order fails BOTH assertions (loadProjects ran with the modal open, and the
 * empty option flashed), so they are real controls.
 *
 * DOM-state + call-ordering, headless.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-addmem-flash-2429.js
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
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'am-' + k.toLowerCase() + '-'));
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

    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof window.paintFreeAgentPicker === 'function' && typeof window.addMemberToProject === 'function', { timeout: 8000 }).catch(() => {});

    const result = await p.evaluate(async () => {
      // Seed one project with no members and exactly one free agent, on a board that
      // has looked and can see agents (so the empty-state is the "already on it" line,
      // not a "looking"/"cannot see" state).
      const proj = { id: 'demo', name: 'Demo project', agents: [], archived: false };
      PROJECTS = [proj];
      PJ_CURRENT = 'demo';
      LAST = [{ sessionName: 'a1', name: 'Ada' }];
      BOARD_NEEDS_SIGNIN = false; BOARD_LOOK_FAILED = false; BOARD_LOOKED = true;

      // Open the modal and fill its picker (what the detail repaint does on the board).
      document.getElementById('pj-add-member').click();               // shows #am-modal
      const picker = document.getElementById('pj-one-add');
      paintFreeAgentPicker(proj, picker, document.getElementById('pj-one-add-go'));
      picker.value = 'a1';

      // Watch the picker for the empty-state text appearing WHILE the modal is visible.
      let flashedWhileOpen = false;
      const modal = document.getElementById('am-modal');
      const obs = new MutationObserver(() => {
        if (!modal.hidden && /already on it/i.test(picker.textContent || '')) flashedWhileOpen = true;
      });
      obs.observe(picker, { childList: true, subtree: true, characterData: true });

      // Stub the add POST (success) and the /api/projects refresh (agent now ON the
      // project -> the picker would go empty if repainted while open).
      const realFetch = window.fetch;
      let loadCalledWithModalHidden = null;
      let addPosted = false;   // key the ordering recorder to the add flow, not a background poll
      window.fetch = (url, opts) => {
        const u = String(url);
        if (/\/api\/project\/demo\/agent\/a1$/.test(u) && opts && opts.method === 'POST') {
          addPosted = true;
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (/\/api\/projects$/.test(u)) {
          // Record whether the modal is already hidden when the refresh fetch fires
          // AFTER the add POST (loadProjects is what issues it). Gating on addPosted
          // stops a background projects poll firing before the add from recording a
          // spurious "modal still open" -- a latent flake a reviewer flagged.
          if (addPosted && loadCalledWithModalHidden === null) loadCalledWithModalHidden = modal.hidden;
          return Promise.resolve(new Response(JSON.stringify({ projects: [{ id: 'demo', name: 'Demo project', archived: false, agents: [{ sessionName: 'a1', name: 'Ada' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return realFetch(url, opts);
      };

      // The add.
      document.getElementById('pj-one-add-go').click();
      // Let the POST + amClose + loadProjects + its repaint settle.
      await new Promise((r) => setTimeout(r, 400));
      obs.disconnect();
      window.fetch = realFetch;

      return {
        modalClosed: modal.hidden,
        flashedWhileOpen,
        loadCalledWithModalHidden,
      };
    });

    if (result.modalClosed) ok('the modal closes on a successful add'); else bad('modal did not close', JSON.stringify(result));
    if (result.flashedWhileOpen === false) ok('the empty-state line never flashes while the modal is open'); else bad('empty-state flashed in the open modal', JSON.stringify(result));
    if (result.loadCalledWithModalHidden === true) ok('the board refresh runs AFTER the modal is closed (no repaint into an open picker)'); else bad('refresh ran with the modal still open', JSON.stringify(result.loadCalledWithModalHidden));

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 4) { console.log('addmem-flash: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('addmem-flash: ' + failures + ' FAILED'); process.exit(1); }
  console.log('addmem-flash: all good, ' + ran + ' checks');
})();
