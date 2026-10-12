// Browser-check-surface: plus-state2 plus-si-email plus-signin-email plus-si-computer-field plus-si-computer plus-si-computer-hint plus-signin-code plus-si-code
'use strict';
/**
 * kosmos#5995 item 4: the Kosmos+ sign-in shows the name this computer will be sent under BEFORE it is sent, in a
 * "Name for this computer" box on the email step, and the person can keep it, change it or clear it.
 *
 * This drives the real page against the board's REAL routes (GET /api/remote/computer-name and POST
 * /api/remote/signin-start are not answered here), with a stand-in tunnel program that records what it was asked to
 * send. So each claim is read where it lands: the name on the tunnel's command line.
 *  - the box is on the email step, laid out between the email box and the button, filled with this computer's name;
 *  - left alone, the start sends exactly that name, and nothing is kept;
 *  - a typed name is sent (Enter in the box asks for the code), kept, and shown again on the next sign-in;
 *  - a cleared box sends "This computer", and the next sign-in shows that;
 *  - the page throws nothing.
 * The computer's own name is never printed: only whether it matched.
 *
 * Without the page change the box does not exist and the first check fails; without the server change the typed name
 * never reaches the tunnel.
 *
 *   node docs/browser-checks/render-plus-computer-name-5995.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-computer-name-5995.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscname-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscname-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscname-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscname-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscname-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

/* The stand-in tunnel: it records every `signin start` command line and answers "a code was sent". An older tunnel
   refuses the device-key verb as a usage error (exit 2), as real ones do (kosmos#5422). */
const ARGV_LOG = path.join(SANDBOX, 'tunnel-argv.jsonl');
const FAKE_TUNNEL = path.join(SANDBOX, 'fake-tunnel');
fs.writeFileSync(FAKE_TUNNEL, ['#!/usr/bin/env node',
  'const a = process.argv.slice(2);',
  "if (a[0] === 'signin' && a[1] === 'start') { require('node:fs').appendFileSync(" + JSON.stringify(ARGV_LOG) + ", JSON.stringify(a) + '\\n'); console.log(JSON.stringify({ stage: 'code_sent' })); process.exit(0); }",
  "if (a[0] === 'signin' && a[1] === 'device-id') { process.stderr.write(\"error: unrecognized subcommand 'device-id'\\n\"); process.exit(2); }",
  'process.exit(0);', ''].join('\n'));
fs.chmodSync(FAKE_TUNNEL, 0o755);
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel-state');

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const remote = require('../../engine/remote');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pluscname-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };
const ENDING = ' (Kosmos app)';
const sentNames = () => (fs.existsSync(ARGV_LOG) ? fs.readFileSync(ARGV_LOG, 'utf8').trim().split('\n').filter(Boolean) : [])
  .map((line) => { const a = JSON.parse(line); return a[a.indexOf('--device-name') + 1]; });
const box = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e || e.hidden || e.closest('[hidden]')) return null;
  const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
}, sel);
const valueOf = (page, id) => page.evaluate((i) => document.getElementById(i).value, id);

