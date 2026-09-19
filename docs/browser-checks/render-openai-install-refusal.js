// Browser-check-surface: fr-openai-confirm-msg
'use strict';
/**
 * A refused or failed OpenAI install SAYS WHY, on the first-run GPT card and in
 * Settings, and puts the button back.
 *
 * Found by the founder on a clean Windows 11 laptop (prod 0.6.72): first-run, GPT,
 * Confirm, progress bar, then "We could not start that install." The engine had
 * refused WITH a reason, at `job.because`, and the click handler read only
 * `out.error || out.because`. Separately, the first-run poll watched presence only,
 * so an install that failed after it started sat on "Installing..." for five
 * minutes, and the Settings handler's catch called a `showBar` that is not in its
 * scope, so it threw and left "Starting..." up.
 *
 * WHY A BROWSER. web.runner-install-refusal.test.js lifts runnerInstallRefusal and
 * runs it against stubs; it cannot prove the REAL click listeners paint the
 * sentence, hide the bar and re-enable the button. This clicks the real buttons on
 * the real page (file://, no board) with fetch answered from a stub.
 *
 * Arms:
 *   1. first-run, a refusal in the OLD engine shape (reason only at job.because):
 *      the reason is painted, the bar is hidden, Confirm is clickable again.
 *   2. first-run, the install starts and the job then FAILS: the poll paints the
 *      job's reason (not the five-minute "taking longer" line) and gives the button back.
 *   3. CONTROL: first-run, the install starts and the runner appears: the status
 *      line clears and the picker opens (the poll did not break the happy path).
 *   4. Settings, a refusal: the reason is painted, not stuck on "Starting...".
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-openai-install-refusal.js
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-openai-install-refusal: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const REASON = "installing OpenAI's Codex from here is not supported on this kind of computer (linux), so nothing was downloaded";
const JOB_FAIL = 'we could not reach the download server for OpenAI\'s Codex. Check this computer is online, then try again';

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

/* Installed in the page before any script runs: every route answers from these
   globals, so each arm re-arms them and nothing ever leaves the page. */
function initStub() {
  window.__install = { status: 400, body: {} };
  window.__runners = { openai: { present: false, job: null } };
  const enc = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/runners/openai/install')) return enc(window.__install.status, window.__install.body);
    if (u.includes('/api/runners')) return enc(200, { runners: window.__runners });
    return enc(200, {});
  };
}

async function reveal(page, id) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    for (let n = el; n; n = n.parentElement) {
      n.removeAttribute('hidden');
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    el.disabled = false;
    return true;
  }, id);
}

const read = (page) => page.evaluate(() => {
  const msg = document.getElementById('fr-openai-confirm-msg');
  const bar = document.getElementById('fr-openai-confirm-bar');
  const go = document.getElementById('fr-openai-confirm-go');
  const pick = document.getElementById('fr-openai-pick');
  return {
    msg: msg ? msg.textContent.trim() : null,
    barHidden: bar ? bar.hidden : null,
    goDisabled: go ? go.disabled : null,
    pickShown: pick ? !pick.hidden : null,
  };
});

async function waitFor(page, pred, ms) {
  const end = Date.now() + ms;
  let last = await read(page);
  while (Date.now() < end) {
    if (pred(last)) return last;
    await page.waitForTimeout(200);
    last = await read(page);
  }
  return last;
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-openai-install-refusal: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(initStub);
  const page = await ctx.newPage();
  await page.goto(PAGE);

  if (!(await reveal(page, 'fr-openai-confirm-go'))) {
    console.error('FAIL  render-openai-install-refusal: #fr-openai-confirm-go is gone from the page');
    await browser.close();
    process.exit(1);
  }

  // ARM 1: a refusal in the OLD engine shape, reason only at job.because.
  await page.evaluate((because) => {
    window.__install = { status: 400, body: { job: { phase: 'failed', because } } };
  }, REASON);
  await page.click('#fr-openai-confirm-go');
  let s = await waitFor(page, (x) => x.msg && !/Starting/.test(x.msg), 3000);
  check('first-run: a refusal paints the engine\'s reason, not the empty fallback',
    /^Installing OpenAI's Codex from here is not supported/.test(s.msg || '') && !/We could not start that install/.test(s.msg || ''),
    JSON.stringify(s.msg));
  check('first-run: the progress bar is hidden after a refusal', s.barHidden === true, 'bar hidden ' + s.barHidden);
  check('first-run: Confirm is clickable again after a refusal', s.goDisabled === false, 'disabled ' + s.goDisabled);

  // ARM 2: the install starts, then the job fails.
  await page.evaluate((because) => {
    window.__install = { status: 200, body: { job: { phase: 'downloading' } } };
    window.__runners = { openai: { present: false, job: { phase: 'failed', because } } };
  }, JOB_FAIL);
  await reveal(page, 'fr-openai-confirm-go');
  await page.click('#fr-openai-confirm-go');
  s = await waitFor(page, (x) => x.msg && /download server/.test(x.msg), 6000);
  check('first-run: a job that fails after starting paints its reason within seconds',
    /^We could not reach the download server/.test(s.msg || '') && !/taking longer/.test(s.msg || ''),
    JSON.stringify(s.msg));
  check('first-run: the bar is hidden and Confirm is back after a failed job',
    s.barHidden === true && s.goDisabled === false, 'bar hidden ' + s.barHidden + ', disabled ' + s.goDisabled);

  // ARM 3 (CONTROL): the install starts and the runner appears.
  await page.evaluate(() => {
    window.__install = { status: 200, body: { job: { phase: 'downloading' } } };
    window.__runners = { openai: { present: true, job: { phase: 'installed' } } };
  });
  await reveal(page, 'fr-openai-confirm-go');
  await page.click('#fr-openai-confirm-go');
  s = await waitFor(page, (x) => x.pickShown === true, 6000);
  check('CONTROL first-run: a runner that arrives opens the picker and clears the status line',
    s.pickShown === true && s.msg === '', 'picker shown ' + s.pickShown + ', msg ' + JSON.stringify(s.msg));

  // ARM 4: Settings.
  if (!(await reveal(page, 'acct-openai-install-go'))) {
    check('Settings: the install button is on the page', false, '#acct-openai-install-go is gone');
  } else {
    await page.evaluate((because) => {
      window.__install = { status: 400, body: { job: { phase: 'failed', because } } };
    }, REASON);
    await page.click('#acct-openai-install-go');
    await page.waitForTimeout(800);
    const a = await page.evaluate(() => {
      const m = document.getElementById('acct-openai-install-msg');
      const g = document.getElementById('acct-openai-install-go');
      return { msg: m ? m.textContent.trim() : null, disabled: g ? g.disabled : null };
    });
    check('Settings: a refusal paints the reason instead of staying on "Starting..."',
      /^Installing OpenAI's Codex from here is not supported/.test(a.msg || ''), JSON.stringify(a.msg));
    check('Settings: the install button is clickable again', a.disabled === false, 'disabled ' + a.disabled);
  }

  await browser.close();
  if (problems.length) {
    console.error('render-openai-install-refusal: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-openai-install-refusal: a refused or failed OpenAI install says why on both screens and gives the button back; a successful one still opens the picker.');
})().catch((err) => { console.error('FAIL  render-openai-install-refusal: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
