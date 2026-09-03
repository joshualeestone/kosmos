/**
 * The ADOPT PROMPT, pressed for real in a browser (kosmos#1531).
 *
 * #1531 is the case a real outside tester hit: a person who ran Claude in one
 * folder with NO instruction file. `found()` has no identity file to read, so
 * discovery offers that folder for ADOPTION under a name the person types --
 * "Is this one of your agents?", an empty editable field, decline in one click.
 * The engine halves are tested (engine/discover.adoptable-1531.test.js,
 * discover.decline-1531.test.js). What no source test can see is the SCREEN:
 * whether the prompt renders as a question rather than an assertion, whether the
 * name field is reachable and editable, whether Add posts the TYPED name, and
 * whether an empty field is refused before it ever reaches the network. The suite
 * reads text; a dead button reads as correct text.
 *
 * 🔑 THE ROUTES ARE INTERCEPTED, NOT CALLED. Adopting registers an agent and
 * declining writes a "not an agent" record to disk; both are fulfilled here by
 * the browser, so this drives the real handlers and the real DOM without touching
 * the machine. That is the whole reason this check can press the buttons.
 *
 * 🔑 WHICH SURFACE THIS DRIVES. The `.fr-adopt` painter (`adoptRowsHtml`) renders
 * inside `frPaintFound`, reached only when there is at least one OFFERABLE found
 * agent (index.html, the `frFoundOffer().length` gate). So the fixture carries one
 * filed agent alongside the no-file folders: that is the realistic mixed machine
 * (some agents have instruction files, some folders do not) and it is what puts
 * the adopt prompt on screen. The Add/Skip handlers this asserts are the SAME
 * handlers the scan-panel variant (#1938, `.fr-scanrow`) uses, so the register
 * and decline behaviour proven here is the behaviour on both surfaces; only the
 * scan surface's row selectors differ and it is not what this check drives.
 *
 * ⚠️ IT ASKS WHETHER THE FIELD CAN BE TOUCHED, not only whether it is painted:
 * `elementFromPoint` is the question a screenshot cannot answer.
 *
 * Run: see the README in this directory. Shape:
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-adopt-1531.js http://127.0.0.1:PORT
 * against a sandboxed board (boot_board in tools/browser-checks.sh).
 */
'use strict';

const playwright = require('playwright');
const { gotoStepForAnchor } = require('./lib-firstrun-steps.js');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* The no-instruction folders offered for adoption, and one filed agent so the
   adopt painter (frPaintFound) is reached. The folder is the only fact an adopt
   row has: no name comes across, which is the entire point of the typed field. */
