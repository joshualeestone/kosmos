'use strict';
// Browser-check-surface: openaiSubPaintDevice openaiSubDeviceMarkup openaiSubDeviceAddress ACCT_OPENAI_SUB_MODE openaiSubHow openaiSubOpen openaiSubCodeLeadAt acctOpenaiChoose acctOpenaiSubStart acctOpenaiSubReset acct-openai-pick-sub acct-openai-sub-go fr-openai-sub-code acct-openai-sub-code fr-openai-sub-open acct-openai-sub-open

/**
 * kosmos#3436: on Windows the ChatGPT subscription sign-in runs by DEVICE CODE. codex's
 * own browser pop opened BEHIND Kosmos there (a background process cannot bring a
 * window forward), so people missed it. Now the engine answers mode 'device' on win32,
 * and the page shows the one-time code with a Copy button and an "Open the sign-in
 * page" button that opens the link from the page itself, in front.
 *
 * What it asserts, each a thing a person would see:
 *   - Windows, first run: after the start, the polled link fills the open button and
 *     shows it; the code is on screen in a copy row with a Copy button; pressing Copy
 *     answers (Copied, or Select it and copy where the clipboard is refused); the
 *     explainer reads the Windows sentence (Kosmos opens the page and shows a code).
 *   - Windows, Settings: the same link and code on the Settings sign-in step.
 *   - 0.6.96 (Josh): in Settings ONE click on "Sign in with ChatGPT" starts the sign-in
 *     (the repeat button on the next step is hidden and start is asked exactly once);
 *     the code line names the address ("go to auth.openai.com/codex/device"); the link
 *     reads "Open the sign-in page again" on Windows (Kosmos already opened the page);
 *     and "Stop this sign-in" leaves the link pointing nowhere.
 *   - Windows, no readable code: codex's own words are shown instead of a blank.
 *   - Mac: the engine answers 'browser'; no code line appears, the explainer is the
 *     Mac sentence, and the page never grows a Copy button. The Mac is unchanged.
 *
 * Hermetic: loads web/index.html over file://, stubs fetch, no board. Reds on
 * origin/main, where the poll never paints a device link or code.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-openai-devicecode-3436.js
 *
 * ⚠️ HEADED by default, matching its neighbours. HEADED=0 on a machine with no
 * console session; the verdicts are the same (computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-openai-devicecode-3436: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const URL = 'https://auth.openai.com/codex/device';
const CODE = 'Q7RT-4KXWZ';

/* One page per arm. `platform` stamps the served meta the way server.js does and runs
   the copy layer; `start` and `status` are what the stubbed engine answers. */
