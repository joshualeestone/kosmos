'use strict';
/**
 * kosmos#4064: a working ChatGPT sign-in stays green when AI Models is reopened a minute later.
 *
 * On main its green lived only in the live check's 30s cache, so every reopen after that painted the row amber
 * ("Signed in", checking) for the length of a fresh check, about 3.5s on Josh's Mac. This drives the REAL page from
 * the REAL server, in this process, with codex's handshake faked (codexsigninlive.setRunner, 1.5s then "ok") and the
 * board's clock moved by stubbing Date.now, so the minute costs nothing:
 *   - opening AI Models turns the ChatGPT row green once its check answers (setup);
 *   - 61s later (past the 30s cache, inside the 5 minute observed window) Settings is reopened and the row is read
 *     every 100ms while the new check runs: it is never amber and it is green;
 *   - control: after that, the handshake answers dead, and once the cached green has gone the row reads
 *     Not connected (red), never green: a recorded green does not paint over a newer dead answer.
 *
 * Controls, measured: on main's server.js the reopen arm reds (the row is amber from the first sample).
 *
 *   node docs/browser-checks/render-chatgpt-green-4064.js            # headed
 *   HEADED=0 node docs/browser-checks/render-chatgpt-green-4064.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-chatgpt-green-4064.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cg-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cg-workers-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cg-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cg-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

/* The one ChatGPT sign-in, in the sandbox home lib-sandbox-home.js made (the default codex home). */
const CODEX = path.join(process.env.AGENT_WORKFORCE_HOME, '.codex');
fs.mkdirSync(CODEX, { recursive: true });
const EMAIL = 'green4064@example.com';
fs.writeFileSync(path.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt',
  tokens: { id_token: 'x.' + Buffer.from(JSON.stringify({ email: EMAIL })).toString('base64url') + '.y' } }));

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-chatgpt-green-4064: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const srv = require('../../server.js');
const codexsigninlive = require('../../engine/codexsigninlive');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-chatgpt-green-4064: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const DOC = (ws) => JSON.stringify({ checks: {
  'network.websocket_reachability': { status: ws },
  'network.provider_reachability': { status: 'ok', details: { 'reachability mode': 'ChatGPT auth' } },
} });
let answer = 'ok';
codexsigninlive.setRunner(async () => { await new Promise((r) => setTimeout(r, 1500)); return { ok: true, stdout: DOC(answer) }; });
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* The ChatGPT row's pill: green (acct-connected), amber (acct-unverified), red (acct-none), or what else it is. */
function pill(page) {
  return page.evaluate((email) => {
    const box = [...document.querySelectorAll('#s-sec-accounts .acct-box')].find((b) => (b.querySelector('.acct-who b') || {}).textContent === email);
    if (!box) return 'no row';
    const p = box.querySelector('.acct-box-top > span[class^="acct-"]');
    return p ? p.className : 'no pill';
  }, EMAIL);
}
const COLOUR = { 'acct-connected': 'green', 'acct-unverified': 'amber', 'acct-none': 'red' };

async function openAiModels(page, base) {
  await page.goto(base + '/?tab=settings', { waitUntil: 'load' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.evaluate(() => settingsGo('accounts'));
  await page.waitForSelector('#s-sec-accounts:not([hidden])', { timeout: 8000 });
}

/* Samples the pill every 100ms for `ms`, from the first moment the row is drawn. */
async function watch(page, ms) {
  const seen = [];
  const end = realNow() + ms;
  while (realNow() < end) {
    const c = await pill(page);
    if (c !== 'no row' || seen.length) seen.push(COLOUR[c] || c);
    await page.waitForTimeout(100);
  }
  return seen;
}
const runs = (seen) => seen.filter((c, i) => i === 0 || c !== seen[i - 1]).join(' > ');

(async () => {
  const server = await srv.start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const fr = await fetch(base + '/api/first-run/complete', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    chk(fr.ok, 'first run completed on the board', 'status ' + fr.status);
    for (const engine of ENGINES) {
      const tag = `[${engine}]`;
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `${tag} could not start a browser` + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
          err && err.message ? err.message.split('\n')[0] : String(err));
        continue;
      }
      try {
        codexsigninlive.resetForTest();
        codexsigninlive.setRunner(async () => { await new Promise((r) => setTimeout(r, 1500)); return { ok: true, stdout: DOC(answer) }; });
        answer = 'ok';
        skew += 10 * 60 * 1000;   // each engine starts outside the previous one's observed window
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message || e).split('\n')[0]));

        await openAiModels(page, base);
        const first = await watch(page, 6000);
        chk(first[first.length - 1] === 'green', `${tag} setup: the first open turns the ChatGPT row green once its check answers`, runs(first));

        skew += 61 * 1000;
        await openAiModels(page, base);
        const again = await watch(page, 3000);
        chk(again.length > 0 && !again.includes('amber'), `${tag} reopened 61s later, the row is never amber while its check runs again`, runs(again));
        chk(again[again.length - 1] === 'green', `${tag} reopened 61s later, the row is green`, runs(again));

        answer = 'warning';
        skew += 61 * 1000;
        await openAiModels(page, base);
        const dead = await watch(page, 6000);
        chk(dead[dead.length - 1] === 'red', `${tag} control: a dead answer after the recorded green reads Not connected`, runs(dead));
        const afterDead = dead.slice(dead.indexOf('red'));
        chk(dead.includes('red') && !afterDead.includes('green'), `${tag} control: once dead, the older green never comes back`, runs(dead));
        chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    Date.now = realNow;
  }
  console.log(fail.length ? `render-chatgpt-green-4064: ${fail.length} failed` : 'render-chatgpt-green-4064: all passed');
  process.exit(fail.length ? 1 : 0);
})();
