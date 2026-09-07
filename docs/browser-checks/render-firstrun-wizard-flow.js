'use strict';
/* The first-run wizard, driven END-TO-END as one flow (screens 1..9).
 *
 * Every install fix merged separately -- #1/#2 grant+gating, #3 connect, #4 import,
 * #5 find-agents + load-onto-screen-9, #9-12 copy -- but the COMBINED flow was never
 * verified as a whole, and screen INTERACTION is exactly what broke the 0.6.39 test
 * (a stuck transition left steps unreachable; a gate that wrongly blocked would strand
 * the flow). The isolated checks (render-gated-next, render-firstrun-*, the
 * scan-on-grant unit check) each prove one screen; this proves they cohere when a
 * person actually clicks Next from Welcome to the end.
 *
 * Self-boots a sandboxed server and CLICKS Next through the flow (never deep-links --
 * a deep link skips the transition logic that is the thing under test). The permission
 * status + scan endpoints are mocked so the flow proceeds WITHOUT the real macOS TCC
 * grant (which is an operator fresh-install pass, #2243); everything ELSE is exercised.
 *
 *   GRANTED: 1..9 all advance on a Next click (no stuck transition), and S9 loads the
 *            found agent via the granted import scan (#1652 / #2349) -- proving the
 *            detection wiring works in the integrated flow, not just in isolation.
 *   NOT-GRANTED: the S2 file-access gate BLOCKS (Next disabled) and the flow cannot
 *            advance past S2 -- the fail-safe gate cohering mid-wizard.
 *   FINISH: clicking the S9 primary fires /api/first-run/complete (the terminal step).
 *
 * DOM-state + which-endpoint assertions, so headless is fine.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-firstrun-wizard-flow.js
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

/* Route the permission/scan endpoints for one context. `fileAccessGranted` toggles
   the S2 gate (and, when granted, the scan route my #1652/#2349 detection uses). */
async function routeFlow(page, { fileAccessGranted, completeHit }) {
  // nativePresent:true -- this flow drives a real install, where the native app is
  // present, so the S2 gate keys on nativePresent + !granted (kosmos#2347). Without
  // it the NOT-GRANTED arm would no longer block, since file-access blocks on the
  // presence signal now, not on checkable alone.
  await page.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: fileAccessGranted, nativePresent: true, at: Date.now() } }));
  await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: true } }));
  await page.route('**/api/a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: true } }));
  await page.route('**/api/found-agents', (r) => r.fulfill({ json: { ok: true, agents: [], adoptable: [] } }));
  await page.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [], importable: [], bounded: {} } }));
  await page.route('**/api/scan-import', (r) => r.fulfill({ json: { ok: true, candidates: [
    { dir: '/Users/x/Documents/site-monitor', name: 'Site monitor', role: 'Watches the site', preview: 'You watch the site.' },
  ], importable: [], bounded: {} } }));
  await page.route('**/api/first-run/complete', (r) => { completeHit.n += 1; r.fulfill({ json: { ok: true } }); });
}