async function arm(browser, { platform, where, start, status }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + PAGE);
  const setup = await page.evaluate(({ platform, where, start, status }) => {
    if (platform === 'win32') {
      document.querySelector('meta[name="kosmos-platform"]').setAttribute('content', 'win32');
      applyPlatformCopy(document);
    }
    window.__starts = 0;
    window.fetch = (u) => {
      const url = String(u);
      if (url.indexOf('/api/accounts/openai/subscription/start') !== -1) { window.__starts += 1; return Promise.resolve({ ok: true, status: 200, json: async () => start }); }
      if (url.indexOf('/api/accounts/openai/subscription/status') !== -1) return Promise.resolve({ ok: true, status: 200, json: async () => status });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    };
    if (where === 'firstrun') {
      document.getElementById('firstrun').hidden = false;
      if (typeof frGo !== 'function' || typeof frOpenaiShowPick !== 'function') return { error: 'frGo / frOpenaiShowPick missing' };
      frGo(5);
      frOpenaiShowPick();
      document.getElementById('fr-openai-pick-sub').click();
    } else {
      /* Settings: reveal the picker the way the dialog does, then press "Sign in with
         ChatGPT" ONCE. 0.6.96: that one press starts the sign-in. */
      for (let n = document.getElementById('acct-openai-pick'); n; n = n.parentElement) n.hidden = false;
      document.getElementById('acct-openai-pick-sub').click();
    }
    return { ok: true };
  }, { platform, where, start, status });
  if (setup.error) { await page.close(); return { error: setup.error }; }
  await page.waitForTimeout(1700);   // one+ poll interval (1200ms)
  const p = where === 'firstrun' ? 'fr' : 'acct';
  const got = await page.evaluate((p) => {
    const $ = (id) => document.getElementById(id);
    const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
    const code = $(p + '-openai-sub-code');
    const open = $(p + '-openai-sub-open');
    const how = document.querySelector('#' + p + '-openai-sub-step [data-win-copy="openaiSubHow"]');
    return {
      openShown: shown($(p + '-openai-sub-open-row')) && shown(open),
      openHref: open ? open.getAttribute('href') : null,
      openNewTab: open ? open.getAttribute('target') : null,
      codeShown: shown(code),
      codeText: code ? (code.textContent || '').replace(/\s+/g, ' ').trim() : '',
      codeCell: code && code.querySelector('.fr-cmd-row .fr-cmd') ? code.querySelector('.fr-cmd-row .fr-cmd').textContent : null,
      hasCopy: !!(code && code.querySelector('[data-copy-command]')),
      // #3952: the code in boxes, one per character, inside the cell Copy reads; no xAI line on OpenAI's screen.
      boxText: code ? [...code.querySelectorAll('.devcode-cell')].map((c) => c.textContent).join('') : '',
      boxDashes: code ? code.querySelectorAll('.devcode-dash').length : 0,
      boxNote: !!(code && code.querySelector('.devcode-note')),
      how: how ? how.textContent.replace(/\s+/g, ' ').trim() : null,
      openText: open ? open.textContent.trim() : null,
      starts: window.__starts,
      goShown: shown($(p + '-openai-sub-go')),
      mode: typeof ACCT_OPENAI_SUB_MODE === 'undefined' ? 'undefined' : ACCT_OPENAI_SUB_MODE,
    };
  }, p);
  if (got.hasCopy) {
    await page.click('#' + p + '-openai-sub-code [data-copy-command]');
    await page.waitForTimeout(150);
    got.copySays = await page.evaluate((p) => document.querySelector('#' + p + '-openai-sub-code [data-copy-command]').textContent, p);
  }
  if (where === 'settings' && !got.error) {
    /* Stop this sign-in: the hidden link must not keep the ended sign-in's address. */
    await page.evaluate(() => document.getElementById('acct-openai-sub-cancel').click());
    await page.waitForTimeout(150);
    got.hrefAfterStop = await page.evaluate(() => document.getElementById('acct-openai-sub-open').getAttribute('href'));
  }
  got.errors = errors;
  await page.close();
  return got;
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-openai-devicecode-3436: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const device = { start: { sessionId: 's1', mode: 'device' }, status: { state: 'awaiting-code', authUrl: URL, userCode: CODE } };
  const winFirstRun = await arm(browser, { platform: 'win32', where: 'firstrun', ...device });
  const winSettings = await arm(browser, { platform: 'win32', where: 'settings', ...device });
  const winRaw = await arm(browser, { platform: 'win32', where: 'firstrun', start: { sessionId: 's2', mode: 'device' },
    status: { state: 'awaiting-code', authUrl: URL, instructions: 'Open ' + URL + ' and type the word Codex shows you.' } });
  const mac = await arm(browser, { platform: 'darwin', where: 'firstrun', start: { sessionId: 's3', mode: 'browser' },
    status: { state: 'awaiting-browser', authUrl: 'https://auth.openai.com/oauth/authorize?x=1' } });
  await browser.close();

  const problems = [];
  for (const [name, r] of Object.entries({ winFirstRun, winSettings, winRaw, mac })) {
    if (r.error) problems.push(name + ': arm setup failed: ' + r.error);
    if (r.errors && r.errors.length) problems.push(name + ': page errors: ' + r.errors.join(' | '));
  }
  for (const [name, r] of Object.entries({ winFirstRun, winSettings })) {
    if (r.error) continue;
    if (!r.openShown || r.openHref !== URL) problems.push(name + ': the open-page button did not show the polled link (' + r.openHref + ')');
    if (r.openNewTab !== '_blank') problems.push(name + ': the open-page button no longer opens a new window from the page');
    if (!r.codeShown || r.codeCell !== CODE) problems.push(name + ': the one-time code is not on screen in its copy row: ' + JSON.stringify(r.codeText));
    if (!/^In your browser, go to auth\.openai\.com\/codex\/device and enter this code:/.test(r.codeText)) problems.push(name + ': the code line does not say where to go and what to do: ' + JSON.stringify(r.codeText));
    if (r.openText !== 'Open the sign-in page again') problems.push(name + ': the open link does not say it reopens the page: ' + JSON.stringify(r.openText));
    if (r.starts !== 1) problems.push(name + ': one click on Sign in with ChatGPT asked the engine to start ' + r.starts + ' time(s), not once');
    if (r.goShown) problems.push(name + ': a second Sign in with ChatGPT button is still on screen after the sign-in started');
    if (r.boxText !== CODE.replace(/-/g, '') || r.boxDashes !== (CODE.match(/-/g) || []).length) problems.push(name + ': #3952 the code is not drawn one box per character, grouped as OpenAI prints it: ' + JSON.stringify({ boxText: r.boxText, boxDashes: r.boxDashes }));
    if (r.boxNote) problems.push(name + ': #3952 xAI\'s "terminal" line is on an OpenAI screen');
    if (!r.hasCopy) problems.push(name + ': no Copy button beside the code');
    else if (!/^(Copied|Select it and copy)$/.test(r.copySays || '')) problems.push(name + ': pressing Copy gave no answer: ' + JSON.stringify(r.copySays));
    if (!/^Kosmos opens OpenAI.s sign-in page in your browser and shows you a short code/.test(r.how || '')) problems.push(name + ': the explainer is not the Windows sentence: ' + JSON.stringify(r.how));
    if (r.mode !== 'device') problems.push(name + ': the page did not record device mode from the start answer');
  }
  if (!winSettings.error && winSettings.hrefAfterStop !== '#') problems.push('winSettings: after Stop this sign-in the hidden link still points at ' + JSON.stringify(winSettings.hrefAfterStop));
  if (!winRaw.error) {
    if (!winRaw.codeShown || !/We could not pick out the code/.test(winRaw.codeText) || !/type the word Codex shows you/.test(winRaw.codeText)) {
      problems.push('winRaw: with no readable code, codex\'s own words were not shown: ' + JSON.stringify(winRaw.codeText));
    }
    if (winRaw.hasCopy) problems.push('winRaw: a Copy button was offered for a paragraph, not a code');
  }
  if (!mac.error) {
    if (mac.codeShown) problems.push('mac: a code line appeared on a browser sign-in: ' + JSON.stringify(mac.codeText));
    if (mac.hasCopy) problems.push('mac: a Copy button appeared on a browser sign-in');
    if (!/^Kosmos opens OpenAI's sign-in in your browser/.test(mac.how || '')) problems.push('mac: the explainer changed: ' + JSON.stringify(mac.how));
    if (mac.mode !== 'browser') problems.push('mac: the page did not record browser mode');
    if (mac.openText !== 'Open the sign-in page') problems.push('mac: the open link wording changed: ' + JSON.stringify(mac.openText));
  }

  console.log('  ' + JSON.stringify({ winFirstRun, winSettings, winRaw, mac }));
  if (problems.length) {
    console.error(`render-openai-devicecode-3436: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-openai-devicecode-3436: on Windows the OpenAI subscription sign-in shows its link and code (with Copy) in first run and Settings, falls back to codex\'s own words, and a Mac browser sign-in is unchanged.');
})();
