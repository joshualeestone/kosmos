// Browser-check-surface: plus-state2 plus-si-email plus-signin-email plus-si-computer-field plus-si-computer plus-si-computer-hint plus-signin-code plus-si-code
'use strict';
/**
 * kosmos#5995 item 4: the Kosmos+ sign-in shows the name this computer will be sent under BEFORE it is sent, in a
 * "Name for this computer" box on the email step, and the person can keep it, change it or clear it.
 *
 * This drives the real page against the board's REAL routes (GET /api/remote/computer-name and POST
 * /api/remote/signin-start are not answered here), with a stand-in tunnel program that records what it was asked to
 * send. So each claim is read where it lands: the name on the tunnel's command line.
 *  - the box is on the email step, laid out between the email box and the button, filled with this computer's name
 *    (dark at desktop width, and light at phone width);
 *  - left alone, the start sends exactly that name, and nothing is kept;
 *  - a typed name is sent (Enter in the box asks for the code), kept, and shown again on the next sign-in;
 *  - a cleared box sends "This computer", and the next sign-in shows the box still empty;
 *  - when the name cannot be read, the box and its words stay off the screen and the start sends what it sent
 *    before this change;
 *  - the page throws nothing.
 * The computer's own name is never printed: only whether it matched, and lengths.
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
async function openWizard(browser, BASE, errs, before, look = { viewport: { width: 1400, height: 950 }, colorScheme: 'dark' }) {
  const page = await browser.newPage(look);
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { window.__kosmosRestartHoldMs = 0; });
  await page.route('**/api/remote', (route, req) => {
    const m = (req || route.request()).method();
    if (m === 'GET' || m === 'HEAD') route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNENROLLED) });
    else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/remote/devices**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) }));
  if (before) await before(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.click('#plus-signin-top');
  await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
  return page;
}
/** Wait for the box to come on screen with a name (the read is asynchronous), then answer what it shows. */
async function shownName(page) {
  await page.waitForFunction(() => { const f = document.getElementById('plus-si-computer-field'); return f && !f.hidden; }, null, { timeout: 5000 }).catch(() => {});
  return valueOf(page, 'plus-si-computer');
}
/* The contrast ratio between the explanation's text and the first painted background behind it (the card's, not
   the page's): WCAG's relative-luminance formula. 0 when the text is hidden or fully transparent. */
const hintContrast = (page) => page.evaluate(() => {
  const rgba = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const e = document.getElementById('plus-si-computer-hint');
  const cs = getComputedStyle(e);
  const text = rgba(cs.color);
  if (!text || text.a === 0 || Number(cs.opacity) === 0 || cs.visibility !== 'visible') return 0;
  let behind = null;
  for (let n = e; n && !behind; n = n.parentElement) { const bg = rgba(getComputedStyle(n).backgroundColor); if (bg && bg.a > 0.5) behind = bg; }
  if (!behind) behind = { r: 255, g: 255, b: 255, a: 1 };
  const a = lum(text), b = lum(behind);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});