const readStep = (page) => page.evaluate(() => (typeof FR_STEP !== 'undefined') ? FR_STEP : null);

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'wzf-' + k.toLowerCase() + '-'));
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1300));

  // browser.launch is INSIDE the try so a launch throw still runs the finally that
  // kills the spawned server (a launch outside the try leaks server.js + its port).
  let browser = null;
  try {
    browser = await chromium.launch({ headless: process.env.HEADED === '0' });
    // ── GRANTED: drive the whole flow 1..9 by clicking Next. ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|status 404/.test(m.text())) errs.push(m.text()); });
      const completeHit = { n: 0 };
      await routeFlow(page, { fileAccessGranted: true, completeHit });
      await page.goto(`http://127.0.0.1:${PORT}/?first-run=1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      let start = await readStep(page);
      if (start === 1) ok('GRANTED: the flow starts at step 1 (Welcome)'); else bad('GRANTED start step', 'FR_STEP=' + start);

      let stuck = null;
      for (let i = 0; i < 12; i += 1) {
        const before = await readStep(page);
        if (before === 9) break;
        if (before === 8) {
          await page.evaluate(() => {
            const n = document.getElementById('fr-you-name'); if (n) { n.value = 'Alex'; n.dispatchEvent(new Event('input', { bubbles: true })); }
            const d = document.getElementById('fr-you-do'); if (d) { d.value = 'I run a company.'; d.dispatchEvent(new Event('input', { bubbles: true })); }
          });
        }
        // Wait for a gated/required screen to enable its primary before clicking.
        await page.waitForFunction(() => { const n = document.getElementById('fr-next'); return n && !n.disabled && !n.hidden; }, null, { timeout: 5000 }).catch(() => {});
        const clickable = await page.evaluate(() => {
          for (const id of ['fr-next', 'fr-alt']) { const b = document.getElementById(id); if (b && !b.hidden && !b.disabled) return id; }
          return null;
        });
        if (!clickable) { stuck = before; break; }
        await page.click('#' + clickable);
        await page.waitForFunction((b) => (typeof FR_STEP !== 'undefined') && FR_STEP !== b, before, { timeout: 5000 }).catch(() => {});
        const after = await readStep(page);
        if (after === before) { stuck = before; break; }
      }
      const finalStep = await readStep(page);
      if (finalStep === 9 && stuck === null) ok('GRANTED: every Next advances -- the flow reaches S9 with no stuck transition'); else bad('GRANTED flow reaches S9', 'stopped at step ' + (stuck || finalStep));

      // S9 loads the found agent (granted import scan -> frPaintScan), #1652/#2349 in-flow.
      // Wait for the row to actually appear rather than a fixed sleep: the found/scan
      // fetches are async, and a waitForFunction fails RED (never false-green) if the
      // agent never loads.
      await page.waitForFunction(() => {
        const box = document.getElementById('fr-fleet');
        return !!(box && box.querySelectorAll('.fr-scanrow, .fr-foundrow').length >= 1);
      }, null, { timeout: 6000 }).catch(() => {});
      const s9 = await page.evaluate(() => {
        const title = document.getElementById('fr-fleet-title');
        const box = document.getElementById('fr-fleet');
        return { title: title ? title.textContent.trim() : '', rows: box ? box.querySelectorAll('.fr-scanrow, .fr-foundrow').length : 0 };
      });
      if (/We found an agent on this computer/i.test(s9.title) && s9.rows === 1) ok('GRANTED: S9 loads the found agent via the granted scan (#1652/#2349 works in the integrated flow)'); else bad('GRANTED S9 loads found agent', JSON.stringify(s9));

      // The terminal step: clicking the S9 primary completes first-run. Poll the
      // node-side completeHit counter (the route records the POST) rather than a fixed
      // sleep -- it resolves as soon as the request lands and fails RED if it never does.
      const s9click = await page.evaluate(() => { const b = document.getElementById('fr-next'); if (b && !b.hidden && !b.disabled) { b.click(); return true; } return false; });
      if (s9click) { for (let w = 0; w < 40 && completeHit.n === 0; w += 1) await page.waitForTimeout(50); }
      if (completeHit.n >= 1) ok('GRANTED: the S9 primary fires /api/first-run/complete (the flow terminates)'); else bad('GRANTED finish fires complete', 'complete hit ' + completeHit.n + ' times, s9click=' + s9click);

      if (!errs.length) ok('GRANTED: no page errors across the whole 1..9 flow'); else bad('GRANTED no page errors', errs.join(' | '));
      await ctx.close().catch(() => {});   // a cleanup throw must not RED a passing check (false-red guard, iter-2 NIT)
    }

    // ── NOT-GRANTED: the S2 gate blocks the flow. ──
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
      const page = await ctx.newPage();
      const completeHit = { n: 0 };
      await routeFlow(page, { fileAccessGranted: false, completeHit });
      await page.goto(`http://127.0.0.1:${PORT}/?first-run=1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      // Welcome -> permission (S2).
      await page.evaluate(() => { const b = document.getElementById('fr-next'); if (b && !b.disabled) b.click(); });
      await page.waitForFunction(() => (typeof FR_STEP !== 'undefined') && FR_STEP === 2, null, { timeout: 5000 }).catch(() => {});
      // Let the gate poll land its measured-not-granted verdict.
      await page.waitForTimeout(900);
      const atS2 = await readStep(page);
      const nextDisabled = await page.evaluate(() => { const n = document.getElementById('fr-next'); return !!(n && n.disabled); });
      if (atS2 === 2 && nextDisabled) ok('NOT-GRANTED: the S2 file-access gate disables Next (blocks the flow mid-wizard)'); else bad('NOT-GRANTED S2 gate blocks', 'step=' + atS2 + ' nextDisabled=' + nextDisabled);
      /* The person is HELD at S2: a disabled Next is inert (a click dispatches
         nothing), so the flow cannot progress. This does NOT independently prove the
         go() re-check -- that re-check keys on the same disabled attribute this arm
         already asserted; the mechanism-proof is the `nextDisabled` assertion above,
         and the GRANTED arm proves the gate is not permanently stuck. This is the
         "still held" corollary, not a second mechanism. */
      await page.evaluate(() => { const n = document.getElementById('fr-next'); if (n) n.click(); });
      await page.waitForTimeout(300);
      const stillS2 = await readStep(page);
      if (stillS2 === 2) ok('NOT-GRANTED: the flow stays held at S2 (a disabled Next is inert)'); else bad('NOT-GRANTED stays held at S2', 'advanced to step ' + stillS2);
      await ctx.close().catch(() => {});   // a cleanup throw must not RED a passing check (false-red guard, iter-2 NIT)
    }
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    for (const d of Object.values(roots)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* /tmp, best-effort */ } }
  }

  if (ran < 7) { console.log('wizard-flow: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('wizard-flow: ' + failures + ' FAILED'); process.exit(1); }
  console.log('wizard-flow: all good, ' + ran + ' checks');
})().catch((e) => { console.error('FAIL  render-firstrun-wizard-flow threw: ' + ((e && e.stack) || e)); process.exit(1); });
