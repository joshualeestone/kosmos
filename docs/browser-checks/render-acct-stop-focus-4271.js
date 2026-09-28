// Browser-check-surface: acct-cancel acct-flow acct-add acct-code acct-add-note
'use strict';
/**
 * #4271: when a Claude sign-in in Settings, AI Models, Add a provider ends while focus is
 * inside its panel (#acct-flow), focus stays in the dialog instead of dropping to the page
 * (the #1918 stranded-focus class).
 *
 * Hermetic: boots its own sandboxed board, and stubs the sign-in routes with page.route
 * (start, the poll, cancel), so no Claude sign-in runs. The page's own buttons and its own
 * 1s poll do the rest. Five arms:
 *   1. Stop: press "Stop this sign-in"; the next poll reads idle; focus lands on
 *      "Start the sign-in" (#acct-add).
 *   2. A stuck poll while the person is in the code field: same landing.
 *   3. Connected: focus ends on the gold success box's close button, and "Start the sign-in"
 *      is never focused on the way there (a focusin log sees a move that is later overwritten).
 *   4. A start that answers with a phase that has already ended (stuck): focus lands on the note
 *      that says so (#acct-add-note), not the page.
 *   5. Focus elsewhere in the dialog (the provider picker) when the flow ends: left there.
 * Arms 1, 2, 3 and 5 assert where focus was before the ending, so none can pass vacuously;
 * arm 4 asserts a positive landing. Without the fix arms 1, 2 and 4 read BODY (the control).
 *
 * Computed-state only, so headless is sound.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-acct-stop-focus-4271.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct4271-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct4271-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct4271-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct4271-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct4271-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_RELEASE_BASE = 'http://127.0.0.1:9/dist'; // never the real update server

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* Where focus is, as a person would care: the element's id, and whether it is inside the dialog. */
const focusNow = (p) => p.evaluate(() => {
  const a = document.activeElement;
  const modal = document.getElementById('acct-add-modal');
  return { id: (a && a.id) || '', tag: (a && a.tagName) || '', inDialog: !!(a && modal && modal.contains(a) && a !== modal) };
});