/* What a failing check may say about a name: never the name. */
const about = (got, want) => 'matched: ' + (got === want) + ', length ' + String(got == null ? 0 : got.length);
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
      chk(shown === own.name, 'the box comes on screen filled with the name this computer would be sent under', about(shown, own.name));
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
      const ratioDark = await hintContrast(page);
      chk(ratioDark >= 3, 'dark: the explanation can be read against what is behind it (contrast at least 3 to 1)', 'ratio ' + ratioDark.toFixed(2));
      await page.fill('#plus-si-computer', 'A shown name');   // so the shot carries no real computer name
      await page.screenshot({ path: path.join(OUT, 'computer-name-email-step.png') });
      await page.close();
    }
    // The same box at phone width in the light theme: the explanation is a full sentence in a narrow card.
    {
      const page = await openWizard(browser, BASE, errs, null, { viewport: { width: 390, height: 844 }, colorScheme: 'light' });
      await shownName(page);
      const email = await box(page, '#plus-signin-email');
      const name = await box(page, '#plus-si-computer');
      const hint = await box(page, '#plus-si-computer-hint');
      const go = await box(page, '#plus-signin-code');
      chk(!!name && !!hint && !!email && !!go && email.bottom <= hint.top && hint.bottom <= name.top && name.bottom <= go.top, 'phone width, light: the explanation, the box and the button stack without overlapping', JSON.stringify({ email, hint, name, go }));
      chk(!!name && name.width >= 200 && name.height >= 24, 'phone width, light: the box is a usable size', JSON.stringify(name));
      const inside = await page.evaluate(() => { const h = document.getElementById('plus-si-computer-hint').getBoundingClientRect(); return h.left >= 0 && h.right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; });
      chk(inside, 'phone width, light: the explanation wraps inside the screen and the page does not scroll sideways');
      const ratio = await hintContrast(page);
      chk(ratio >= 3, 'phone width, light: the explanation can be read against what is behind it (contrast at least 3 to 1)', 'ratio ' + ratio.toFixed(2));
      await page.fill('#plus-si-computer', 'A shown name');
      await page.screenshot({ path: path.join(OUT, 'computer-name-email-step-phone-light.png') });
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
      chk(sent.length === 1 && sent[0] === own.name + ENDING, 'an untouched box sends exactly the computer\'s name, as before this change', 'starts: ' + sent.length + ', ' + about(sent[0], own.name + ENDING));
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
      chk(sent.length === 1 && sent[0] === 'Studio Mac' + ENDING, 'the typed name is the one sent', 'starts: ' + sent.length + ', ' + about(sent[0], 'Studio Mac' + ENDING));
      chk(remote.read().computer_name === 'Studio Mac', 'and it is kept for the later paths that name this computer', about(remote.read().computer_name, 'Studio Mac'));
      await page.close();
    }
    {
      const page = await openWizard(browser, BASE, errs);
      const kept = await shownName(page);
      chk(kept === 'Studio Mac', 'the next sign-in shows the kept name, not the computer\'s', about(kept, 'Studio Mac'));
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
      chk(sent.length === 1 && sent[0] === 'This computer' + ENDING, 'a cleared box sends the plain name', 'starts: ' + sent.length + ', ' + about(sent[0], 'This computer' + ENDING));
      chk((await valueOf(page, 'plus-si-computer')) === '', 'and the box the person emptied is still empty after the start');
      await page.close();
    }
    {
      const page = await openWizard(browser, BASE, errs);
      const again = await shownName(page);
      chk(!!(await box(page, '#plus-si-computer')) && again === '', 'the next sign-in shows the box still empty (its placeholder says what goes), and the computer\'s own name has not come back', 'on screen: ' + !!(await box(page, '#plus-si-computer')) + ', length ' + again.length);
      // Left alone there, it stays a cleared choice: the plain name goes again and nothing else is kept.
      await page.fill('#plus-signin-email', 'person@example.com');
      const before = sentNames().length;
      await page.click('#plus-signin-code');
      chk(await codeStep(page), 'the cleared box left alone: the sign-in moves on to the code step');
      const sent = sentNames().slice(before);
      chk(sent.length === 1 && sent[0] === 'This computer' + ENDING && remote.read().computer_name === '', 'and it sends the plain name again and is still a cleared choice', 'starts: ' + sent.length + ', ' + about(sent[0], 'This computer' + ENDING));
      await page.close();
    }
    // ---- 4. The name cannot be read: nothing about it is on screen, and the start is what it was before. ----
    {
      remote.setComputerName(own.name);   // back to following the computer, so "before this change" has one meaning
      chk(remote.read().computer_name === null, 'CONTROL: nothing is kept going into the unread arm');
      const page = await openWizard(browser, BASE, errs, (pg) => pg.route('**/api/remote/computer-name', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"no"}' })));
      await page.waitForTimeout(600);
      chk((await box(page, '#plus-si-computer')) === null && (await box(page, '#plus-si-computer-hint')) === null, 'with the name unread, the box and its "An empty box sends..." line are not on screen');
      await page.fill('#plus-signin-email', 'person@example.com');
      const before = sentNames().length;
      await page.focus('#plus-signin-email');
      await page.keyboard.press('Enter');
      chk(await codeStep(page), 'with the name unread, the sign-in still moves on to the code step');
      const sent = sentNames().slice(before);
      chk(sent.length === 1 && sent[0] === own.name + ENDING, 'and the start sends what it sent before this change', 'starts: ' + sent.length + ', ' + about(sent[0], own.name + ENDING));
      chk(remote.read().computer_name === null, 'and keeps nothing');
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
