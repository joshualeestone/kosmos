/* #1043: Settings stays on the same line as the project title and the search.
 *
 * Josh, 2026-08-26 18:29 CT: "The 'settings' should still be visible then on
 * the same line as the title and search". The word STILL is the whole card --
 * it is a requirement that the row SURVIVES, and survival is the one thing a
 * one-off look cannot establish.
 *
 * ⚠️ WHY THIS FILE EXISTS RATHER THAN A CSS EDIT. When this was filed the row
 * was ALREADY correct: placeProjectHead() (f731a69, 08-25) moves .pjhead into
 * .pjmidhead in every layout, and #pj-settings-link rides along inside it. So
 * there was nothing to move. What was missing was any assertion that it stays:
 * five existing checks CLICK #pj-settings-link and one waits for it visible,
 * and not one of them looks at where it sits. A control can be visible, on its
 * own line, and satisfy every one of them.
 *
 * ⭐ SO THE DELIVERABLE IS THE PIN, NOT A PIXEL. The next person to restyle
 * that header finds out here instead of from Josh.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-head-row.js
 * Sandboxed roots; kills only what it starts.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0;
let ran = 0;
const ok = (name) => { ran++; console.log('PASS  ' + name); };
const bad = (name, why) => { ran++; failures++; console.log('FAIL  ' + name + '  --  ' + why); };

/* Two boxes are on one line when their vertical spans overlap. Not "equal
   tops": the title is larger than the link, so their tops legitimately differ
   by several pixels while the eye reads one row. Overlap of at least half the
   SHORTER box is what "same line" means to a person. */
function sameLine(a, b) {
  if (!a || !b) return false;
  const top = Math.max(a.y, b.y);
  const bot = Math.min(a.y + a.height, b.y + b.height);
  const overlap = bot - top;
  return overlap >= Math.min(a.height, b.height) * 0.5;
}

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-' + k.toLowerCase() + '-'));
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

  const b = await chromium.launch();
  const errs = [];

  /* Opens a project and hands back the three boxes that must share a row. */
  /* ⚠️ THE TITLE HERE IS THE BLOCK (.pjtitle), NOT THE TITLE TEXT.
     Measured at 961px: when the description wraps to two lines the block gets
     taller and `align-items: center` centres Settings and the search against
     the WHOLE block, so they sit below the title's own text by design. A first
     version of this file compared against #pj-one-name and failed there --
     a real, intended layout reported as a defect.
     📌 The block is still the honest subject: if Settings ever dropped onto its
     own line it would stop overlapping the block entirely, which is exactly
     what the 700px control proves this can still see. */
  async function boxes(p) {
    const title = await p.locator('#pj-one-view .pjtitle').first().boundingBox();
    const gear = await p.locator('#pj-settings-link').boundingBox();
    const search = await p.locator('#pj-room-search').boundingBox();
    return { title, gear, search };
  }

  /* `create` is false for the second page: the project is already there, and
     the create route rightly refuses a duplicate name. Asking for it twice
     failed the whole arm on the FIXTURE, which reads exactly like the header
     being broken. */
  async function openProject(p, create) {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    if (create) {
      await p.evaluate(async () => {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Head Row' }) });
        if (!r.ok) throw new Error('fixture create failed');
      });
    }
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Head Row').first().click();
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
  }

  try {
    /* ---- 1. the tab view, the layout Josh is actually running ---- */
    let p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p.on('pageerror', (e) => errs.push(String(e)));
    await openProject(p, true);
    let bx = await boxes(p);
    if (!bx.gear) bad('tab view: Settings is visible at all', 'it has no box');
    else ok('tab view: Settings is visible at all');
    if (sameLine(bx.title, bx.gear)) ok('tab view: Settings shares the title\'s line');
    else bad('tab view: Settings shares the title\'s line', JSON.stringify({ title: bx.title, gear: bx.gear }));
    if (sameLine(bx.gear, bx.search)) ok('tab view: Settings shares the search\'s line');
    else bad('tab view: Settings shares the search\'s line', JSON.stringify({ gear: bx.gear, search: bx.search }));

    /* ---- 2. NEGATIVE CONTROL, run not assumed ----
       🛑 A row check that cannot report "not one row" is decoration. The
       stylesheet stacks this header under 760px on purpose, so a narrow window
       is a state where the honest answer is FALSE. If this arm reports the
       boxes still sharing a line, the measurement is broken and every PASS
       above is worthless. */
    await p.setViewportSize({ width: 700, height: 900 });
    await p.waitForTimeout(250);
    const narrow = await boxes(p);
    if (!sameLine(narrow.title, narrow.gear)) ok('CONTROL: stacked at 700px reads as NOT one line');
    else bad('CONTROL: stacked at 700px reads as NOT one line',
      'the check reported one row where the CSS stacks them, so it cannot fail: ' + JSON.stringify(narrow));
    await p.close();

    /* ---- 3. the consolidated view, the one the mock draws ---- */
    p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errs.push(String(e)));
    await openProject(p, false);
    await p.evaluate(async () => {
      await fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layout: 'consolidated' }) });
    });
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.click('[data-tab="projects"]').catch(() => {});
    await p.locator('#pj-list').getByText('Head Row').first().click().catch(() => {});
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
    /* A control on the control: if the layout did not actually switch, every
       assertion below is about the tab view wearing another name. */
    const isCons = await p.evaluate(() => document.body.classList.contains('consolidated'));
    if (isCons) ok('consolidated: the layout actually switched');
    else bad('consolidated: the layout actually switched', 'body is not .consolidated, so arm 3 tested the tab view again');
    bx = await boxes(p);
    if (sameLine(bx.title, bx.gear)) ok('consolidated: Settings shares the title\'s line');
    else bad('consolidated: Settings shares the title\'s line', JSON.stringify({ title: bx.title, gear: bx.gear }));
    if (sameLine(bx.gear, bx.search)) ok('consolidated: Settings shares the search\'s line');
    else bad('consolidated: Settings shares the search\'s line', JSON.stringify({ gear: bx.gear, search: bx.search }));

    /* ---- 4. THE BOUNDARY, which is where a row like this actually breaks ----
       The stack rule is `max-width: 60rem` and the consolidated floor is 960px,
       so the two meet exactly. 961px is the narrowest window a person can be in
       and still be owed the one-row header; a wide-viewport-only check would
       never look here. */
    await p.setViewportSize({ width: 961, height: 900 });
    await p.waitForTimeout(250);
    const edge = await boxes(p);
    if (sameLine(edge.title, edge.gear) && sameLine(edge.gear, edge.search)) ok('961px: the row survives the narrowest window that is owed it');
    else bad('961px: the row survives the narrowest window that is owed it', JSON.stringify(edge));
    await p.close();
  } catch (e) {
    bad('the check itself', String(e && e.message ? e.message : e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }

  if (errs.length) bad('no page errors', errs.join(' | '));
  else ok('no page errors');

  /* A population floor: a check that silently stops running its arms passes. */
  if (ran < 9) { console.log('head-row: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('head-row: ' + failures + ' FAILED'); process.exit(1); }
  console.log('head-row: all good, ' + ran + ' checks');
})();
