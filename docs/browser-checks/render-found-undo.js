/**
 * #2497: the found-agents row (Add / Undo) is GONE from first run.
 *
 * This check drove the first-run Screen 9 found-agents list and pressed Add/Undo on its rows.
 * #2497 (Josh, 2026-09-08, watching Ben + Nacho test) removed the found-agents list from onboarding:
 * a developer's many tmux Claude Code sessions filled first run with garbage agents. First run now
 * ALWAYS lands on the no-agent "Create your first agent." / Giddy Up screen, so no found rows (and
 * no Add/Undo controls) render on first-run S9, whatever discovery returns.
 *
 * This check now guards the SUPPRESSION: fed found agents (including the folder-name-differs case
 * that the original guarded), first-run S9 must show the create / Giddy Up screen with NO found
 * rows and must not auto-connect/decline anything. The found-agents engine is kept-but-bypassed
 * (per the card); a user pulls real agents in later via the manual Import Agent (#1652) on the
 * Create Agent screen.
 *
 * Run: see the README in this directory (needs a sandboxed board; boot_board in tools/browser-checks.sh).
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-found-undo.js http://127.0.0.1:PORT
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

/* The exact input that used to raise the found rows, incl. the folder-name-differs case. */
const FOUND = {
  ok: true,
  agents: [
    { dir: '/Users/x/work/workers/claude-bot', name: 'Splinter', role: 'Project manager' },
    { dir: '/Users/x/work/agents/rosalind-the-research-assistant',
      name: 'rosalind-the-research-assistant', role: 'Research assistant' },
  ],
};

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  let connectCalls = 0;
  let disconnectCalls = 0;
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = (m.location() && m.location().url) || '';
    if (/\b404\b/.test(m.text()) && src.includes('/api/you/avatar')) return;
    errors.push(`console: ${m.text()} <- ${src}`);
  });

  await page.route('**/api/found-agents', (r) => r.fulfill({ json: FOUND }));
  await page.route('**/api/first-run', (r) => r.fulfill({
    json: { done: false, path: 'create', fleetCount: 0, known: true },
  }));
  await page.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [] } }));
  await page.route('**/api/connect-agent', (r) => { connectCalls += 1; r.fulfill({ json: { ok: true, name: 'x', started: true } }); });
  await page.route('**/api/found-agents/decline', (r) => { disconnectCalls += 1; r.fulfill({ json: { ok: true } }); });

  const step = await gotoStepForAnchor(page, BASE, '#fr-fleet');
  await page.waitForSelector('#fr-fleet', { timeout: 8000 });
  await page.waitForTimeout(400);

  const view = await page.evaluate(() => ({
    title: (document.getElementById('fr-fleet-title') || {}).textContent || '',
    box: (document.getElementById('fr-fleet') || {}).innerHTML || '',
    foundRows: document.querySelectorAll('#fr-fleet .fr-foundrow').length,
    addButtons: document.querySelectorAll('#fr-fleet .fr-foundgo').length,
    undoButtons: document.querySelectorAll('#fr-fleet .fr-foundundo').length,
  }));

  check('first run shows the create heading (not a found list)', /create your first agent/i.test(view.title), JSON.stringify(view.title));
  check('the Giddy Up copy is present', /let’s get started/i.test(view.box), view.box.slice(0, 120));
  check('no found rows render on first run', view.foundRows === 0, `foundRows=${view.foundRows}`);
  check('no Add or Undo controls render', view.addButtons === 0 && view.undoButtons === 0,
    `add=${view.addButtons} undo=${view.undoButtons}`);
  check('nothing was auto-connected on first run', connectCalls === 0, `connectCalls=${connectCalls}`);
  check('nothing was auto-declined on first run', disconnectCalls === 0, `disconnectCalls=${disconnectCalls}`);
  check('no page errors and no unexpected console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed  (fr-step ${step})`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('render-found-undo threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
