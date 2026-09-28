// Browser-check-surface: acct-cancel acct-flow acct-add acct-code
'use strict';
/**
 * #4271: when a Claude sign-in in Settings, AI Models, Add a provider ends while focus is
 * inside its panel (#acct-flow), focus stays in the dialog instead of dropping to the page
 * (the #1918 stranded-focus class).
 *
 * The sign-in routes are stubbed with page.route (start, the poll, cancel), so no Claude
 * sign-in runs and nothing touches the machine; the page's own buttons and its own 1s poll do
 * the rest. Three arms:
 *   1. Stop: press "Stop this sign-in", the next poll reads idle, focus lands on
 *      "Start the sign-in" (#acct-add).
 *   2. A failed sign-in while the person is in the code field: same landing.
 *   3. Connected: the gold success box keeps its own focus (#acct-success-close); the fix
 *      must not take it away.
 * Arms 1 and 2 fail on a page without the fix (activeElement is BODY), which is the control.
 *
 * Computed-state only, so headless is sound.
 *
 * Run: NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *        node docs/browser-checks/render-acct-stop-focus-4271.js http://127.0.0.1:PORT
 * against a sandboxed board (boot_board in tools/browser-checks.sh).
 */
const pw = require('playwright');
/* This check POSTs /api/first-run/complete, so it declines a board that is not a fixture. */
require('./lib-sandbox-guard.js').requireSandbox('render-acct-stop-focus-4271.js');
const BASE = process.argv[2] || 'http://127.0.0.1:4399';
let failed = 0;
const say = (k, v, d) => { if (!v) failed += 1; console.log((v ? 'PASS' : 'FAIL') + '  ' + k + (d ? '  ' + d : '')); };

/* Where focus is, as a person would care: the element's id, and whether it is inside the dialog. */
const focusNow = (p) => p.evaluate(() => {
  const a = document.activeElement;
  const modal = document.getElementById('acct-add-modal');
  return { id: (a && a.id) || '', tag: (a && a.tagName) || '', inDialog: !!(a && modal && modal.contains(a) && a !== modal) };
});

(async () => {
  const r = await fetch(BASE + '/api/first-run/complete', { method: 'POST' });
  if (!r.ok) { console.log('FAIL  could not complete first run on the board'); process.exit(1); }
  const b = await pw.chromium.launch({ headless: process.env.HEADED === '1' ? false : true });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.message)));

  /* The engine the page talks to, stubbed: `phase` is what the next poll reads. */
  let phase = 'idle';
  let because = '';
  await p.route('**/api/connect/start', (route) => route.fulfill({ json: { ok: true } }));
  await p.route('**/api/connect/cancel', (route) => { phase = 'idle'; route.fulfill({ json: { ok: true } }); });
  await p.route(/\/api\/connect(\?.*)?$/, (route) => route.fulfill({ json: because ? { phase, because } : { phase } }));
  /* No install is coming, so Start goes straight to the POST with no confirm box. */
  await p.route('**/api/first-run', async (route) => {
    const res = await route.fetch();
    const body = await res.json().catch(() => ({}));
    route.fulfill({ json: Object.assign({}, body, { connect: Object.assign({}, body.connect || {}, { willInstall: false }) }) });
  });

  await p.goto(BASE + '/?tab=settings', { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.evaluate(() => { try { settingsGo('accounts'); } catch (e) { const s = document.querySelector('[data-go="accounts"]'); if (s) s.click(); } });
  await p.waitForTimeout(500);

  /* Open the dialog on Claude's subscription step, and start a sign-in the stub says is running. */
  async function startSignin(runningPhase) {
    phase = 'idle'; because = '';
    if (await p.isHidden('#acct-add-modal')) { await p.click('#acct-add-open'); await p.waitForTimeout(300); }
    await p.selectOption('#acct-provider-pick', 'claude');
    await p.waitForTimeout(200);
    if (await p.isVisible('#acct-claude-pick-sub').catch(() => false)) { await p.click('#acct-claude-pick-sub'); await p.waitForTimeout(200); }
    phase = runningPhase;
    await p.click('#acct-add');
    await p.waitForFunction(() => !document.getElementById('acct-flow').hidden, null, { timeout: 5000 }).catch(() => {});
    return p.isVisible('#acct-flow');
  }
  const waitFlowGone = () => p.waitForFunction(() => document.getElementById('acct-flow').hidden, null, { timeout: 5000 }).then(() => true, () => false);

  // Arm 1: Stop.
  say('arm 1: the sign-in panel shows while the stub says a browser sign-in is running', await startSignin('signin-browser-open'));
  await p.focus('#acct-cancel');
  const before1 = await focusNow(p);
  say('arm 1: before Stop, focus is on Stop (so the arm below is not vacuous)', before1.id === 'acct-cancel', JSON.stringify(before1));
  await p.click('#acct-cancel');
  const gone1 = await waitFlowGone();
  say('arm 1: after Stop the next poll puts the panel away', gone1);
  const f1 = await focusNow(p);
  say('arm 1: focus lands on "Start the sign-in", not the page', f1.id === 'acct-add' && f1.inDialog, JSON.stringify(f1));
  say('arm 1: and that button can be pressed again', await p.isEnabled('#acct-add'));

  // Arm 2: the sign-in fails while the person is in the code field.
  await startSignin('signin-awaiting-code');
  const codeUp = await p.waitForSelector('#acct-code', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
  say('arm 2: the code field shows while the stub awaits a code', codeUp);
  await p.focus('#acct-code');
  const before2 = await focusNow(p);
  say('arm 2: before the failure, focus is in the code field (so the arm below is not vacuous)', before2.id === 'acct-code', JSON.stringify(before2));
  because = 'That sign-in did not finish.'; phase = 'failed';
  const gone2 = await waitFlowGone();
  say('arm 2: a failed poll puts the panel away', gone2);
  const f2 = await focusNow(p);
  say('arm 2: focus lands on "Start the sign-in", not the page', f2.id === 'acct-add' && f2.inDialog, JSON.stringify(f2));

  // Arm 3: Connected keeps the success box's own focus.
  say('arm 3: the sign-in panel shows again', await startSignin('signin-browser-open'));
  await p.focus('#acct-cancel');
  because = ''; phase = 'connected';
  await waitFlowGone();
  await p.waitForTimeout(300);
  const f3 = await focusNow(p);
  say('arm 3: on Connected, focus is on the success box close button', f3.id === 'acct-success-close', JSON.stringify(f3));

  say('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(failed ? `render-acct-stop-focus-4271: ${failed} FAILED` : 'render-acct-stop-focus-4271: 0 FAILED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