const ADOPT_DIR = '/Users/x/work/home/site-monitor';
const SKIP_DIR = '/Users/x/work/home/scratch-dir';
const FOUND = {
  ok: true,
  agents: [
    { dir: '/Users/x/work/workers/claude-bot', name: 'Splinter', role: 'Project manager' },
  ],
  adoptable: [{ dir: ADOPT_DIR }, { dir: SKIP_DIR }],
};

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = (m.location() && m.location().url) || '';
    /* A sandbox nobody has set a picture in has no avatar to serve, and this
       screen is not what that belongs to. */
    if (/\b404\b/.test(m.text()) && src.includes('/api/you/avatar')) return;
    errors.push(`console: ${m.text()} <- ${src}`);
  });

  /* Every data route this screen touches, answered by the browser. `connectBody`
     and `declineBody` capture exactly what the handlers sent, so the assertions
     below can prove Add posted the TYPED name and Skip posted the RIGHT folder --
     fulfilling every request the same way would let this check pass with the write
     addressed to anything at all, which is the defect it exists for. */
  let connectCalls = 0;
  let connectBody = null;
  let declineBody = null;
  await page.route('**/api/found-agents', (r) => r.fulfill({ json: FOUND }));
  await page.route('**/api/first-run', (r) => r.fulfill({
    json: { done: false, path: 'create', fleetCount: 0, known: true },
  }));
  /* Reached only if the create arm scans; offer is non-empty here so it should
     not, but a stray fetch must not hit the real disk. */
  await page.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [] } }));
  await page.route('**/api/connect-agent', (r) => {
    connectCalls += 1;
    try { connectBody = JSON.parse(r.request().postData() || '{}'); } catch { connectBody = {}; }
    /* OK only for the adopt folder carrying a typed name, so a misaddressed or
       nameless write cannot pass. The server files it under the folder basename. */
    const ok = connectBody && connectBody.dir === ADOPT_DIR && typeof connectBody.name === 'string' && connectBody.name.length > 0;
    r.fulfill({
      status: ok ? 200 : 400,
      json: ok
        ? { ok: true, name: 'site-monitor', displayName: connectBody.name, dir: ADOPT_DIR, started: true }
        : { ok: false, because: 'that folder has no instructions in it' },
    });
  });
  await page.route('**/api/found-agents/decline', (r) => {
    try { declineBody = JSON.parse(r.request().postData() || '{}'); } catch { declineBody = {}; }
    r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/found-agents/undecline', (r) => r.fulfill({ json: { ok: true } }));

  /* Discover the fleet step, do not name it (kosmos#1801): a literal fr-step
     number strands the moment a step is inserted before it. */
  const step = await gotoStepForAnchor(page, BASE, '#fr-fleet');
  await page.waitForSelector('#fr-fleet .fr-adoptrow', { timeout: 8000 });
  await page.waitForTimeout(300);

  const rowSel = `#fr-fleet .fr-adoptrow[data-found-dir="${ADOPT_DIR}"]`;
  const skipSel = `#fr-fleet .fr-adoptrow[data-found-dir="${SKIP_DIR}"]`;

  // 1. The prompt is a QUESTION, not a claim about who the agent is.
  const heading = await page.$eval('#fr-fleet .fr-adopth', (h) => h.textContent.trim()).catch(() => null);
  check('prompt heading is a question', heading === 'Is this one of your agents?',
    JSON.stringify(heading));

  // 2. The folder is shown as the only fact; nothing is asserted about a name.
  const shownDir = await page.$eval(`${rowSel} .fr-foundname`, (b) => b.textContent.trim()).catch(() => null);
  check('adopt row shows the folder path', shownDir === ADOPT_DIR, JSON.stringify(shownDir));

  // 3. The name field is an empty, editable input AND reachable (not painted-over).
  const field = await page.evaluate((sel) => {
    const input = document.querySelector(`${sel} .fr-adoptinput`);
    if (!input) return { present: false };
    const r = input.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      present: true,
      tag: input.tagName,
      type: input.getAttribute('type'),
      value: input.value,
      disabled: input.disabled,
      reachable: top === input || (input.contains(top)) || (top && top.closest && top.closest('.fr-adoptinput') === input),
      w: Math.round(r.width),
    };
  }, rowSel);
  check('name field is an empty editable text input',
    field.present && field.tag === 'INPUT' && field.type === 'text' && field.value === '' && !field.disabled,
    JSON.stringify(field));
  check('name field is reachable (elementFromPoint)', field.present && field.reachable && field.w > 0,
    JSON.stringify({ reachable: field.reachable, w: field.w }));

  // 4. The load-bearing helper line (Mona Lisa's copy) is present.
  const help = await page.$eval(`${rowSel} .fr-adopthelp`, (s) => s.textContent.trim()).catch(() => null);
  check('helper line explains the name is a guess to type over',
    typeof help === 'string' && /what should we call it/i.test(help), JSON.stringify(help));

  // 5. Adopting with an EMPTY name is refused BEFORE the network (nothing posted).
  const beforeEmpty = connectCalls;
  await page.click(`${rowSel} .fr-foundgo`);
  await page.waitForTimeout(250);
  const emptySaid = await page.$eval(`${rowSel} .fr-foundsaid`, (p) => p.textContent.trim()).catch(() => null);
  check('empty name is refused client-side with a name-first message',
    emptySaid === 'Give this agent a name first.', JSON.stringify(emptySaid));
  check('empty-name refusal never reached the network', connectCalls === beforeEmpty,
    `connectCalls ${beforeEmpty} -> ${connectCalls}`);

  // 6. THE CLOSE CRITERION: a typed name adopts the no-file folder and registers.
  await page.fill(`${rowSel} .fr-adoptinput`, 'Site monitor');
  await page.click(`${rowSel} .fr-foundgo`);
  await page.waitForFunction(
    (sel) => {
      const go = document.querySelector(`${sel} .fr-foundgo`);
      return go && /added/i.test(go.textContent || '');
    },
    rowSel,
    { timeout: 8000 },
  ).catch(() => {});
  const added = await page.evaluate((sel) => {
    const go = document.querySelector(`${sel} .fr-foundgo`);
    const row = document.querySelector(sel);
    return { label: go && go.textContent.trim(), done: row && row.classList.contains('done') };
  }, rowSel);
  check('Add posted the typed name for the adopt folder',
    connectBody && connectBody.dir === ADOPT_DIR && connectBody.name === 'Site monitor',
    JSON.stringify(connectBody));
  check('the row registers and becomes its own receipt (Added / done)',
    added.label === 'Added' && added.done === true, JSON.stringify(added));

  // 7. Decline is one blameless click: no confirm, row records it, Undo appears.
  await page.click(`${skipSel} .fr-adoptno`);
  await page.waitForSelector(`${skipSel}.declined`, { timeout: 8000 }).catch(() => {});
  const declined = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const gone = row && row.querySelector('.fr-adoptgone');
    const undo = row && row.querySelector('.fr-adoptundo');
    return {
      declined: row && row.classList.contains('declined'),
      gone: gone ? gone.textContent.trim().slice(0, 40) : null,
      undo: Boolean(undo),
    };
  }, skipSel);
  check('Skip posts the RIGHT folder', declineBody && declineBody.dir === SKIP_DIR, JSON.stringify(declineBody));
  check('Skip is one click: row records it and offers Undo (no confirm)',
    declined.declined === true && declined.undo === true && Boolean(declined.gone),
    JSON.stringify(declined));

  check('no page errors and no unexpected console errors', errors.length === 0,
    errors.slice(0, 4).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed  (fr-step ${step})`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('render-adopt-1531 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