(async () => {
  fleet.install([]); // no agents: the board reads an empty fleet, never the host's tmux
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  try {
    const r = await fetch(URL + '/api/first-run/complete', { method: 'POST' });
    chk(r.ok, 'first run is completed on the sandboxed board');
    const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e.message)));

    /* The engine the page talks to, stubbed: `phase` is what the next poll reads, and
       `startsAs` is what the start POST answers with (null = no phase in the answer). */
    let phase = 'idle';
    let because = '';
    let startsAs = null;
    /* The phase a start moves the engine to. It is applied WHEN the start request arrives, as
       the real engine does: set earlier, a poll still running from an earlier arm (#4275) can
       read it before Start is pressed and put the page into a sign-in nobody started. */
    let startsInto = 'idle';
    await p.route('**/api/connect/start', (route) => {
      phase = startsInto;
      route.fulfill({ json: startsAs ? Object.assign({ ok: true }, startsAs) : { ok: true } });
    });
    await p.route('**/api/connect/cancel', (route) => { phase = 'idle'; route.fulfill({ json: { ok: true } }); });
    await p.route(/\/api\/connect(\?.*)?$/, (route) => route.fulfill({ json: because ? { phase, because } : { phase } }));
    /* No install is coming, so Start goes straight to the POST with no confirm box. */
    await p.route('**/api/first-run', async (route) => {
      const res = await route.fetch();
      const body = await res.json().catch(() => ({}));
      route.fulfill({ json: Object.assign({}, body, { connect: Object.assign({}, body.connect || {}, { willInstall: false }) }) });
    });

    await p.goto(URL + '/?tab=settings', { waitUntil: 'load' });
    await p.waitForTimeout(500);
    await p.evaluate(() => { try { settingsGo('accounts'); } catch (e) { const s = document.querySelector('[data-go="accounts"]'); if (s) s.click(); } });
    await p.waitForTimeout(500);

    /* Open the dialog on Claude's subscription step, and press Start with the stub set up. */
    async function pressStart(runningPhase, answer) {
      phase = 'idle'; because = ''; startsAs = answer || null; startsInto = runningPhase;
      if (await p.isHidden('#acct-add-modal')) { await p.click('#acct-add-open'); await p.waitForTimeout(300); }
      await p.selectOption('#acct-provider-pick', 'claude');
      await p.waitForTimeout(200);
      if (await p.isVisible('#acct-claude-pick-sub').catch(() => false)) { await p.click('#acct-claude-pick-sub'); await p.waitForTimeout(200); }
      await p.click('#acct-add');
    }
    const flowUp = () => p.waitForFunction(() => !document.getElementById('acct-flow').hidden, null, { timeout: 15000 }).then(() => true, () => false);
    const flowGone = () => p.waitForFunction(() => document.getElementById('acct-flow').hidden, null, { timeout: 15000 }).then(() => true, () => false);

    // Arm 1: Stop.
    await pressStart('signin-browser-open');
    chk(await flowUp(), 'arm 1: the sign-in panel shows while the stub says a browser sign-in is running');
    await p.focus('#acct-cancel');
    const before1 = await focusNow(p);
    chk(before1.id === 'acct-cancel', 'arm 1: before Stop, focus is on Stop', JSON.stringify(before1));
    await p.click('#acct-cancel');
    chk(await flowGone(), 'arm 1: after Stop the next poll puts the panel away');
    const f1 = await focusNow(p);
    chk(f1.id === 'acct-add' && f1.inDialog, 'arm 1: focus lands on "Start the sign-in", not the page', JSON.stringify(f1));
    chk(await p.isEnabled('#acct-add'), 'arm 1: and that button can be pressed again');

    // Arm 2: the sign-in gets stuck while the person is in the code field. The page itself puts
    // focus in the code field when a code is wanted; the harness only makes sure of it.
    await pressStart('signin-awaiting-code');
    const codeUp = await p.waitForSelector('#acct-code', { state: 'visible', timeout: 15000 }).then(() => true, () => false);
    chk(codeUp, 'arm 2: the code field shows while the stub awaits a code');
    await p.focus('#acct-code');
    const before2 = await focusNow(p);
    chk(before2.id === 'acct-code', 'arm 2: before the failure, focus is in the code field', JSON.stringify(before2));
    because = 'That sign-in did not finish.'; phase = 'stuck';
    chk(await flowGone(), 'arm 2: a stuck poll puts the panel away');
    const f2 = await focusNow(p);
    chk(f2.id === 'acct-add' && f2.inDialog, 'arm 2: focus lands on "Start the sign-in", not the page', JSON.stringify(f2));

    // Arm 3: Connected. acctShowSuccess focuses the close button last, so the end state
    // alone cannot see a move to Start that happened first; the focusin log can.
    await pressStart('signin-browser-open');
    chk(await flowUp(), 'arm 3: the sign-in panel shows again');
    await p.focus('#acct-cancel');
    const before3 = await focusNow(p);
    chk(before3.id === 'acct-cancel', 'arm 3: before Connected, focus is on Stop', JSON.stringify(before3));
    await p.evaluate(() => { window.__focusLog4271 = []; document.addEventListener('focusin', (e) => window.__focusLog4271.push((e.target && e.target.id) || e.target.tagName), true); });
    because = ''; phase = 'connected';
    chk(await flowGone(), 'arm 3: the connected poll puts the panel away');
    await p.waitForTimeout(300);
    const f3 = await focusNow(p);
    const log3 = await p.evaluate(() => window.__focusLog4271);
    chk(f3.id === 'acct-success-close', 'arm 3: on Connected, focus is on the success box close button', JSON.stringify(f3));
    chk(!log3.includes('acct-add'), 'arm 3: and "Start the sign-in" was never focused on the way', JSON.stringify(log3));
    await p.click('#acct-success-close').catch(() => {});
    await p.waitForTimeout(300);

    // Arm 4: the start answers with a phase that has already ended (stuck, a real engine phase).
    // Wait on conditions, not a clock: a loaded machine can take seconds over the first-run
    // read and the start POST, and a read before they land would see focus mid-flight.
    const started4 = p.waitForResponse((res) => res.url().includes('/api/connect/start'), { timeout: 15000 }).then(() => true, () => false);
    await pressStart('stuck', { phase: 'stuck', because: 'Claude Code could not start.' });
    because = 'Claude Code could not start.';   // the engine's later polls read the same state
    chk(await started4, 'arm 4: the start request was answered');
    const settled4 = await p.waitForFunction(() => {
      const note = document.getElementById('acct-add-note');
      return !!(note && note.textContent && !document.getElementById('acct-add').disabled);
    }, null, { timeout: 15000 }).then(() => true, () => false);
    chk(settled4, 'arm 4: the page painted the ended start (note filled, Start live again)');
    await p.waitForTimeout(1500);               // past the next poll, so a repaint would show
    chk(await p.isHidden('#acct-flow'), 'arm 4: a start that answers stuck shows no running panel');
    const f4 = await focusNow(p);
    chk(f4.id === 'acct-add-note' && f4.inDialog, 'arm 4: focus lands on the note that says what happened, not the page', JSON.stringify(f4));
    const note4 = await p.textContent('#acct-add-note');
    chk(/could not start/.test(note4 || ''), 'arm 4: and the note carries the reason', JSON.stringify(note4));

    // Arm 5: focus is elsewhere in the dialog (the provider picker) when the flow ends: it
    // is left where the person put it. This is what the focusWasInFlow guard is for.
    await pressStart('signin-browser-open');
    chk(await flowUp(), 'arm 5: the sign-in panel shows again');
    await p.focus('#acct-provider-field .pcombo-trigger');
    const before5 = await p.evaluate(() => { const a = document.activeElement; return { cls: (a && a.className) || '', inFlow: document.getElementById('acct-flow').contains(a) }; });
    chk(/pcombo-trigger/.test(before5.cls) && !before5.inFlow, 'arm 5: before the ending, focus is on the provider picker, outside the panel', JSON.stringify(before5));
    phase = 'idle';
    chk(await flowGone(), 'arm 5: the idle poll puts the panel away');
    const after5 = await p.evaluate(() => { const a = document.activeElement; return (a && a.className) || (a && a.tagName) || ''; });
    chk(/pcombo-trigger/.test(after5), 'arm 5: focus stays on the provider picker', JSON.stringify(after5));

    chk(errors.length === 0, 'no page errors', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  console.log(fail.length ? `render-acct-stop-focus-4271: ${fail.length} FAILED` : 'render-acct-stop-focus-4271: 0 FAILED');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-acct-stop-focus-4271: ' + (e && e.stack || e)); process.exit(2); });
