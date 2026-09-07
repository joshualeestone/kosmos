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
 *   4. #3/#4 half (a): the grant lands LATE (after the ungranted scan). An ungranted
 *      scan runs the bare route and ARMS a light /api/file-access-status poll on S9; when
 *      the grant flips true, the poll re-runs frScanAgents via /api/scan-import, the
 *      Documents agent appears, and the poll STOPS after one flip. Control: a scan already
 *      granted at scan time arms no poll. Scenario 5: a RETURN render of S9 re-arms the poll
 *      (the poll is armed from frPaintFleet's create arm, so a Back -> forward return with
 *      FR_SCAN already populated still re-arms). Scenario 6: the re-scan DEFERS while focus is
 *      inside #fr-fleet (no repaint over in-progress work) and resumes once focus leaves.
 *      Scenario 7: the UNKNOWN arm (tmux roster unreadable) also arms the poll and re-scans on
 *      a late grant -- the re-scan covers every S9 arm that reads the disk, not just create.
 *      Scenario 8: a transient /api/scan-import hiccup at the grant edge keeps FR_SCAN_FULL false
 *      and the poll RETRYING (not foreclosed), then succeeds once the scan recovers.
 *   5. #3/#4 half (b): the import scan is two-phase. Scenario 9: a scanning:true response shows the
 *      partial (non-TCC) rows immediately, not marked full, and the retry lands the complete set
 *      (TCC rows) and marks it full. Scenario 10: bounded.tccUnavailable is a COMPLETE scan (full,
 *      single call, no retry loop) that shows a "could not scan Documents" hint.
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
    // Network-level resource-load noise is not a page/JS error (uncaught exceptions come via
    // pageerror above). The 500 tolerance is scoped to scenario 8 (which deliberately makes
    // /api/scan-import return 500 to exercise the hiccup-retry path) via expect500 -- so
    // scenarios 1-7 still catch an UNEXPECTED 500 from any endpoint. expect500 is set once at
    // scenario 8's start and never reset (scenario 8 is last), which also avoids racing the
    // async console event against scanImportFail flipping back to false.
    let expect500 = false;
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_FILE_NOT_FOUND|favicon|status 404/.test(t)) return;
      if (expect500 && /status of 500/.test(t)) return;
      errs.push(t);
    });

    /* Which scan route frScanAgents actually reached. Reset before each scenario;
       the route handlers push their own name so an assertion can tell scan-import
       (TCC-reaching) from scan-agents (bare) rather than inferring from output. */
    const hits = { scanImport: 0, scanAgents: 0 };
    let grant = { checkable: false };            // mutated per scenario
    let importCandidates = [];                    // agent FOLDERS scan-import returns
    let importFiles = [];                         // #4: loose agent FILES scan-import returns
    let scanImportFail = false;                   // scenario 8: make the granted scan hiccup
    let scanImportScanningLeft = 0;               // #3/#4(b) sc.9: return scanning:true this many times first
    let importCandidatesPartial = [];             // #3/#4(b): the non-TCC rows shown while scanning:true
    let importBounded = {};                       // #3/#4(b) sc.10: e.g. { tccUnavailable: true }

    await p.route('**/api/file-access-status', (r) => r.fulfill({ json: grant }));
    await p.route('**/api/scan-import', (r) => {
      hits.scanImport++;
      // scenario 8: a transient hiccup at the grant edge -> res.ok false -> frScanAgents out=null
      if (scanImportFail) { r.fulfill({ status: 500, json: { ok: false } }); return; }
      // #3/#4(b) scenario 9: the two-phase partial -- non-TCC rows now, scanning:true, hatch pending.
      if (scanImportScanningLeft > 0) {
        scanImportScanningLeft--;
        r.fulfill({ json: { ok: true, candidates: importCandidatesPartial, importable: [], bounded: {}, scanning: true } });
        return;
      }
      r.fulfill({ json: { ok: true, candidates: importCandidates, importable: importFiles, bounded: importBounded } });
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
        importRows: box ? box.querySelectorAll('.fr-importrow').length : 0,
        importGo: box ? box.querySelectorAll('.fr-importrow .fr-importgo').length : 0,
        offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1,
        importOffer: (typeof frImportOffer === 'function') ? frImportOffer().length : -1,
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

    // ── 1b. #4 (Josh 0.6.42): the LOOSE agent FILES also load onto screen 9. ──
    // Josh loaded 7 agent files into Documents/Downloads; before this, the screen
    // rendered only agent FOLDERS (candidates) and dumped him to "Create your first
    // agent," while the separate Import screen found the files. Now the scan's loose
    // `importable` files render on THIS screen with a one-click Import button.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: true, at: Date.now() };
    importCandidates = [];   // NO folders, only loose files -- the exact shape that dumped Josh to "create your first agent"
    importFiles = [
      { file: '/Users/x/Documents/1-kosmos-created.md', name: 'Fixture Baron', role: 'a test fixture', preview: 'You are Fixture Baron.' },
      { file: '/Users/x/Documents/4-codex-AGENTS.md', name: 'Fixture Codex', role: 'OpenAI-run agent', preview: 'You are Fixture Codex.' },
      { file: '/Users/x/Downloads/6-second-profile-agent.md', name: 'Fixture Work1', role: 'second-profile agent', preview: 'You are Fixture Work1.' },
    ];
    await runScan();
    const gi = await readScreen();
    if (gi.importOffer === 3) ok('#4: the loose importable files become the screen-9 offer (importOffer=3)'); else bad('#4 importOffer', JSON.stringify(gi));
    if (gi.importRows === 3 && gi.importGo === 3) ok('#4: the 3 loose agent FILES render on screen 9, each with a one-click Import button'); else bad('#4 rendered import rows', JSON.stringify(gi));
    if (/We found 3 agents on this computer/i.test(gi.title)) ok('#4: screen 9 counts the loose files ("We found 3 agents on this computer.")'); else bad('#4 title', JSON.stringify(gi.title));
    if (!/Create your first agent/i.test(gi.title)) ok('#4: it does NOT dump the person to "Create your first agent" when only loose files exist (the bug)'); else bad('#4 must not be the empty state', JSON.stringify(gi.title));

    // ── 1c. #4 CONTROL: found none + no candidates + no importable -> the honest
    // empty state is UNTOUCHED (frPaintFleet still lands on "Create your first agent"). ──
    hits.scanImport = 0; hits.scanAgents = 0;
    importCandidates = []; importFiles = [];
    await p.evaluate(async () => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = null; FR_SCAN_GEN = 0;
      await frScanAgents();
      frPaintFleet();   // the dispatcher decides scan-screen vs create-empty
    });
    const ge = await p.evaluate(() => (document.getElementById('fr-fleet-title') || {}).textContent || '');
    if (/Create your first agent/i.test(ge)) ok('#4 CONTROL: with truly nothing found, the honest "Create your first agent" empty state is untouched'); else bad('#4 empty-state control', JSON.stringify(ge));

    // ── 2. CONTROL (declined): granted:false -> bare scan, NO TCC import walk. ──
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };
    importCandidates = [];
    await runScan();
    if (hits.scanAgents === 1 && hits.scanImport === 0) ok('CONTROL declined: the TCC-walking import scan NEVER fires without a grant (#2125 no-ambush)'); else bad('CONTROL declined uses bare scan', 'scanImport=' + hits.scanImport + ' scanAgents=' + hits.scanAgents);
    // This ungranted scan armed the grant-flip poll; retire it so the next scenario arms its
    // OWN poll (else scenario 4's fast FR_RESCAN_INTERVAL_MS is inert -- frArmRescanOnGrant
    // early-returns on the leaked timer and scenario 4 would ride this stale 1500ms poll).
    await p.evaluate(() => frRescanStop());

    // ── 3. CONTROL (uncheckable, e.g. a browser with no native writer). ──
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: false, because: 'no native writer' };
    await runScan();
    if (hits.scanAgents === 1 && hits.scanImport === 0) ok('CONTROL uncheckable: an unmeasured grant keeps the bare TCC-free scan'); else bad('CONTROL uncheckable uses bare scan', 'scanImport=' + hits.scanImport + ' scanAgents=' + hits.scanAgents);
    await p.evaluate(() => frRescanStop());   // same isolation: retire this scenario's armed poll

    // ── 4. #3/#4 half (a): a grant that lands AFTER the ungranted scan triggers a re-scan. ──
    // Josh 0.6.42 #4: he granted file-access on S2, but the macOS TCC write propagated a beat
    // late and he had already reached S9, so frScanAgents ran TCC-free and his Documents
    // agents were missing ("it never showed me the agents on the path"). A light S9 poll of
    // /api/file-access-status re-runs frScanAgents on the not-granted -> granted EDGE. Kitty's
    // engine half (b) makes the granted walk read under the app-exe hatch identity; both sit
    // behind /api/scan-import, so this front-end retry inherits her fix when it lands.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };   // NOT granted at scan time
    importCandidates = [
      { dir: '/Users/x/Documents/late-monitor', name: 'Late monitor', role: 'Watches late', preview: 'You watch late.' },
    ];
    importFiles = [];
    await p.evaluate(() => { FR_RESCAN_INTERVAL_MS = 20; });   // fast poll: observe the flip without real seconds
    await runScan();   // ungranted -> bare scan (no candidates), and ARMS the grant-flip poll
    const b4 = await p.evaluate(() => ({
      onS9: FR_STEP === FR_STEP_YOU + 1,
      armed: FR_RESCAN_TIMER !== null,
      full: FR_SCAN_FULL,
      offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1,
    }));
    if (b4.onS9 && !b4.full && b4.armed && hits.scanAgents === 1 && hits.scanImport === 0 && b4.offer === 0)
      ok('#3/#4(a): an ungranted scan runs the bare scan, finds nothing, and ARMS the grant-flip poll');
    else bad('#3/#4(a) armed after ungranted scan', JSON.stringify({ b4, hits }));

    // The grant lands (async S2 propagation). The poll must see the edge and re-scan.
    // Ensure focus is OUTSIDE #fr-fleet so the focus-defer guard (scenario 6) does not hold
    // this re-scan; this scenario tests the plain edge, scenario 6 tests the defer.
    await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    grant = { checkable: true, granted: true, at: Date.now() };
    // 500ms timeout, deliberately BELOW the 1500ms default interval: this only passes if
    // scenario 4 armed its OWN fast (20ms) poll. If a stale 1500ms poll leaked in from an
    // earlier scenario (the isolation bug), the flip would not be caught within 500ms and this
    // reds -- so the FR_RESCAN_INTERVAL_MS=20 knob is proven live, not inert.
    await p.waitForFunction(() => FR_SCAN_FULL === true, null, { timeout: 500 }).catch(() => {});
    const a4 = await p.evaluate(() => ({
      stopped: FR_RESCAN_TIMER === null,
      full: FR_SCAN_FULL,
      offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1,
      rows: document.getElementById('fr-fleet').querySelectorAll('.fr-scanrow').length,
      title: (document.getElementById('fr-fleet-title') || {}).textContent || '',
    }));
    if (hits.scanImport === 1) ok('#3/#4(a): the grant edge re-runs frScanAgents via the granted /api/scan-import'); else bad('#3/#4(a) re-scan uses import route', 'scanImport=' + hits.scanImport + ' scanAgents=' + hits.scanAgents);
    if (a4.full) ok('#3/#4(a): the re-scan is recorded as the granted route (FR_SCAN_FULL true)'); else bad('#3/#4(a) FR_SCAN_FULL after flip', JSON.stringify(a4));
    if (a4.offer === 1 && a4.rows === 1) ok('#3/#4(a): the late-granted Documents agent now renders on screen 9'); else bad('#3/#4(a) late agent renders', JSON.stringify(a4));
    if (a4.stopped) ok('#3/#4(a): the poll stops after ONE flip (no unbounded polling)'); else bad('#3/#4(a) poll stops after flip', JSON.stringify(a4));

    // ── 4b. CONTROL: grant already TRUE at scan time -> NO poll armed (no needless polling). ──
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: true, at: Date.now() };
    importCandidates = []; importFiles = [];
    await runScan();
    const c4 = await p.evaluate(() => ({ armed: FR_RESCAN_TIMER !== null, full: FR_SCAN_FULL }));
    if (!c4.armed && c4.full) ok('#3/#4(a) CONTROL: a scan already granted at scan time arms NO poll'); else bad('#3/#4(a) no-poll-when-granted', JSON.stringify(c4));

    // ── 5. #3/#4(a): a RETURN to S9 re-arms the poll (the Back-button hole). ──
    // The poll is armed from frPaintFleet's create arm, not only frScanAgents, so a second
    // S9 render (FR_SCAN already populated, no fresh scan) re-arms it. Without that, a grant
    // landing during a Back -> forward return visit would be silently missed.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };   // ungranted
    importCandidates = []; importFiles = [];
    await p.evaluate(() => { FR_RESCAN_INTERVAL_MS = 20; });
    await runScan();                                          // ungranted scan -> arms
    const armed5 = await p.evaluate(() => FR_RESCAN_TIMER !== null);
    await p.evaluate(() => { frRescanStop(); });             // simulate leaving S9 (frGo does this)
    const stopped5 = await p.evaluate(() => FR_RESCAN_TIMER === null);
    // Return to S9: FR_STEP is still the fleet step, FR_SCAN is populated (ungranted), so NO
    // fresh scan runs -- only a re-render. frPaintFleet's create arm must re-arm the poll.
    await p.evaluate(() => { frPaintFleet(); });
    const rearmed5 = await p.evaluate(() => FR_RESCAN_TIMER !== null && FR_SCAN_FULL === false);
    await p.evaluate(() => { frRescanStop(); });             // clean up before the next scenario
    if (armed5 && stopped5 && rearmed5) ok('#3/#4(a): a RETURN render of S9 re-arms the poll (Back-button hole closed)'); else bad('#3/#4(a) return re-arm', JSON.stringify({ armed5, stopped5, rearmed5 }));

    // ── 6. #3/#4(a): the re-scan DEFERS while focus is inside #fr-fleet, then resumes. ──
    // The re-scan does a full #fr-fleet repaint; doing it while the person is typing in a
    // fleet input (or a row is mid-submit, focus on its button) would discard that work. The
    // poll must skip the flip while focus is inside #fr-fleet and re-scan once it leaves.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };   // ungranted
    importCandidates = []; importFiles = [];
    await p.evaluate(() => { FR_RESCAN_INTERVAL_MS = 20; });
    await runScan();                                          // ungranted scan -> arms
    // Put focus INSIDE #fr-fleet, then land the grant. The poll must NOT re-scan yet.
    await p.evaluate(() => {
      const fleet = document.getElementById('fr-fleet');
      let inp = document.getElementById('__test-fleet-input');
      if (!inp) { inp = document.createElement('input'); inp.id = '__test-fleet-input'; fleet.appendChild(inp); }
      inp.focus();
    });
    grant = { checkable: true, granted: true, at: Date.now() };
    await new Promise((r) => setTimeout(r, 120));            // several 20ms poll ticks
    const held6 = await p.evaluate(() => ({
      focusInFleet: document.getElementById('fr-fleet').contains(document.activeElement),
      armed: FR_RESCAN_TIMER !== null,
      full: FR_SCAN_FULL,
    }));
    if (held6.focusInFleet && held6.armed && !held6.full && hits.scanImport === 0)
      ok('#3/#4(a): the re-scan DEFERS while focus is inside #fr-fleet (no repaint over in-progress work)');
    else bad('#3/#4(a) defer while focused', JSON.stringify({ held6, hits }));
    // Move focus out; the next tick must re-scan and stop.
    await p.evaluate(() => { const i = document.getElementById('__test-fleet-input'); if (i) { i.blur(); i.remove(); } });
    await p.waitForFunction(() => FR_SCAN_FULL === true, null, { timeout: 3000 }).catch(() => {});
    const resumed6 = await p.evaluate(() => ({ full: FR_SCAN_FULL, stopped: FR_RESCAN_TIMER === null }));
    if (hits.scanImport === 1 && resumed6.full && resumed6.stopped) ok('#3/#4(a): once focus leaves #fr-fleet the deferred re-scan runs and the poll stops'); else bad('#3/#4(a) resume after blur', JSON.stringify({ resumed6, scanImport: hits.scanImport }));

    // ── 7. #3/#4(a): the UNKNOWN arm (tmux roster unreadable) also re-scans on a late grant. ──
    // frArmRescanOnGrant is called from BOTH the create arm and the unknown arm, so a person
    // whose roster could not be read (disk is their only source -- the more important case)
    // still gets the late-granted Documents agents.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };   // ungranted
    importCandidates = [
      { dir: '/Users/x/Documents/unknown-arm-agent', name: 'Unknown-arm agent', role: 'watches', preview: 'You watch.' },
    ];
    importFiles = [];
    await p.evaluate(async () => {
      FR_RESCAN_INTERVAL_MS = 20;
      FR = { path: 'unknown' };                                   // tmux roster unreadable
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = null; FR_SCAN_GEN = 0; FR_SCAN_FULL = false;
      frRescanStop();
      await frScanAgents();                                       // ungranted bare scan; repaint arms the poll on the unknown arm
    });
    const u7armed = await p.evaluate(() => FR_RESCAN_TIMER !== null && FR_SCAN_FULL === false);
    await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    grant = { checkable: true, granted: true, at: Date.now() };
    await p.waitForFunction(() => FR_SCAN_FULL === true, null, { timeout: 3000 }).catch(() => {});
    const u7 = await p.evaluate(() => ({ full: FR_SCAN_FULL, offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1, stopped: FR_RESCAN_TIMER === null }));
    if (u7armed && hits.scanImport === 1 && u7.full && u7.offer === 1 && u7.stopped)
      ok('#3/#4(a): the UNKNOWN arm (tmux unreadable) also arms the poll and re-scans on a late grant');
    else bad('#3/#4(a) unknown-arm re-scan', JSON.stringify({ u7armed, u7, hits }));

    // ── 8. #3/#4(a): a transient granted-scan hiccup does NOT foreclose the retry. ──
    // If /api/scan-import fails at the grant edge, FR_SCAN_FULL must stay false and the poll
    // must keep retrying (throttled), then succeed once the scan recovers. Without this, one
    // hiccup sets FR_SCAN_FULL true forever and the late-grant person silently loses their agents.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: false, at: Date.now() };   // ungranted
    importCandidates = [
      { dir: '/Users/x/Documents/hiccup-agent', name: 'Hiccup agent', role: 'watches', preview: 'You watch.' },
    ];
    importFiles = [];
    expect500 = true;                                              // scope the 500 console-noise tolerance to this scenario onward
    scanImportFail = true;                                          // the granted re-scan will hiccup
    await p.evaluate(async () => {
      FR_RESCAN_INTERVAL_MS = 20;
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = null; FR_SCAN_GEN = 0; FR_SCAN_FULL = false;
      frRescanStop();
      await frScanAgents();                                        // ungranted bare scan; repaint arms the poll
    });
    await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    grant = { checkable: true, granted: true, at: Date.now() };    // grant lands, but scan-import hiccups
    await new Promise((r) => setTimeout(r, 150));                   // several fast ticks try + fail the re-scan
    const hic = await p.evaluate(() => ({ full: FR_SCAN_FULL, armed: FR_RESCAN_TIMER !== null }));
    if (!hic.full && hic.armed && hits.scanImport >= 1)
      ok('#3/#4(a): a granted-scan hiccup keeps FR_SCAN_FULL false and the poll RETRYING (not foreclosed)');
    else bad('#3/#4(a) hiccup keeps retrying', JSON.stringify({ hic, scanImport: hits.scanImport }));
    scanImportFail = false;                                         // the scan recovers
    await p.waitForFunction(() => FR_SCAN_FULL === true, null, { timeout: 2000 }).catch(() => {});
    const rec = await p.evaluate(() => ({ full: FR_SCAN_FULL, stopped: FR_RESCAN_TIMER === null, offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1 }));
    if (rec.full && rec.stopped && rec.offer === 1) ok('#3/#4(a): once the granted scan recovers, the re-scan succeeds, the poll stops, and the agent renders'); else bad('#3/#4(a) recovers after hiccup', JSON.stringify(rec));

    // ── 9. #3/#4(b): scanning:true shows the partial rows, then the retry lands the complete set. ──
    // The granted /api/scan-import is two-phase: the first call returns the non-TCC rows with
    // scanning:true (hatch pending), the retry returns the complete set. The partial must show
    // immediately and NOT be marked full; the retry must land the TCC rows and mark it full.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: true, at: Date.now() };
    scanImportFail = false;
    scanImportScanningLeft = 1;                                     // first call partial, second complete
    importCandidatesPartial = [{ dir: '/Users/x/Downloads/quick-agent', name: 'Quick agent', role: 'r', preview: 'p' }];
    importCandidates = [
      { dir: '/Users/x/Downloads/quick-agent', name: 'Quick agent', role: 'r', preview: 'p' },
      { dir: '/Users/x/Documents/late-doc-agent', name: 'Late doc agent', role: 'r', preview: 'p' },
    ];
    importFiles = []; importBounded = {};
    await p.evaluate(() => { FR_IMPORT_RETRY_MS = 150; });          // partial visible long enough to observe
    await p.evaluate(() => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = null; FR_SCAN_GEN = 0; FR_SCAN_FULL = false;
      frRescanStop();
      frScanAgents();                                              // NOT awaited: observe partial then complete
    });
    const sawPartial = await p.waitForFunction(() => typeof frScanOffer === 'function' && frScanOffer().length === 1 && FR_SCAN_FULL === false, null, { timeout: 1200 }).then(() => true).catch(() => false);
    const sawComplete = await p.waitForFunction(() => typeof frScanOffer === 'function' && frScanOffer().length === 2 && FR_SCAN_FULL === true, null, { timeout: 2500 }).then(() => true).catch(() => false);
    const s9 = await p.evaluate(() => ({ offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1, full: FR_SCAN_FULL, stopped: FR_RESCAN_TIMER === null }));
    if (sawPartial) ok('#3/#4(b): scanning:true shows the partial (non-TCC) rows immediately, not marked full'); else bad('#3/#4(b) partial shown', JSON.stringify({ sawPartial, s9, scanImport: hits.scanImport }));
    if (sawComplete && hits.scanImport === 2) ok('#3/#4(b): the retry lands the complete set (TCC rows) and marks it full'); else bad('#3/#4(b) retry completes', JSON.stringify({ sawComplete, scanImport: hits.scanImport, s9 }));

    // ── 10. #3/#4(b): bounded.tccUnavailable is a COMPLETE scan (full, no retry loop) + a hint. ──
    // The protected folders could not be read (no app / hatch gave up), but the scan is DONE
    // (scanning falsey), so it is full (the poll stops -- retrying would not help until a later
    // re-scan), and the screen shows a "could not scan Documents" hint rather than a spinner.
    hits.scanImport = 0; hits.scanAgents = 0;
    grant = { checkable: true, granted: true, at: Date.now() };
    scanImportScanningLeft = 0;
    importCandidates = [{ dir: '/Users/x/work/local-agent', name: 'Local agent', role: 'r', preview: 'p' }];
    importFiles = []; importBounded = { tccUnavailable: true };
    await p.evaluate(async () => {
      FR = { path: 'create', fleetCount: 0 };
      FR_FOUND = { ok: true, agents: [], adoptable: [] };
      FR_SCAN = null; FR_SCAN_GEN = 0; FR_SCAN_FULL = false;
      frRescanStop();
      await frScanAgents();                                        // awaited: one complete call (no scanning)
    });
    const s10 = await p.evaluate(() => ({
      full: FR_SCAN_FULL,
      offer: (typeof frScanOffer === 'function') ? frScanOffer().length : -1,
      hint: /Could not scan Documents/i.test((document.getElementById('fr-fleet') || {}).innerHTML || ''),
      stopped: FR_RESCAN_TIMER === null,
    }));
    if (s10.full && hits.scanImport === 1) ok('#3/#4(b): tccUnavailable is a COMPLETE scan (full, single call, no retry loop)'); else bad('#3/#4(b) tccUnavailable complete', JSON.stringify({ s10, scanImport: hits.scanImport }));
    if (s10.hint && s10.offer === 1) ok('#3/#4(b): tccUnavailable shows the "could not scan Documents" hint alongside the rows found'); else bad('#3/#4(b) tccUnavailable hint', JSON.stringify(s10));

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 28) { console.log('scan-on-grant: only ' + ran + ' checks ran (expected 28), so a check was skipped -- proving nothing'); process.exit(1); }
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