/** A fresh page on the email step of the sign-in. Only the board's own status and device list are answered here. */
async function openWizard(browser, BASE, errs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'dark' });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { window.__kosmosRestartHoldMs = 0; });
  await page.route('**/api/remote', (route, req) => {
    const m = (req || route.request()).method();
    if (m === 'GET' || m === 'HEAD') route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNENROLLED) });
    else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/remote/devices**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.click('#plus-signin-top');
  await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
  return page;
}
/** Wait for the box to show a name (the read is asynchronous), then answer what it shows. */
async function shownName(page) {
  await page.waitForFunction(() => document.getElementById('plus-si-computer') && document.getElementById('plus-si-computer').value !== '', null, { timeout: 5000 }).catch(() => {});
  return valueOf(page, 'plus-si-computer');
}
async function codeStep(page) {
  await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 8000 }).catch(() => {});
  return !!(await box(page, '#plus-si-code'));
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const errs = [];
  try {
    const own = remote.computerNameShown();
    chk(own.fromComputer === true && own.name.length > 0, 'CONTROL: the sandbox starts with no kept name, and the computer has one', JSON.stringify({ fromComputer: own.fromComputer, length: own.name.length }));
    chk(own.name !== 'Studio Mac' && own.name !== 'This computer', 'CONTROL: this computer\'s name is not one the check types, so the arms below are told apart');

    // ---- 1. Left alone: the box shows the computer's name, and that is what is sent. ----
    {
      const page = await openWizard(browser, BASE, errs);
      const shown = await shownName(page);
      chk(shown === own.name, 'the box is filled with the name this computer would be sent under', 'matched: ' + (shown === own.name) + ', length ' + shown.length);
      const email = await box(page, '#plus-signin-email');
      const name = await box(page, '#plus-si-computer');
      const label = await box(page, 'label[for="plus-si-computer"]');
      const hint = await box(page, '#plus-si-computer-hint');
      const go = await box(page, '#plus-signin-code');
      chk(!!name && name.width >= 200 && name.height >= 24, 'the name box is laid out at a usable size', JSON.stringify(name));
      chk(!!label && !!hint && label.height > 0 && hint.height > 0, 'its label and its one line of explanation are on screen', JSON.stringify({ label, hint }));
      chk(!!email && !!name && !!go && email.bottom <= name.top && name.bottom <= go.top, 'it sits between the email box and the button', JSON.stringify({ email, name, go }));
      chk(!!email && !!name && email.width === name.width, 'it is as wide as the email box above it', JSON.stringify({ email: email && email.width, name: name && name.width }));
      const fits = await page.evaluate(() => { const e = document.getElementById('plus-si-computer-hint'); const c = document.getElementById('plus-state2'); return e.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1 && document.documentElement.scrollWidth <= window.innerWidth; });
      chk(fits, 'the explanation stays inside the card and the page does not scroll sideways');
      await page.fill('#plus-si-computer', 'A shown name');   // so the shot carries no real computer name
      await page.screenshot({ path: path.join(OUT, 'computer-name-email-step.png') });
      await page.close();
    }
    {
      const page = await openWizard(browser, BASE, errs);
      await shownName(page);
      await page.fill('#plus-signin-email', 'person@example.com');
      const before = sentNames().length;
      await page.click('#plus-signin-code');
      chk(await codeStep(page), 'an untouched box: the sign-in moves on to the code step');
      const sent = sentNames().slice(before);
      chk(sent.length === 1 && sent[0] === own.name + ENDING, 'an untouched box sends exactly the computer\'s name, as before this change', 'starts: ' + sent.length + ', matched: ' + (sent[0] === own.name + ENDING));
      chk(remote.read().computer_name === null, 'and nothing is kept, so a renamed computer is still followed', JSON.stringify(remote.read().computer_name === null));
      await page.close();
    }

    // ---- 2. A typed name: Enter in the box asks for the code, the typed name is sent and kept. ----
    {
      const page = await openWizard(browser, BASE, errs);
      await shownName(page);
      await page.fill('#plus-signin-email', 'person@example.com');
      await page.fill('#plus-si-computer', 'Studio Mac');
      const before = sentNames().length;
      await page.focus('#plus-si-computer');
      await page.keyboard.press('Enter');
      chk(await codeStep(page), 'Enter in the name box asks for the code');
      const sent = sentNames().slice(before);
      chk(sent.length === 1 && sent[0] === 'Studio Mac' + ENDING, 'the typed name is the one sent', JSON.stringify(sent));
      chk(remote.read().computer_name === 'Studio Mac', 'and it is kept for the later paths that name this computer', JSON.stringify(remote.read().computer_name));
      await page.close();
    }
    {
      const page = await openWizard(browser, BASE, errs);
      chk((await shownName(page)) === 'Studio Mac', 'the next sign-in shows the kept name, not the computer\'s', JSON.stringify(await valueOf(page, 'plus-si-computer')));
      await page.screenshot({ path: path.join(OUT, 'computer-name-kept.png') });

      // ---- 3. Cleared: "This computer" goes, and that is what the next sign-in shows. ----
      await page.fill('#plus-signin-email', 'person@example.com');
      await page.fill('#plus-si-computer', '');
      const ph = await page.evaluate(() => document.getElementById('plus-si-computer').placeholder);
      chk(ph === 'This computer', 'an emptied box shows what will be sent in its place', JSON.stringify(ph));
      const before = sentNames().length;
      await page.click('#plus-signin-code');
      chk(await codeStep(page), 'a cleared box: the sign-in moves on to the code step');
      const sent = sentNames().slice(before);
      chk(sent.length === 1 && sent[0] === 'This computer' + ENDING, 'a cleared box sends the plain name', JSON.stringify(sent));
      await page.close();
    }
    {
      const page = await openWizard(browser, BASE, errs);
      chk((await shownName(page)) === 'This computer', 'the next sign-in shows the plain name, and the computer\'s own name has not come back', JSON.stringify((await valueOf(page, 'plus-si-computer')) === 'This computer'));
      await page.close();
    }
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
