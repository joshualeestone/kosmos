/**
 * #2497: the ADOPT PROMPT is GONE from first run (kosmos#1531 behavior superseded).
 *
 * #1531 shipped an "Is this one of your agents?" adopt prompt on first-run Screen 9 for
 * no-instruction-file folders discovery offered for adoption. #2497 (Josh, 2026-09-08, watching
 * Ben + Nacho test) removed ALL auto-scan/auto-import from onboarding: a developer's many tmux
 * Claude Code sessions filled first run with garbage agents. First run now ALWAYS lands on the
 * no-agent "Create your first agent." / Giddy Up screen, so the adopt prompt (frPaintFound /
 * adoptRowsHtml) never renders during onboarding, even when discovery HAS adoptable folders.
 *
 * This check now guards the SUPPRESSION: fed a payload with adoptable folders (exactly the input
 * that used to raise the prompt), first-run S9 must show the create / Giddy Up screen and NOT the
 * adopt prompt. The adopt/found engine is kept-but-bypassed (per the card); a user pulls real
 * agents in later via the manual Import Agent (#1652) on the Create Agent screen.
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

/* The exact input that used to raise the adopt prompt: a filed agent plus no-instruction folders
   offered for adoption. Under #2497 none of it reaches the screen on first run. */
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
    if (/\b404\b/.test(m.text()) && src.includes('/api/you/avatar')) return;
    errors.push(`console: ${m.text()} <- ${src}`);
  });

  /* Discovery HAS adoptable folders; a scan route is stubbed too. Under #2497 first run must not
     reach for either -- it renders Giddy Up before any found/scan logic. connect/decline are
     stubbed so a stray call cannot hit the real machine, and asserted never-called below. */
  let connectCalls = 0;
  let declineCalls = 0;
  await page.route('**/api/found-agents', (r) => r.fulfill({ json: FOUND }));
  await page.route('**/api/first-run', (r) => r.fulfill({
    json: { done: false, path: 'create', fleetCount: 0, known: true },
  }));
  await page.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [{ dir: ADOPT_DIR }] } }));
  await page.route('**/api/connect-agent', (r) => { connectCalls += 1; r.fulfill({ json: { ok: true, name: 'x', dir: ADOPT_DIR, started: true } }); });
  await page.route('**/api/found-agents/decline', (r) => { declineCalls += 1; r.fulfill({ json: { ok: true } }); });

  const step = await gotoStepForAnchor(page, BASE, '#fr-fleet');
  await page.waitForSelector('#fr-fleet', { timeout: 8000 });
  await page.waitForTimeout(400);

  const view = await page.evaluate(() => {
    const title = (document.getElementById('fr-fleet-title') || {}).textContent || '';
    const box = (document.getElementById('fr-fleet') || {}).innerHTML || '';
    return {
      title,
      box,
      adoptRows: document.querySelectorAll('#fr-fleet .fr-adoptrow').length,
      foundRows: document.querySelectorAll('#fr-fleet .fr-foundrow, #fr-fleet .fr-scanrow').length,
      adoptPrompt: !!document.querySelector('#fr-fleet .fr-adopth'),
    };
  });

  // 1. First run lands on the create / Giddy Up screen, even with adoptable folders discovered.
  check('first run shows the create heading (not an adopt prompt)',
    /create your first agent/i.test(view.title), JSON.stringify(view.title));
  check('the Giddy Up copy is present', /let’s get started/i.test(view.box), view.box.slice(0, 120));

  // 2. The adopt prompt and any found/scan rows are suppressed.
  check('no adopt prompt renders ("Is this one of your agents?")', !view.adoptPrompt, `adopth=${view.adoptPrompt}`);
  check('no adopt rows render', view.adoptRows === 0, `adoptRows=${view.adoptRows}`);
  check('no found/scan rows render', view.foundRows === 0, `foundRows=${view.foundRows}`);

  // 3. Nothing was imported or declined automatically on first run.
  check('no agent was auto-connected on first run', connectCalls === 0, `connectCalls=${connectCalls}`);
  check('no folder was auto-declined on first run', declineCalls === 0, `declineCalls=${declineCalls}`);

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
